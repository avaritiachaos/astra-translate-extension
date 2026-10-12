// ============================================================
// Astra Translate – DeepL API Client (background service worker)
// ============================================================
// DeepL is a plain-text MT REST API, not an OpenAI-compatible chat endpoint:
//   POST {base}/translate   body: { text: string[], target_lang: "ZH", ... }
//   → { translations: [{ text, detected_source_language }, ...] }
// Responses map 1:1 onto the input array order, which makes batch page
// translation structurally more reliable than the LLM JSON round-trip.

import type { UserProviderSettings } from "../shared/types.ts";
import { t, type UiLanguage } from "../shared/i18n.ts";
import {
  chunkDeeplTexts,
  deeplSourceCode,
  deeplTargetCode,
  joinDeeplSegments,
  resolveDeeplBase,
  splitDeeplSegments,
} from "../shared/deepl.ts";
import { PAGE_SEGMENT_SEPARATOR } from "../shared/constants.ts";
import { computeBackoffMs, sleep } from "../shared/retry.ts";
import { mapHttpError, ProviderRequestError } from "./errors.ts";

interface DeeplTranslation {
  text?: unknown;
}

interface DeeplResponse {
  translations?: DeeplTranslation[];
}

/** Conservative retry budget for transient DeepL failures (429 / 5xx / net). */
const MAX_TRANSIENT_RETRIES = 3;
/** Max entries per request — DeepL documents no hard count limit, stay safe. */
const MAX_TEXTS_PER_REQUEST = 50;

function authHeaders(apiKey: string): Record<string, string> {
  // "DeepL-Auth-Key" is the scheme used by DeepL's own client libraries and
  // accepted by both api / api-free hosts.
  return {
    "Content-Type": "application/json",
    Authorization: `DeepL-Auth-Key ${apiKey.trim()}`,
  };
}

function requireKey(settings: UserProviderSettings, lang: UiLanguage): string {
  const key = (settings.apiKey || "").trim();
  if (!key) {
    throw new ProviderRequestError(
      t(lang, "error.apiKeyNotConfigured"),
      "API_KEY_MISSING",
    );
  }
  return key;
}

function requireTargetCode(targetLang: string, lang: UiLanguage): string {
  const code = deeplTargetCode(targetLang);
  if (!code) {
    throw new ProviderRequestError(
      t(lang, "error.deeplUnsupportedLang", { lang: targetLang }),
      "TARGET_LANG_UNSUPPORTED",
    );
  }
  return code;
}

/** Bounded error-body read so non-mapped failures can surface a real message. */
async function readErrorBody(res: Response): Promise<string> {
  try {
    const reader = res.body?.getReader();
    if (!reader) return "";
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    while (bytes < 8192) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const part = chunk.value.subarray(0, 8192 - bytes);
      bytes += part.length;
      text += decoder.decode(part, { stream: true });
    }
    void reader.cancel().catch(() => {});
    reader.releaseLock();
    try {
      const data = JSON.parse(text);
      const message = data?.message ?? data?.error?.message ?? "";
      return typeof message === "string" ? message : text;
    } catch {
      return text;
    }
  } catch {
    return "";
  }
}

function deeplHttpError(
  res: Response,
  lang: UiLanguage,
  targetLang: string,
): ProviderRequestError {
  if (res.status === 456) {
    return new ProviderRequestError(
      t(lang, "error.deeplQuota"),
      "QUOTA_EXCEEDED",
      456,
      false,
    );
  }
  if (res.status === 400) {
    // An unsupported target_lang (plan or language table) surfaces as 400.
    return new ProviderRequestError(
      t(lang, "error.deeplUnsupportedLang", { lang: targetLang }),
      "TARGET_LANG_UNSUPPORTED",
      400,
      false,
    );
  }
  return mapHttpError(res.status, lang);
}

/** One POST /translate round trip for an already-chunked text array. */
async function deeplRequestOnce(
  settings: UserProviderSettings,
  texts: string[],
  targetLang: string,
  sourceLang: string | undefined,
  lang: UiLanguage,
  signal?: AbortSignal,
): Promise<string[]> {
  const key = requireKey(settings, lang);
  const url = `${resolveDeeplBase(key, settings.baseUrl).replace(/\/+$/, "")}${
    settings.endpoint || "/translate"
  }`;
  const body: Record<string, unknown> = {
    text: texts,
    target_lang: targetLang,
    preserve_formatting: true,
  };
  if (sourceLang) body.source_lang = sourceLang;

  const controller = new AbortController();
  const relay = () => controller.abort();
  signal?.addEventListener("abort", relay, { once: true });
  const idleMs =
    Number.isFinite(settings.timeoutMs) && settings.timeoutMs > 0
      ? settings.timeoutMs
      : 30_000;
  const timer = setTimeout(relay, idleMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await readErrorBody(res);
      void res.body?.cancel().catch(() => {});
      const error = deeplHttpError(res, lang, targetLang);
      if (
        detail &&
        res.status !== 400 &&
        res.status !== 456 &&
        error.code === "HTTP_ERROR"
      ) {
        // Unmapped status with a real DeepL message — surface it verbatim
        // instead of a generic status line.
        throw new ProviderRequestError(detail, error.code, error.statusCode, error.retryable);
      }
      throw error;
    }
    let data: DeeplResponse;
    try {
      data = await res.json();
    } catch (err) {
      if (controller.signal.aborted) throw err;
      throw new ProviderRequestError(t(lang, "error.invalidResponse"), "PARSE_ERROR");
    }
    const translations = data?.translations;
    if (!Array.isArray(translations) || translations.length !== texts.length) {
      throw new ProviderRequestError(t(lang, "error.invalidResponse"), "PARSE_ERROR");
    }
    return translations.map((entry) =>
      typeof entry?.text === "string" ? entry.text : "",
    );
  } catch (err) {
    if (err instanceof ProviderRequestError) throw err;
    if (controller.signal.aborted && !signal?.aborted) {
      throw new ProviderRequestError(t(lang, "error.timeout"), "TIMEOUT", undefined, true);
    }
    if (signal?.aborted) {
      throw new ProviderRequestError(t(lang, "error.cancelled"), "CANCELLED");
    }
    if (err instanceof TypeError) {
      throw new ProviderRequestError(t(lang, "error.network"), "NETWORK_ERROR", undefined, true);
    }
    throw new ProviderRequestError(t(lang, "error.invalidResponse"), "PARSE_ERROR");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
}

async function deeplRequestWithRetry(
  settings: UserProviderSettings,
  texts: string[],
  targetLang: string,
  sourceLang: string | undefined,
  lang: UiLanguage,
  options?: { signal?: AbortSignal; deadlineMs?: number },
): Promise<string[]> {
  const lifetime = new AbortController();
  const abort = () => lifetime.abort();
  const signal = options?.signal;
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const deadline =
    options?.deadlineMs && options.deadlineMs > 0
      ? setTimeout(abort, options.deadlineMs)
      : undefined;
  const abortError = () =>
    new ProviderRequestError(
      t(lang, signal?.aborted ? "error.cancelled" : "error.timeout"),
      signal?.aborted ? "CANCELLED" : "TIMEOUT",
    );
  try {
    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
      try {
        return await deeplRequestOnce(
          settings, texts, targetLang, sourceLang, lang, lifetime.signal,
        );
      } catch (err) {
        if (lifetime.signal.aborted) throw abortError();
        const error =
          err instanceof ProviderRequestError
            ? err
            : new ProviderRequestError(t(lang, "error.translationFailed"), "UNKNOWN");
        if (!error.retryable || attempt >= MAX_TRANSIENT_RETRIES) throw error;
        try {
          await sleep(computeBackoffMs(attempt, { retryAfterMs: null }), lifetime.signal);
        } catch {
          throw abortError();
        }
      }
    }
    throw new ProviderRequestError(t(lang, "error.translationFailed"), "UNKNOWN");
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * Translate one plain text. The system prompt is intentionally ignored —
 * DeepL has no prompt surface; callers skip prompt-dependent recovery paths.
 */
export async function deeplTranslate(
  settings: UserProviderSettings,
  text: string,
  targetLang: string,
  lang: UiLanguage = "zh-CN",
  sourceLang?: string,
  options?: { signal?: AbortSignal; deadlineMs?: number },
): Promise<string> {
  if (!text.trim()) return text;
  const code = requireTargetCode(targetLang, lang);
  const [translated] = await deeplRequestWithRetry(
    settings,
    [text],
    code,
    deeplSourceCode(sourceLang),
    lang,
    options,
  );
  return translated;
}

export interface DeeplBatchResult {
  /** Translated text per input item id (input order coverage). */
  translations: Map<string, string>;
}

/**
 * Translate a page batch. Each item may bundle fragments joined by U+E000 —
 * fragments are split into separate DeepL entries and rejoined afterwards, so
 * the engine never has to "preserve" an opaque separator character.
 *
 * `onItem` fires per completed item as soon as every fragment of that item has
 * been returned (chunks are processed in order), letting the stream port paint
 * progressively even though DeepL itself is not a streaming API.
 */
export async function deeplTranslateBatch(
  settings: UserProviderSettings,
  items: { id: string; text: string }[],
  targetLang: string,
  lang: UiLanguage = "zh-CN",
  onItem?: (item: { id: string; text: string }) => void,
  options?: { signal?: AbortSignal; deadlineMs?: number },
): Promise<DeeplBatchResult> {
  const code = requireTargetCode(targetLang, lang);

  // Flatten items → fragments; keep each item's fragment range to reassemble.
  const fragmentsPerItem: number[] = [];
  const rangeStart: number[] = [];
  const flatTexts: string[] = [];
  let cursor = 0;
  for (const item of items) {
    const parts = splitDeeplSegments(item.text, PAGE_SEGMENT_SEPARATOR);
    rangeStart.push(cursor);
    fragmentsPerItem.push(parts.length);
    for (const part of parts) flatTexts.push(part);
    cursor += parts.length;
  }

  // Empty/whitespace fragments are echoed back without an API call — DeepL
  // expects translatable content, and an empty fragment maps to itself.
  const sendIndices: number[] = [];
  const sendTexts: string[] = [];
  for (let i = 0; i < flatTexts.length; i++) {
    if (flatTexts[i].trim()) {
      sendIndices.push(i);
      sendTexts.push(flatTexts[i]);
    }
  }

  const translatedFlat: string[] = new Array(flatTexts.length).fill("");
  let translatedThrough = -1; // highest flat index returned so far
  const emitted = new Set<string>();
  const emitCompleted = () => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (emitted.has(item.id)) continue;
      const start = rangeStart[i];
      const count = fragmentsPerItem[i];
      let complete = true;
      for (let f = 0; f < count; f++) {
        const idx = start + f;
        // Empty fragments are local pass-throughs, never sent — always done.
        if (!flatTexts[idx].trim()) continue;
        if (idx > translatedThrough) {
          complete = false;
          break;
        }
      }
      if (!complete) continue;
      emitted.add(item.id);
      const parts: string[] = [];
      for (let f = 0; f < count; f++) parts.push(translatedFlat[start + f]);
      onItem?.({ id: item.id, text: joinDeeplSegments(parts, PAGE_SEGMENT_SEPARATOR) });
    }
  };

  for (const chunk of chunkDeeplTexts(sendTexts, MAX_TEXTS_PER_REQUEST)) {
    const out = await deeplRequestWithRetry(
      settings,
      chunk.texts,
      code,
      undefined,
      lang,
      options,
    );
    for (let c = 0; c < chunk.indices.length; c++) {
      const flatIndex = sendIndices[chunk.indices[c]];
      translatedFlat[flatIndex] = out[c] ?? "";
      if (flatIndex > translatedThrough) translatedThrough = flatIndex;
    }
    emitCompleted();
  }

  const translations = new Map<string, string>();
  for (let i = 0; i < items.length; i++) {
    const parts: string[] = [];
    for (let f = 0; f < fragmentsPerItem[i]; f++) {
      parts.push(translatedFlat[rangeStart[i] + f] || "");
    }
    translations.set(items[i].id, joinDeeplSegments(parts, PAGE_SEGMENT_SEPARATOR));
  }
  return { translations };
}
