// ============================================================
// Astra Translate – Built-in chat web-search client
// ============================================================
// Key-free, browser-native search for popup chat only. Chrome's own network /
// system proxy settings apply to these fetches automatically.

import type { ChatSearchSource } from "../shared/types";
import { t, type UiLanguage } from "../shared/i18n";
import {
  duckDuckGoSearchUrl,
  googleSearchUrl,
  searchLocaleFor,
} from "../shared/searchLocale";
import { AstraError, isNetworkError, isTimeoutError } from "./errors";
import { parseDuckDuckGoHtml, parseGoogleHtml } from "./webSearchParser";

const SEARCH_TIMEOUT_MS = 12_000;
const MAX_RESULTS = 5;

/** A successful search attempt: sources are empty only when both engines
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

async function searchDuckDuckGo(query: string, lang: UiLanguage, signal?: AbortSignal): Promise<ChatSearchSource[]> {
  return parseDuckDuckGoHtml(await fetchText(duckDuckGoSearchUrl(query, lang), lang, signal));
}

async function searchGoogle(query: string, lang: UiLanguage, signal?: AbortSignal): Promise<ChatSearchSource[]> {
  return parseGoogleHtml(await fetchText(googleSearchUrl(query, lang, MAX_RESULTS), lang, signal));
}

/**
 * Search public result pages without a separate API key. Google is primary
 * for quality; DuckDuckGo is the resilient fallback. Every result is external
 * context and is preserved separately from the model-generated answer.
 */
export async function webSearch(
  query: string,
  lang: UiLanguage = "zh-CN",
  signal?: AbortSignal
): Promise<WebSearchResult> {
  const q = query.trim();
  if (!q) return { sources: [], noResults: true };

  // Google frequently rate-limits or changes markup, so any failure also gets
  // the DuckDuckGo fallback rather than immediately failing the whole turn.
  try {
    const sources = await searchGoogle(q, lang, signal);
    if (sources.length > 0) return { sources, noResults: false };
  } catch (err) {
    if (signal?.aborted) throw err;
  }

  try {
    const sources = await searchDuckDuckGo(q, lang, signal);
    return { sources, noResults: sources.length === 0 };
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof AstraError) throw err;
    throw new AstraError(t(lang, "chat.searchUnavailable"), "SEARCH_UNAVAILABLE");
  }
}
