// ============================================================
// Astra Translate – OpenAI-compatible Client
// ============================================================

import type { UserProviderSettings } from "../shared/types";
import { t, type UiLanguage } from "../shared/i18n";
import {
  mapHttpError,
  isTimeoutError,
  isNetworkError,
  ProviderRequestError,
} from "./errors";
import {
  computeBackoffMs,
  isRetryableHttpStatus,
  parseRetryAfterMs,
  sleep,
} from "../shared/retry";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CompletionChoice {
  message: { content: string };
}

interface CompletionResponse {
  choices: CompletionChoice[];
}

interface StreamDeltaChoice {
  delta?: { content?: string };
  message?: { content?: string };
}

interface StreamChunk {
  choices?: StreamDeltaChoice[];
}

/** Max automatic retries for transient failures (429 / 5xx / network). */
const MAX_TRANSIENT_RETRIES = 3;

function buildRequestParts(
  settings: UserProviderSettings,
  messages: ChatMessage[],
  stream: boolean,
  lang: UiLanguage = "zh-CN"
): {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  thinkingEnabled: boolean;
} {
  const { baseUrl, endpoint, apiKey, model, temperature, disableThinking, providerId } = settings;
  if (!apiKey) {
    // Callers pre-check, but keep a localized safety net for new call sites.
    throw new ProviderRequestError(t(lang, "error.apiKeyNotConfigured"), "API_KEY_MISSING");
  }

  const url = `${baseUrl.replace(/\/+$/, "")}${endpoint}`;
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    stream,
  };

  let thinkingEnabled = providerId === "deepseek" && disableThinking;
  if (thinkingEnabled) {
    body.thinking = { type: "disabled" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  return { url, headers, body, thinkingEnabled };
}

/**
 * Send a single chat completion request to an OpenAI-compatible endpoint.
 * Automatically retries rate-limits and transient server/network errors with
 * exponential backoff (honours Retry-After when present).
 */
export async function openAIChat(
  settings: UserProviderSettings,
  messages: ChatMessage[],
  lang: UiLanguage = "zh-CN"
): Promise<string> {
  if (!settings.apiKey) {
    throw new ProviderRequestError(t(lang, "error.apiKeyNotConfigured"), "API_KEY_MISSING");
  }

  const { url, headers, body } = buildRequestParts(settings, messages, false, lang);
  let thinkingEnabled = body.thinking != null;

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), settings.timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Drop the error body — we only act on the status / headers.
        void res.body?.cancel().catch(() => {});
        if (thinkingEnabled && res.status === 400) {
          thinkingEnabled = false;
          delete body.thinking;
          clearTimeout(timeoutId);
          attempt -= 1;
          continue;
        }

        if (isRetryableHttpStatus(res.status) && attempt < MAX_TRANSIENT_RETRIES) {
          const retryAfterMs = parseRetryAfterMs(res.headers.get("Retry-After"));
          const wait = computeBackoffMs(attempt, { retryAfterMs });
          clearTimeout(timeoutId);
          await sleep(wait);
          continue;
        }

        throw mapHttpError(res.status, lang);
      }

      const data = (await res.json()) as CompletionResponse;
      return extractContent(data, lang);
    } catch (err) {
      lastError = err;

      if (isTimeoutError(err)) {
        if (attempt < MAX_TRANSIENT_RETRIES) {
          clearTimeout(timeoutId);
          await sleep(computeBackoffMs(attempt));
          continue;
        }
        throw new ProviderRequestError(t(lang, "error.timeout"), "TIMEOUT", undefined, true);
      }

      if (isNetworkError(err)) {
        if (attempt < MAX_TRANSIENT_RETRIES) {
          clearTimeout(timeoutId);
          await sleep(computeBackoffMs(attempt));
          continue;
        }
        throw new ProviderRequestError(t(lang, "error.network"), "NETWORK_ERROR", undefined, true);
      }

      if (err instanceof ProviderRequestError) {
        if (!err.retryable || attempt >= MAX_TRANSIENT_RETRIES) throw err;
        clearTimeout(timeoutId);
        await sleep(computeBackoffMs(attempt));
        continue;
      }

      throw new ProviderRequestError(
        `${t(lang, "error.unknown")}: ${(err as Error).message}`,
        "UNKNOWN"
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (lastError instanceof ProviderRequestError) throw lastError;
  throw new ProviderRequestError(t(lang, "error.unknown"), "UNKNOWN");
}

/**
 * Streaming chat completion. Invokes `onDelta` with each content fragment as
 * it arrives. Retries only when no content has been emitted yet (so partial
 * page applies are not duplicated). Returns the full concatenated text.
 */
export async function openAIChatStream(
  settings: UserProviderSettings,
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  lang: UiLanguage = "zh-CN",
  signal?: AbortSignal
): Promise<string> {
  if (!settings.apiKey) {
    throw new ProviderRequestError(t(lang, "error.apiKeyNotConfigured"), "API_KEY_MISSING");
  }

  const { url, headers, body } = buildRequestParts(settings, messages, true, lang);
  let thinkingEnabled = body.thinking != null;
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new ProviderRequestError(t(lang, "error.timeout"), "TIMEOUT", undefined, true);
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    // Idle timeout: arms for time-to-first-byte, then re-arms on every chunk.
    // A slow model streaming a large batch must not be cut off just because
    // the *total* stream time exceeds timeoutMs — only a silent stall aborts.
    let timeoutId = setTimeout(() => controller.abort(), settings.timeoutMs);
    const rearmTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort(), settings.timeoutMs);
    };
    let emittedAny = false;
    let full = "";

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Drop the error body — we only act on the status / headers.
        void res.body?.cancel().catch(() => {});
        if (thinkingEnabled && res.status === 400) {
          thinkingEnabled = false;
          delete body.thinking;
          clearTimeout(timeoutId);
          signal?.removeEventListener("abort", onAbort);
          attempt -= 1;
          continue;
        }

        if (isRetryableHttpStatus(res.status) && attempt < MAX_TRANSIENT_RETRIES) {
          const retryAfterMs = parseRetryAfterMs(res.headers.get("Retry-After"));
          clearTimeout(timeoutId);
          signal?.removeEventListener("abort", onAbort);
          await sleep(computeBackoffMs(attempt, { retryAfterMs }));
          continue;
        }

        throw mapHttpError(res.status, lang);
      }

      if (!res.body) {
        // Provider returned a non-stream body — fall back to one-shot parse.
        const data = (await res.json()) as CompletionResponse;
        const content = extractContent(data, lang);
        if (content) {
          onDelta(content);
          emittedAny = true;
        }
        return content;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let lineBuf = "";
      let sawDone = false;

      try {
        while (!sawDone) {
          const { done, value } = await reader.read();
          if (done) break;
          rearmTimeout();
          lineBuf += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = lineBuf.indexOf("\n")) >= 0) {
            let line = lineBuf.slice(0, nl);
            lineBuf = lineBuf.slice(nl + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line || line.startsWith(":")) continue;
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") {
              // Some gateways keep the connection open after [DONE]; stop
              // reading instead of waiting for the server to close it.
              sawDone = true;
              lineBuf = "";
              break;
            }
            try {
              const chunk = JSON.parse(data) as StreamChunk;
              const delta =
                chunk.choices?.[0]?.delta?.content ??
                chunk.choices?.[0]?.message?.content ??
                "";
              if (delta) {
                full += delta;
                emittedAny = true;
                onDelta(delta);
              }
            } catch {
              // Incomplete or non-JSON SSE line — skip.
            }
          }
        }
      } finally {
        // Release the connection on every exit path (incl. [DONE] with the
        // server still holding the stream open, and mid-stream errors).
        void reader.cancel().catch(() => {});
      }

      if (!full.trim()) {
        throw new ProviderRequestError(t(lang, "error.invalidResponse"), "PARSE_ERROR");
      }
      return full.trim();
    } catch (err) {
      lastError = err;

      // Content already reached the page: never retry (deltas would be
      // duplicated) and never pass a truncated stream off as success — the
      // caller gets the real error alongside whatever items already streamed.
      if (emittedAny) {
        if (err instanceof ProviderRequestError) throw err;
        if (isTimeoutError(err)) {
          throw new ProviderRequestError(t(lang, "error.timeout"), "TIMEOUT", undefined, true);
        }
        throw err instanceof Error
          ? new ProviderRequestError(err.message, "UNKNOWN")
          : new ProviderRequestError(t(lang, "error.unknown"), "UNKNOWN");
      }

      if (isTimeoutError(err)) {
        if (attempt < MAX_TRANSIENT_RETRIES) {
          clearTimeout(timeoutId);
          signal?.removeEventListener("abort", onAbort);
          await sleep(computeBackoffMs(attempt));
          continue;
        }
        throw new ProviderRequestError(t(lang, "error.timeout"), "TIMEOUT", undefined, true);
      }

      if (isNetworkError(err)) {
        if (attempt < MAX_TRANSIENT_RETRIES) {
          clearTimeout(timeoutId);
          signal?.removeEventListener("abort", onAbort);
          await sleep(computeBackoffMs(attempt));
          continue;
        }
        throw new ProviderRequestError(t(lang, "error.network"), "NETWORK_ERROR", undefined, true);
      }

      if (err instanceof ProviderRequestError) {
        if (!err.retryable || attempt >= MAX_TRANSIENT_RETRIES) throw err;
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        await sleep(computeBackoffMs(attempt));
        continue;
      }

      throw new ProviderRequestError(
        `${t(lang, "error.unknown")}: ${(err as Error).message}`,
        "UNKNOWN"
      );
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  if (lastError instanceof ProviderRequestError) throw lastError;
  throw new ProviderRequestError(t(lang, "error.unknown"), "UNKNOWN");
}

function extractContent(data: CompletionResponse, lang: UiLanguage = "zh-CN"): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new ProviderRequestError(t(lang, "error.invalidResponse"), "PARSE_ERROR");
  }
  return content.trim();
}
