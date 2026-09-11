// ============================================================
// Astra Translate – Built-in chat web-search client
// ============================================================
// Key-free, browser-native search for popup chat only. Chrome's own network /
// system proxy settings apply to these fetches automatically.

import type { ChatSearchSource } from "../shared/types.ts";
import { t, type UiLanguage } from "../shared/i18n.ts";
import {
  bingSearchUrl,
  duckDuckGoSearchUrl,
  googleSearchUrl,
  searchLocaleFor,
} from "../shared/searchLocale.ts";
import { AstraError, isNetworkError, isTimeoutError } from "./errors.ts";
import {
  isGoogleCaptcha,
  parseBingHtml,
  parseDuckDuckGoHtml,
  parseGoogleHtml,
  type ParsedSearchSource,
} from "./webSearchParser.ts";

const SEARCH_TIMEOUT_MS = 12_000;
const MAX_RESULTS = 5;

/** A successful search attempt: sources are empty only when every engine
 * returned no parseable hits, not when network/HTTP work failed. */
export interface WebSearchResult {
  sources: ChatSearchSource[];
  noResults: boolean;
}

async function fetchText(url: string, lang: UiLanguage, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": searchLocaleFor(lang).acceptLanguage,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new AstraError(t(lang, "chat.searchFailed", { status: String(response.status) }), "SEARCH_HTTP");
    }
    return response.text();
  } catch (err) {
    if (err instanceof AstraError) throw err;
    // A caller-driven abort (clear chat / future stop button) is not a
    // timeout — rethrow untouched so it never surfaces as "search timed out".
    if (signal?.aborted) throw err;
    if (isTimeoutError(err) || (err instanceof Error && err.name === "AbortError")) {
      throw new AstraError(t(lang, "chat.searchTimeout"), "SEARCH_TIMEOUT");
    }
    if (isNetworkError(err)) {
      throw new AstraError(t(lang, "chat.searchNetwork"), "SEARCH_NETWORK");
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

interface EngineAttempt {
  name: "google" | "bing" | "duckduckgo";
  url: (query: string, lang: UiLanguage) => string;
  parse: (html: string) => ParsedSearchSource[];
}

// Preference order: Google first for result quality, Bing as fallback,
// DuckDuckGo's lightweight HTML endpoint as the last resort.
const ENGINES: EngineAttempt[] = [
  { name: "google", url: (q, lang) => googleSearchUrl(q, lang, MAX_RESULTS), parse: parseGoogleHtml },
  { name: "bing", url: (q, lang) => bingSearchUrl(q, lang), parse: parseBingHtml },
  { name: "duckduckgo", url: (q, lang) => duckDuckGoSearchUrl(q, lang), parse: parseDuckDuckGoHtml },
];

interface GoogleCustomSearchResponse {
  items?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
  }>;
  error?: {
    code?: number;
    message?: string;
  };
}

/**
 * Official Google Custom Search JSON API client (100 free queries/day).
 * Completely immune to scraping blocks, 429 limits, and captchas.
 */
async function fetchGoogleCustomSearch(
  query: string,
  apiKey: string,
  cx: string,
  lang: UiLanguage,
  signal?: AbortSignal
): Promise<WebSearchResult> {
  const q = query.trim();
  if (!q) return { sources: [], noResults: true };

  const hl = searchLocaleFor(lang).googleLanguage;
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(
    apiKey.trim()
  )}&cx=${encodeURIComponent(cx.trim())}&q=${encodeURIComponent(
    q
  )}&num=${MAX_RESULTS}&hl=${encodeURIComponent(hl)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const errJson = (await response.json()) as GoogleCustomSearchResponse;
        if (errJson.error?.message) {
          detail = `${detail}: ${errJson.error.message}`;
        }
      } catch {}
      throw new AstraError(t(lang, "chat.searchFailed", { status: detail }), "SEARCH_HTTP");
    }

    const data = (await response.json()) as GoogleCustomSearchResponse;
    const items = data.items || [];
    const sources: ChatSearchSource[] = items
      .filter((item) => item.link && item.title)
      .slice(0, MAX_RESULTS)
      .map((item) => ({
        title: item.title!.trim(),
        url: item.link!.trim(),
        snippet: (item.snippet || "").trim(),
        source: "google" as const,
        isExternal: true as const,
      }));

    return {
      sources,
      noResults: sources.length === 0,
    };
  } catch (err) {
    if (err instanceof AstraError) throw err;
    if (signal?.aborted) throw err;
    if (isTimeoutError(err) || (err instanceof Error && err.name === "AbortError")) {
      throw new AstraError(t(lang, "chat.searchTimeout"), "SEARCH_TIMEOUT");
    }
    if (isNetworkError(err)) {
      throw new AstraError(t(lang, "chat.searchNetwork"), "SEARCH_NETWORK");
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * Search the web for chat grounding.
 * When official Google Search API credentials (apiKey and cx) are configured,
 * only the official Google Custom Search API is used (100% Google, zero fallback).
 * Otherwise, cascades through public result pages until one yields parseable hits.
 */
export async function webSearch(
  query: string,
  lang: UiLanguage = "zh-CN",
  signal?: AbortSignal,
  allowFallback: boolean = true,
  googleApiKey?: string,
  googleCx?: string
): Promise<WebSearchResult> {
  const q = query.trim();
  if (!q) return { sources: [], noResults: true };

  // 1. If official Google API is configured, use it exclusively (no fallback to secondary engines)
  if (googleApiKey?.trim() && googleCx?.trim()) {
    return fetchGoogleCustomSearch(q, googleApiKey, googleCx, lang, signal);
  }

  const engineList = allowFallback ? ENGINES : [ENGINES[0]];

  // Any single engine may be rate-limited, blocked, or have shifted markup;
  // an engine that completes with zero hits still counts as a real answer.
  let lastError: unknown;
  let anyEngineCompleted = false;
  for (const engine of engineList) {
    try {
      const html = await fetchText(engine.url(q, lang), lang, signal);
      if (engine.name === "google" && isGoogleCaptcha(html)) {
        throw new AstraError(t(lang, "chat.googleSearchBlocked"), "GOOGLE_CAPTCHA");
      }
      const sources = engine.parse(html);
      anyEngineCompleted = true;
      if (sources.length > 0) return { sources, noResults: false };
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err;
    }
  }

  // No engine produced hits. If at least one genuinely answered "no results",
  // report that honestly; only surface a failure when every attempt errored.
  if (!anyEngineCompleted && lastError !== undefined) {
    if (lastError instanceof AstraError) throw lastError;
    throw new AstraError(t(lang, "chat.searchUnavailable"), "SEARCH_UNAVAILABLE");
  }
  return { sources: [], noResults: true };
}
