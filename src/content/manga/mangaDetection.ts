import type { MangaImage } from "./mangaImage";

const MANGA_HOST_KEYWORDS = [
  "manga",
  "comic",
  "manhua",
  "manhwa",
  "webtoon",
  "nhentai",
  "e-hentai",
  "exhentai",
  "hitomi",
  "copymanga",
  "kuaikan",
  "dm5",
  "18comic",
  "rawdevart",
  "asurascans",
  "flamecomics",
  "reaperscans",
  "dynasty-scans",
  "piccoma",
  "cmoa",
  "mechacomic",
  "renta",
  "bookwalker",
  "alphapolis",
  "shonenjump",
  "tonarinoyj",
  "sunday-webry",
  "magapoke",
  "mangafox",
  "mangahere",
  "mangapark",
  "bilibilicomics",
  "manhuagui",
];

const NON_MANGA_HOSTS = [
  "blender.org",
  "wikipedia.org",
  "github.com",
  "google.com",
  "youtube.com",
  "twitter.com",
  "x.com",
  "reddit.com",
  "facebook.com",
  "instagram.com",
  "amazon.com",
  "apple.com",
  "microsoft.com",
  "stackoverflow.com",
];

export function isMangaReaderUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (!/^https?:$/.test(parsed.protocol)) return false;

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    // Check non-manga major domains
    if (NON_MANGA_HOSTS.some((blocked) => host === blocked || host.endsWith("." + blocked))) {
      return false;
    }

    // 1. Hostname hints: known manga/comic domains
    if (MANGA_HOST_KEYWORDS.some((kw) => host.includes(kw))) {
      return true;
    }

    // 2. Path patterns: reading a chapter or comic viewer
    if (
      /\/chapter[s]?[-_/]?\d+/i.test(path) ||
      /\/(ch|ep|episode)[-_/]?\d+/i.test(path) ||
      /\/(read|reader|viewer)\b/i.test(path) ||
      /\/(manga|comic|comics|manhua|manhwa|webtoon|doujin|hentai)\//i.test(path) ||
      /\/g\/\d+/i.test(path)
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

const READER_SELECTORS = [
  "#reader",
  "#viewer",
  "#image-container",
  "#comic-wrap",
  "#manga-viewer",
  "#reader-area",
  "#comic-container",
  "#viewcontainer",
  "#cp_img",
  ".reader",
  ".viewer",
  ".reader-container",
  ".comic-container",
  ".manga-container",
  ".comic-page",
  ".manga-page",
  ".page-image",
  ".scan-page",
  ".reading-content",
  ".viewer-cnt",
  ".comic-wrap",
  ".manga-wrap",
  ".webtoon-image",
  ".comic-view",
  "[data-reader]",
  "[data-comic]",
  "[data-viewer]",
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

  // 1. Reader container matching known reader IDs, classes, or data attributes
  for (
    let el = first.parentElement, depth = 0;
    el && depth < 6;
    el = el.parentElement, depth++
  ) {
    if (el === doc.body || el === doc.documentElement) break;
    if (el.matches?.(READER_SELECTORS)) return true;
  }

  // 2. Two-page spread: 2 side-by-side portrait images
  if (spread.length >= 2) {
    const a = spread[0].getBoundingClientRect();
    const b = spread[1].getBoundingClientRect();
    const isPortraitA = a.height >= a.width * 1.05;
    const isPortraitB = b.height >= b.width * 1.05;
    const similarHeight =
      Math.abs(a.height - b.height) / Math.max(a.height, b.height) < 0.2;
    if (isPortraitA && isPortraitB && similarHeight) return true;
  }

  // 3. Multi-page vertical strip reader (webtoon or vertical scroll)
  const parent = first.parentElement;
  if (parent && parent !== doc.body && parent !== doc.documentElement) {
    const siblingImages = Array.from(
      parent.querySelectorAll<HTMLImageElement | HTMLCanvasElement>(
        "img, canvas",
      ),
    ).filter((img) => {
      const r = img.getBoundingClientRect();
      return r.width >= 160 && r.height >= 220;
    });
    if (siblingImages.length >= 3) {
      const baseWidth = siblingImages[0].getBoundingClientRect().width;
      const similarCount = siblingImages.filter((img) => {
        const w = img.getBoundingClientRect().width;
        return Math.abs(w - baseWidth) / Math.max(w, baseWidth) < 0.25;
      }).length;
      if (similarCount >= 3) return true;
    }
  }

  // 4. Page numbering attributes on the image or its parent
  if (
    PAGE_ATTRS.some(
      (attr) =>
        first.hasAttribute?.(attr) ||
        first.parentElement?.hasAttribute?.(attr),
    )
  ) {
    return true;
  }

  // 5. Chapter navigation elements on the page combined with a portrait image
  const firstBounds = first.getBoundingClientRect();
  const isPortrait = firstBounds.height >= firstBounds.width * 1.05;
  if (isPortrait) {
    const hasNav = doc.querySelector?.(
      'a[rel~=next], a[rel~=prev], .next-chapter, .prev-chapter, .next-page, .prev-page, [class*="chapter-nav"], [id*="chapter-nav"]',
    );
    if (hasNav) return true;
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
  if (url && isMangaReaderUrl(url)) {
    return true;
  }

  return isMangaReaderDom(doc, spread);
}
