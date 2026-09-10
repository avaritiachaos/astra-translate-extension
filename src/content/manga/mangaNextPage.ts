import {
  isNextMangaPage,
  isNextNumberedImage,
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
function nextImageInReader(
  images: MangaImage[],
  root: Element,
): string | undefined {
  const list = [...root.querySelectorAll("img")].filter(
    (el): el is HTMLImageElement => el.tagName === "IMG",
  );
  const indexes = images.map((image) =>
    list.indexOf(image as HTMLImageElement),
  );
  if (indexes.some((index) => index < 0)) return;
  const previous = list[Math.max(...indexes)],
    next = list[Math.max(...indexes) + 1];
  if (
    !next ||
    !next.complete ||
    !next.naturalWidth ||
    next.naturalWidth < 160 ||
    next.naturalHeight < 220
  )
    return;
  if (
    next.naturalWidth / previous.naturalWidth < 0.5 ||
    next.naturalWidth / previous.naturalWidth > 2
  )
    return;
  const source = httpSource(next.currentSrc || next.src, location.href);
  if (!source || images.some((image) => mangaImageSource(image) === source))
    return;
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
  )
    return;
  const a = previous.getBoundingClientRect(),
    b = next.getBoundingClientRect();
  if (
    b.width > 0 &&
    b.height > 0 &&
    b.y < a.bottom - 8 &&
    Math.abs(b.x - a.x) < a.width * 0.8
  )
    return;
  return source;
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
export async function nextMangaImage(
  images: MangaImage[],
  root: Element | undefined,
  signal: AbortSignal,
): Promise<{ pageUrl: string; imageUrl: string } | undefined> {
  if (!images.length || images.some(isCanvasImage) || !root) return;
  const mounted = nextImageInReader(images, root);
  if (mounted) return { pageUrl: location.href, imageUrl: mounted };
  // Follow only an explicitly linked adjacent numbered page in the same chapter.
  // Never create URLs by incrementing filenames or crawl arbitrary links.
  if (images.length !== 1 || !(images[0] instanceof HTMLImageElement)) return;
  const selector = stableImageSelector(images[0]);
  if (!selector) return;
  const links = [
    ...document.querySelectorAll<HTMLAnchorElement | HTMLLinkElement>(
      'a[rel~=next],link[rel~=next],a.next,a[aria-label="Next"],a[aria-label="下一页"]',
    ),
  ];
  const parentLink = images[0].closest<HTMLAnchorElement>("a[href]");
  if (parentLink) links.push(parentLink);
  const urls = [
    ...new Set(
      links
        .map((el) => el.href)
        .filter((href) => isNextMangaPage(location.href, href)),
    ),
  ];
  if (urls.length !== 1) return;
  const pageUrl = urls[0];
  const response = await fetch(pageUrl, {
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
    return;
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let html = "",
    bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 1024 * 1024) return;
      html += decoder.decode(part.value, { stream: true });
    }
    html += decoder.decode();
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  // Template contents remain inert: no next-page scripts or image elements are
  // mounted or executed simply to discover the exact already-linked image URL.
  const template = document.createElement("template");
  template.innerHTML = html;
  const matches = template.content.querySelectorAll<HTMLImageElement>(selector);
  if (matches.length !== 1) return;
  const imageUrl = httpSource(
    matches[0].getAttribute("src") || matches[0].getAttribute("data-src") || "",
    pageUrl,
  );
  if (
    !imageUrl ||
    imageUrl === pageUrl ||
    imageUrl === mangaImageSource(images[0])
  )
    return;
  return { pageUrl, imageUrl };
}
