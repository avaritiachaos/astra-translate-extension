// ============================================================
// Astra Translate – OpenAI-compatible Client
// ============================================================

import type {
  UserProviderSettings,
  UnifiedChatMessage as ChatMessage,
} from "../shared/types.ts";
import { t, type UiLanguage } from "../shared/i18n.ts";
import {
  mapHttpError,
  isTimeoutError,
  isNetworkError,
  ProviderRequestError,
} from "./errors.ts";
import { computeBackoffMs, parseRetryAfterMs, sleep } from "../shared/retry.ts";

export type { ChatMessage };

interface CompletionChoice {
  message: { content: string | unknown[] };
  finish_reason?: string | null;
}

interface CompletionResponse {
  choices: CompletionChoice[];
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) =>
      typeof part === "string"
        ? part
        : part && typeof part.text === "string"
          ? part.text
          : "",
    )
    .join("");
}

function extractDeltaText(choice?: StreamDeltaChoice): string {
  if (!choice) return "";
  return (
    contentText(choice.delta?.content) ||
    contentText(choice.delta?.text) ||
    contentText(choice.message?.content) ||
    contentText(choice.message?.text) ||
    contentText(choice.text)
  );
}

interface StreamDeltaChoice {
  delta?: { content?: string | unknown[]; text?: string };
  message?: { content?: string | unknown[]; text?: string };
  finish_reason?: string | null;
  text?: string;
}

interface StreamChunk {
  choices?: StreamDeltaChoice[];
}

/** Max automatic retries for transient failures (429 / 5xx / network). */
const MAX_TRANSIENT_RETRIES = 3;

/**
 * Non-standard body fields (thinking / reasoning controls) that only some
 * OpenAI-compatible gateways understand. A gateway that doesn't rejects the
 * whole request with 400, so on the first 400 we drop all of them at once and
 * retry — see dropOptionalFields.
 */
export interface ExtraRequestOptions {
  /** Merged into the request body; each key is droppable on a 400. */
  optionalBody?: Record<string, unknown>;
  /** Required output format; compatibility retries never remove it. */
  responseFormat?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Bounds the entire call, including retry delays. */
  deadlineMs?: number;
  maxRetries?: number;
  omitTemperature?: boolean;
}

export function buildRequestParts(
  settings: UserProviderSettings,
  messages: ChatMessage[],
  stream: boolean,
  lang: UiLanguage = "zh-CN",
  extra?: ExtraRequestOptions,
): {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  optionalKeys: string[];
} {
  const {
    baseUrl,
    endpoint,
    apiKey,
    model,
    temperature,
    disableThinking,
    providerId,
  } = settings;
  if (!apiKey) {
    // Callers pre-check, but keep a localized safety net for new call sites.
    throw new ProviderRequestError(
      t(lang, "error.apiKeyNotConfigured"),
      "API_KEY_MISSING",
    );
  }

  const url = `${baseUrl.replace(/\/+$/, "")}${endpoint}`;
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    stream,
  };

  const modelLower = (model || "").toLowerCase();

  let defaultTranslationOptional: Record<string, unknown> = {};
  if (providerId === "google-gemini") {
    // Gemini 3.x (3.7 / 3.8) does not support "none" and returns 400;
    // "low" effort minimizes thinking budget and gives sub-second translation.
    // Gemini 2.5 Flash supports "none".
    if (modelLower.includes("2.5") && !modelLower.includes("pro")) {
      defaultTranslationOptional = { reasoning_effort: "none" };
    } else {
      defaultTranslationOptional = { reasoning_effort: "low" };
    }
  } else if (providerId === "deepseek") {
    defaultTranslationOptional = { thinking: { type: "disabled" } };
  } else if (disableThinking) {
    defaultTranslationOptional = { thinking: false };
  }

  const optional: Record<string, unknown> = extra?.optionalBody
    ? { ...extra.optionalBody }
    : defaultTranslationOptional;

  const reserved = new Set(["model", "messages", "stream", "response_format"]);
  const optionalKeys = Object.keys(optional).filter(
    (key) => !reserved.has(key),
  );
  if (extra?.responseFormat) body.response_format = extra.responseFormat;
  if (extra?.omitTemperature) delete body.temperature;
  for (const key of optionalKeys) body[key] = optional[key];

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  // Apply user-configured extra headers (e.g. X-Proxy-Token for a self-hosted
  // reverse proxy). User headers win over defaults.
  if (settings.customHeaders) {
    for (const [k, v] of Object.entries(settings.customHeaders)) {
      if (k && v) headers[k] = v;
    }
  }

  return { url, headers, body, optionalKeys };
}

/**
 * Remove every optional field after a 400 so one unsupported parameter can't
 * cost the user their answer. Returns true when something was actually
 * dropped — the caller then retries without consuming a retry attempt.
 */
function dropOptionalFields(
  body: Record<string, unknown>,
  optionalKeys: string[],
): boolean {
  if (optionalKeys.length === 0) return false;
  for (const key of optionalKeys) delete body[key];
  optionalKeys.length = 0;
  return true;
}

function responseError(
  lang: UiLanguage,
  code = "PARSE_ERROR",
): ProviderRequestError {
  return new ProviderRequestError(
    t(
      lang,
      code === "RESPONSE_TRUNCATED"
        ? "error.truncated"
        : "error.invalidResponse",
    ),
    code,
  );
}

function checkFinish(reason: unknown, lang: UiLanguage): void {
  if (reason === "length") throw responseError(lang, "RESPONSE_TRUNCATED");
  if (typeof reason === "string" && reason !== "stop")
    throw responseError(lang);
}

function extractContent(data: CompletionResponse, lang: UiLanguage): string {
  const choice = data?.choices?.[0];
  checkFinish(choice?.finish_reason, lang);
  const content = extractDeltaText({ message: choice?.message }).trim();
  if (!content) throw responseError(lang);
  return content;
}

/** Read complete SSE events, including multi-line data and split UTF-8 bytes. */
async function readStream(
  res: Response,
  onDelta: (text: string) => void,
  onActivity: () => void,
  lang: UiLanguage,
): Promise<string> {
  if (!res.body) throw responseError(lang);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  let complete = false;
  let text = "";
  const flushEvent = () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n").trim();
    dataLines = [];
    if (!data) return;
    if (data === "[DONE]") {
      complete = true;
      return;
    }
    let chunk: StreamChunk & { error?: unknown };
    try {
      chunk = JSON.parse(data);
    } catch {
      throw responseError(lang);
    }
    if (chunk.error) throw responseError(lang);
    const choice = chunk.choices?.[0];
    const delta = extractDeltaText(choice);
    if (delta) {
      text += delta;
      if (text.length > 1_000_000) throw responseError(lang);
      onDelta(delta);
    }
    checkFinish(choice?.finish_reason, lang);
    if (choice?.finish_reason === "stop") complete = true;
  };
  const line = (raw: string) => {
    const value = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!value) flushEvent();
    else if (value.startsWith("data:"))
      dataLines.push(value.slice(5).replace(/^ /, ""));
  };
  try {
    while (!complete) {
      const part = await reader.read();
      if (part.done) break;
      onActivity();
      buffer += decoder.decode(part.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0 && !complete) {
        line(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
    }
    if (!complete) {
      buffer += decoder.decode();
      if (buffer) line(buffer);
      flushEvent();
    }
    if (!complete) throw responseError(lang, "RESPONSE_TRUNCATED");
    if (!text.trim()) throw responseError(lang);
    return text.trim();
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Inspect only a bounded error message to distinguish format negotiation from bad images. */
async function providerHttpError(
  res: Response,
  lang: UiLanguage,
  model: string,
): Promise<ProviderRequestError> {
  const error = mapHttpError(res.status, lang);
  if (![400, 404].includes(res.status) || !res.body) {
    void res.body?.cancel().catch(() => {});
    return error;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    while (bytes < 8192) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const part = chunk.value.subarray(0, 8192 - bytes);
      bytes += part.length;
      text += decoder.decode(part, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  let message = text, code = "";
  try {
    const data = JSON.parse(text);
    message = String(data.error?.message ?? data.message ?? "");
    code = String(data.error?.code ?? data.code ?? "");
  } catch {
    /* Some gateways return plain text. */
  }
  if (
    /^(model_not_found|unknown_model|model_not_available)$/i.test(code) ||
    /unknown provider for model|(?:unknown|unsupported|nonexistent) model|model[^\n]{0,150}(?:does not exist|not found|not available)/i.test(message)
  ) {
    // Surface the model from our request, not the raw upstream error: proxies
    // sometimes echo credentials or the request body in error.message.
    return new ProviderRequestError(
      t(lang, "error.modelUnavailable", { model }), "MODEL_NOT_FOUND", res.status,
    );
  }
  if (
    /response_format|json_schema|responseJsonSchema/i.test(message) &&
    /unsupported|not supported|unknown (?:field|parameter)|unrecognized|not implemented/i.test(
      message,
    )
  ) {
    return new ProviderRequestError(
      t(lang, "error.invalidResponse"),
      "FORMAT_UNSUPPORTED",
      400,
    );
  }
  return error;
}

async function requestCompletion(
  settings: UserProviderSettings,
  messages: ChatMessage[],
  lang: UiLanguage,
  extra?: ExtraRequestOptions,
  onDelta?: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { url, headers, body, optionalKeys } = buildRequestParts(
    settings,
    messages,
    !!onDelta,
    lang,
    extra,
  );
  const callerSignals = [
    ...new Set([signal, extra?.signal].filter((s): s is AbortSignal => !!s)),
  ];
  const lifetime = new AbortController();
  const abort = () => lifetime.abort();
  for (const s of callerSignals) {
    s.addEventListener("abort", abort, { once: true });
    if (s.aborted) abort();
  }
  const abortError = () =>
    new ProviderRequestError(
      t(
        lang,
        callerSignals.some((s) => s.aborted)
          ? "error.cancelled"
          : "error.timeout",
      ),
      callerSignals.some((s) => s.aborted) ? "CANCELLED" : "TIMEOUT",
    );
  const deadline =
    extra?.deadlineMs && extra.deadlineMs > 0
      ? setTimeout(abort, extra.deadlineMs)
      : undefined;
  const retries = Number.isFinite(extra?.maxRetries)
    ? Math.max(
        0,
        Math.min(MAX_TRANSIENT_RETRIES, Math.floor(extra!.maxRetries!)),
      )
    : MAX_TRANSIENT_RETRIES;
  const idleMs =
    Number.isFinite(settings.timeoutMs) && settings.timeoutMs > 0
      ? settings.timeoutMs
      : 30_000;
  try {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (lifetime.signal.aborted) throw abortError();
      const controller = new AbortController();
      const relay = () => controller.abort();
      lifetime.signal.addEventListener("abort", relay, { once: true });
      let timer = setTimeout(relay, idleMs);
      const rearm = () => {
        clearTimeout(timer);
        timer = setTimeout(relay, idleMs);
      };
      const cleanup = () => {
        clearTimeout(timer);
        lifetime.signal.removeEventListener("abort", relay);
      };
      let emitted = false;
      let retryAfterMs: number | null = null;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          const httpError = await providerHttpError(res, lang, settings.model);
          if (res.status === 400 && httpError.code !== "MODEL_NOT_FOUND" && dropOptionalFields(body, optionalKeys)) {
            attempt--;
            continue;
          }
          retryAfterMs = parseRetryAfterMs(res.headers.get("Retry-After"));
          throw httpError;
        }
        if (
          !onDelta ||
          /\bapplication\/(?:[^;]+\+)?json\b/i.test(
            res.headers.get("Content-Type") ?? "",
          )
        ) {
          let data: CompletionResponse;
          try {
            data = await res.json();
          } catch (err) {
            if (controller.signal.aborted) throw err;
            throw responseError(lang);
          }
          const text = extractContent(data, lang);
          if (onDelta) {
            emitted = true;
            onDelta(text);
          }
          return text;
        }
        return await readStream(
          res,
          (delta) => {
            emitted = true;
            onDelta(delta);
          },
          rearm,
          lang,
        );
      } catch (err) {
        cleanup();
        if (lifetime.signal.aborted) throw abortError();
        const error =
          err instanceof ProviderRequestError
            ? err
            : controller.signal.aborted || isTimeoutError(err)
              ? new ProviderRequestError(
                  t(lang, "error.timeout"),
                  "TIMEOUT",
                  undefined,
                  true,
                )
              : isNetworkError(err)
                ? new ProviderRequestError(
                    t(lang, "error.network"),
                    "NETWORK_ERROR",
                    undefined,
                    true,
                  )
                : responseError(lang);
        if (emitted || !error.retryable || attempt >= retries) throw error;
        try {
          await sleep(
            computeBackoffMs(attempt, { retryAfterMs }),
            lifetime.signal,
          );
        } catch {
          throw abortError();
        }
      } finally {
        cleanup();
      }
    }
    throw responseError(lang);
  } finally {
    clearTimeout(deadline);
    for (const s of callerSignals) s.removeEventListener("abort", abort);
  }
}

export function openAIChat(
  settings: UserProviderSettings,
  messages: ChatMessage[],
  lang: UiLanguage = "zh-CN",
  extra?: ExtraRequestOptions,
): Promise<string> {
  return requestCompletion(settings, messages, lang, extra);
}

export function openAIChatStream(
  settings: UserProviderSettings,
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  lang: UiLanguage = "zh-CN",
  signal?: AbortSignal,
  extra?: ExtraRequestOptions,
): Promise<string> {
  return requestCompletion(settings, messages, lang, extra, onDelta, signal);
}
