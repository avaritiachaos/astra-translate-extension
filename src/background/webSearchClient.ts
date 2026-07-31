// ============================================================
// Astra Translate – Built-in chat web-search client
// ============================================================
// Key-free, browser-native search for popup chat only. Chrome's own network /
// system proxy settings apply to these fetches automatically.

import type { ChatSearchSource } from "../shared/types";
import { t, type UiLanguage } from "../shared/i18n";
import {
  bingSearchUrl,
  duckDuckGoSearchUrl,
  googleSearchUrl,
  searchLocaleFor,
} from "../shared/searchLocale";
import { AstraError, isNetworkError, isTimeoutError } from "./errors";
import {
  parseBingHtml,
  parseDuckDuckGoHtml,
  parseGoogleHtml,
  type ParsedSearchSource,
} from "./webSearchParser";

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
        Accept: "text/html,application/xhtml+xml",
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
  url: (query: string, lang: UiLanguage) => string;
  parse: (html: string) => ParsedSearchSource[];
}

// Preference order: Google first for result quality, Bing as the
// mainland-China-reachable middle option, DuckDuckGo's lightweight HTML
// endpoint as the most markup-stable last resort.
const ENGINES: EngineAttempt[] = [
  { url: (q, lang) => googleSearchUrl(q, lang, MAX_RESULTS), parse: parseGoogleHtml },
  { url: (q, lang) => bingSearchUrl(q, lang), parse: parseBingHtml },
  { url: (q, lang) => duckDuckGoSearchUrl(q, lang), parse: parseDuckDuckGoHtml },
];

/**
 * Search public result pages without a separate API key, cascading through
 * the engine list until one yields parseable hits. Every result is external
 * context and is preserved separately from the model-generated answer.
 */
export async function webSearch(
  query: string,
  lang: UiLanguage = "zh-CN",
  signal?: AbortSignal
): Promise<WebSearchResult> {
  const q = query.trim();
  if (!q) return { sources: [], noResults: true };

  // Any single engine may be rate-limited, blocked, or have shifted markup;
  // an engine that completes with zero hits still counts as a real answer.
  let lastError: unknown;
  let anyEngineCompleted = false;
  for (const engine of ENGINES) {
    try {
      const sources = engine.parse(await fetchText(engine.url(q, lang), lang, signal));
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
