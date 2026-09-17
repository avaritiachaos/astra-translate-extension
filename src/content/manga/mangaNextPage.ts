import {
  isNextMangaPage,
  isNextNumberedImage,
  readingPageUrl,
} from "../../shared/manga/readingPolicy";
import { isCanvasImage, mangaImageSource, type MangaImage } from "./mangaImage";
export function mangaReaderRoot(images: MangaImage[]): Element | undefined {
  const first = images[0];
  if (!first) return;
  for (
    let el = first.parentElement, depth = 0;
    el && depth < 5;
    el = el.parentElement, depth++
  ) {
    if (el === document.body || el === document.documentElement) break;
    if (
      images.every((image) => el!.contains(image)) &&
      el.matches(
        "#reader,#image-container,#content,.reader,.viewer,main,[role=main]",
      )
    )
      return el;
  }
  let parent = first.parentElement;
  for (
    let depth = 0;
    parent && depth < 3;
    depth++, parent = parent.parentElement
  ) {
    if (parent === document.body || parent === document.documentElement) break;
    if (
      images.every((image) => parent!.contains(image)) &&
      parent.querySelectorAll("img,canvas").length > 1
    )
      return parent;
  }
  return first.parentElement && first.parentElement !== document.body
    ? first.parentElement
    : undefined;
}
function httpSource(value: string, base: string): string | undefined {
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return;
  }
}
function nextImagesInReader(
  images: MangaImage[],
  root: Element,
  maxCount = 3,
): string[] {
  const list = [...root.querySelectorAll("img")].filter(
    (el): el is HTMLImageElement => el.tagName === "IMG",
  );
  const indexes = images.map((image) =>
    list.indexOf(image as HTMLImageElement),
  );
  if (indexes.some((index) => index < 0)) return [];
  const maxIdx = Math.max(...indexes);
  const results: string[] = [];
  const existingSources = new Set(images.map(mangaImageSource));

  for (
    let offset = 1;
    offset <= maxCount && maxIdx + offset < list.length;
    offset++
  ) {
    const previous = list[maxIdx + offset - 1];
    const next = list[maxIdx + offset];
    if (
      !next ||
      !next.complete ||
      !next.naturalWidth ||
      next.naturalWidth < 160 ||
      next.naturalHeight < 220
    )
      continue;
    if (
      next.naturalWidth / previous.naturalWidth < 0.5 ||
      next.naturalWidth / previous.naturalWidth > 2
    )
      continue;
    const source = httpSource(next.currentSrc || next.src, location.href);
    if (!source || existingSources.has(source) || results.includes(source))
      continue;

    const pageIndex = previous.dataset.page,
      nextIndex = next.dataset.page;
    const numbered =
      pageIndex &&
      nextIndex &&
      /^\d+$/.test(pageIndex) &&
      /^\d+$/.test(nextIndex) &&
      Number(nextIndex) === Number(pageIndex) + 1;
    if (
      !numbered &&
      !isNextNumberedImage(previous.currentSrc || previous.src, source)
    ) {
      const a = previous.getBoundingClientRect(),
        b = next.getBoundingClientRect();
      const isVerticalChain =
        b.y >= a.y &&
        Math.abs(b.x - a.x) < Math.max(a.width, b.width) * 0.8;
      if (!isVerticalChain) continue;
    }
    results.push(source);
  }
  return results;
}
function nextImageInReader(
  images: MangaImage[],
  root: Element,
): string | undefined {
  return nextImagesInReader(images, root, 1)[0];
}
function stableImageSelector(image: HTMLImageElement): string | undefined {
  if (
    image.id &&
    document.querySelectorAll("#" + CSS.escape(image.id)).length === 1
  )
    return "img#" + CSS.escape(image.id);
  for (
    let parent = image.parentElement, depth = 0;
    parent && depth < 3;
    parent = parent.parentElement, depth++
  ) {
    if (
      parent.id &&
      parent.querySelectorAll("img").length === 1 &&
      document.querySelectorAll("#" + CSS.escape(parent.id)).length === 1
    )
      return "#" + CSS.escape(parent.id) + " img";
  }
}
export async function nextMangaImages(
  images: MangaImage[],
  root: Element | undefined,
  signal: AbortSignal,
  maxCount = 3,
): Promise<Array<{ pageUrl: string; imageUrl: string }>> {
  if (!images.length || images.some(isCanvasImage) || !root) return [];
  const mounted = nextImagesInReader(images, root, maxCount);
  if (mounted.length) {
    return mounted.map((imageUrl) => ({ pageUrl: location.href, imageUrl }));
  }
  // Follow explicitly linked adjacent numbered pages in the same chapter.
  if (images.length !== 1 || !(images[0] instanceof HTMLImageElement)) return [];
  const selector =
    stableImageSelector(images[0]) ||
    (root.id ? "#" + CSS.escape(root.id) + " img" : undefined);
  if (!selector) return [];

  const results: Array<{ pageUrl: string; imageUrl: string }> = [];
  const visitedPages = new Set<string>([
    readingPageUrl(location.href) || location.href,
  ]);
  const seenImages = new Set<string>([mangaImageSource(images[0])]);
  let currentDocUrl = location.href;
  let currentDoc: Document | DocumentFragment = document;

  while (results.length < maxCount && !signal.aborted) {
    const links = [
      ...currentDoc.querySelectorAll<HTMLAnchorElement | HTMLLinkElement>(
        'a[rel~=next],link[rel~=next],a.next,a[aria-label="Next"],a[aria-label="下一页"],a[title*="Next"],a[title*="下一页"]',
      ),
    ];
    const currImg = currentDoc.querySelector<HTMLImageElement>(selector);
    const parentLink = currImg?.closest<HTMLAnchorElement>("a[href]");
    if (parentLink) links.push(parentLink);

    const urls = [
      ...new Set(
        links
          .map((el) => {
            try {
              const raw =
                el.getAttribute("href") || (el as HTMLAnchorElement).href;
              return raw ? new URL(raw, currentDocUrl).href : "";
            } catch {
              return "";
            }
          })
          .filter(
            (href) =>
              Boolean(href) &&
              isNextMangaPage(currentDocUrl, href) &&
              !visitedPages.has(href),
          ),
      ),
    ];

    if (urls.length !== 1) break;
    const nextPageUrl = urls[0];
    visitedPages.add(nextPageUrl);

    if (results.length > 0) {
      await new Promise((r) => setTimeout(r, 300));
      if (signal.aborted) break;
    }

    try {
      const response = await fetch(nextPageUrl, {
        credentials: "same-origin",
        redirect: "error",
        signal,
        headers: { Accept: "text/html" },
      });
      if (
        !response.ok ||
        !response.headers.get("Content-Type")?.includes("text/html") ||
        !response.body
      )
        break;

      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let html = "",
        bytes = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.length;
          if (bytes > 1024 * 1024) break;
          html += decoder.decode(part.value, { stream: true });
        }
        html += decoder.decode();
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }

      const template = document.createElement("template");
      template.innerHTML = html;
      let matches = template.content.querySelectorAll<HTMLImageElement>(selector);
      if (matches.length !== 1 && root.id) {
        matches = template.content.querySelectorAll<HTMLImageElement>(
          "#" + CSS.escape(root.id) + " img",
        );
      }
      if (matches.length !== 1) break;

      const imageUrl = httpSource(
        matches[0].getAttribute("src") ||
          matches[0].getAttribute("data-src") ||
          "",
        nextPageUrl,
      );

      if (
        !imageUrl ||
        imageUrl === nextPageUrl ||
        seenImages.has(imageUrl)
      )
        break;

      seenImages.add(imageUrl);
      results.push({ pageUrl: nextPageUrl, imageUrl });

      currentDocUrl = nextPageUrl;
      currentDoc = template.content;
    } catch {
      break;
    }
  }

  return results;
}

export async function nextMangaImage(
  images: MangaImage[],
  root: Element | undefined,
  signal: AbortSignal,
): Promise<{ pageUrl: string; imageUrl: string } | undefined> {
  const all = await nextMangaImages(images, root, signal, 1);
  return all[0];
}
