// ============================================================
// Astra Translate – Search locale helpers
// ============================================================
// Pure request-language mapping for use in the service worker and Node tests.

import type { UiLanguage } from "./i18n";

export interface SearchLocale {
  acceptLanguage: string;
  duckDuckGoRegion: string;
  googleLanguage: string;
}

/** Keep external search-result language aligned with the extension UI. */
export function searchLocaleFor(lang: UiLanguage): SearchLocale {
  switch (lang) {
    case "ja-JP":
      return {
        acceptLanguage: "ja-JP,ja;q=0.9,en;q=0.7",
        duckDuckGoRegion: "jp-jp",
        googleLanguage: "ja",
      };
    case "en-US":
      return {
        acceptLanguage: "en-US,en;q=0.9,zh;q=0.5",
        duckDuckGoRegion: "us-en",
        googleLanguage: "en",
      };
    case "zh-CN":
    default:
      return {
        acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.7",
        duckDuckGoRegion: "cn-zh",
        googleLanguage: "zh-CN",
      };
  }
}

export function duckDuckGoSearchUrl(query: string, lang: UiLanguage): string {
  return `https://html.duckduckgo.com/html/?${new URLSearchParams({
    q: query.slice(0, 400),
    kl: searchLocaleFor(lang).duckDuckGoRegion,
  })}`;
}

export function googleSearchUrl(query: string, lang: UiLanguage, maxResults: number): string {
  return `https://www.google.com/search?${new URLSearchParams({
    q: query.slice(0, 400),
    hl: searchLocaleFor(lang).googleLanguage,
    num: String(maxResults),
  })}`;
}
