import type { MangaImage } from "./mangaImage";
import {
  MANGA_HOST_KEYWORDS,
  isLocalOrPrivateHost,
  isMangaReaderUrl,
} from "../../shared/manga/mangaDetection.ts";

export { MANGA_HOST_KEYWORDS, isLocalOrPrivateHost, isMangaReaderUrl };

// Strict, unambiguous manga/comic reader containers for unknown domains
const EXPLICIT_READER_SELECTORS = [
  "#manga-reader",
  "#comic-reader",
  "#manga-viewer",
  "#comic-viewer",
  "#reader-area",
  "#comic-wrap",
  "#comic-container",
  ".reader-container",
  ".comic-container",
  ".manga-container",
  ".comic-page",
  ".manga-page",
  ".scan-page",
  ".webtoon-image",
  "[data-reader]",
  "[data-comic]",
].join(",");

const PAGE_ATTRS = [
  "data-page",
  "data-index",
  "data-page-num",
  "data-page-no",
  "data-p",
];

export function isMangaReaderDom(
  doc: Document = document,
  spread: MangaImage[] = [],
): boolean {
  if (!spread.length) return false;

  const first = spread[0];

  // 1. Container positively matches dedicated manga reader ID/class/data-attribute
  for (
    let el = first.parentElement, depth = 0;
    el && depth < 6;
    el = el.parentElement, depth++
  ) {
    if (el === doc.body || el === doc.documentElement) break;
    if (el.matches?.(EXPLICIT_READER_SELECTORS)) return true;
  }

  // 2. Comic page numbering attributes explicitly placed on the element or parent
  if (
    PAGE_ATTRS.some(
      (attr) =>
        first.hasAttribute?.(attr) ||
        first.parentElement?.hasAttribute?.(attr),
    )
  ) {
    return true;
  }

  // 3. Dedicated manga/comic navigation elements specifically on the page
  const firstBounds = first.getBoundingClientRect();
  const isPortrait = firstBounds.height >= firstBounds.width * 1.05;
  if (isPortrait) {
    const hasMangaNav = doc.querySelector?.(
      '.next-chapter, .prev-chapter, [class*="chapter-nav"], [id*="chapter-nav"], [class*="comic-nav"], [id*="comic-nav"]',
    );
    if (hasMangaNav) return true;
  }

  return false;
}

export function isLikelyMangaPage(
  doc: Document = document,
  spread: MangaImage[] = [],
): boolean {
  if (!spread.length) return false;

  const url =
    doc.location?.href ||
    (typeof location !== "undefined" ? location.href : "");
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    // 1. Localhost, 127.0.0.1, private IPs are never public manga sites
    if (isLocalOrPrivateHost(host)) {
      return false;
    }
  } catch {
    return false;
  }

  // 2. Positive URL pattern / domain match
  if (isMangaReaderUrl(url)) {
    return true;
  }

  // 3. Fallback only if DOM exhibits unambiguous manga reader markup
  return isMangaReaderDom(doc, spread);
}
