import { adjacentMangaPages } from "../../shared/manga/pageSelection.ts";
import type { Rect } from "../../shared/manga/types";

export type MangaImage = HTMLImageElement | HTMLCanvasElement;

export function isMangaImage(element: Element): element is MangaImage {
  return element.tagName === "IMG" || element.tagName === "CANVAS";
}

export function isCanvasImage(image: MangaImage): image is HTMLCanvasElement {
  return image.tagName === "CANVAS";
}

export function mangaImageSize(image: MangaImage) {
  return isCanvasImage(image)
    ? { width: image.width, height: image.height }
    : { width: image.naturalWidth, height: image.naturalHeight };
}

export function mangaImageSource(image: MangaImage): string {
  return isCanvasImage(image)
    ? `canvas:${image.width}x${image.height}`
    : image.currentSrc || image.src;
}

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

// Reader pages can extend beyond an overflow-clipped carousel. A bounding box
// alone would let the picker select preloaded pages outside the reader window.
export function visibleMangaImageRect(image: MangaImage): Rect | null {
  const view = image.ownerDocument.defaultView;
  if (!view || !image.isConnected) return null;
  const viewport = view.visualViewport;
  let visible = intersectRects(image.getBoundingClientRect(), {
    x: viewport?.offsetLeft ?? 0,
    y: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? view.innerWidth,
    height: viewport?.height ?? view.innerHeight,
  });
  if (!visible) return null;
  for (
    let element: Element | null = image;
    element;
    element = element.parentElement
  ) {
    const style = view.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      Number.parseFloat(style.opacity) === 0 ||
      style.contentVisibility === "hidden"
    )
      return null;
    if (element === image) continue;
    const clipX = /^(hidden|clip|scroll|auto)$/.test(style.overflowX);
    const clipY = /^(hidden|clip|scroll|auto)$/.test(style.overflowY);
    if (!clipX && !clipY) continue;
    const bounds = element.getBoundingClientRect();
    const box = element as HTMLElement;
    const sx = box.offsetWidth ? bounds.width / box.offsetWidth : 1;
    const sy = box.offsetHeight ? bounds.height / box.offsetHeight : 1;
    visible = intersectRects(visible, {
      x: clipX ? bounds.x + element.clientLeft * sx : visible.x,
      y: clipY ? bounds.y + element.clientTop * sy : visible.y,
      width: clipX ? element.clientWidth * sx : visible.width,
      height: clipY ? element.clientHeight * sy : visible.height,
    });
    if (!visible) return null;
  }
  return visible;
}

function containsPoint(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x &&
    y >= rect.y &&
    x < rect.x + rect.width &&
    y < rect.y + rect.height
  );
}

export function mangaImageAtPoint(
  x: number,
  y: number,
  doc: Document = document,
): MangaImage | null {
  const stack = doc.elementsFromPoint(x, y);
  let selected: MangaImage | null = null;
  let bestRank = Infinity;
  for (const element of doc.querySelectorAll("img, canvas")) {
    if (
      !isMangaImage(element) ||
      !containsPoint(element.getBoundingClientRect(), x, y)
    )
      continue;
    if (isCanvasImage(element) && (!element.width || !element.height)) continue;
    const visible = visibleMangaImageRect(element);
    if (!visible || !containsPoint(visible, x, y)) continue;
    // pointer-events:none canvases are absent from elementsFromPoint. Their
    // nearest hit ancestor still identifies the visible page beneath controls.
    const rank = stack.findIndex(
      (hit) => hit === element || hit.contains(element),
    );
    if (rank >= 0 && rank <= bestRank) {
      selected = element;
      bestRank = rank;
    }
  }
  return selected;
}

/** Select at most the current spread. Never enumerate a chapter for upload. */
export function visibleMangaSpread(
  doc: Document = document,
  anchor?: MangaImage,
): MangaImage[] {
  const candidates = [...doc.querySelectorAll("img,canvas")]
    .filter(isMangaImage)
    .flatMap((image) => {
      if (isCanvasImage(image) && (!image.width || !image.height)) return [];
      const rect = visibleMangaImageRect(image);
      const bounds = image.getBoundingClientRect();
      if (
        !rect ||
        bounds.width < 160 ||
        bounds.height < 220 ||
        rect.width < 100 ||
        rect.height < 72
      )
        return [];
      if (
        mangaImageAtPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
          doc,
        ) !== image
      )
        return [];
      return [{ image, rect }];
    })
    .sort(
      (a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height,
    );
  const first =
    candidates.find((item) => item.image === anchor) ?? candidates[0];
  if (!first) return [];
  const sameReader = (a: Element, b: Element) => {
    let parent = a.parentElement;
    for (
      let depth = 0;
      parent && depth < 4;
      depth++, parent = parent.parentElement
    ) {
      if (parent.tagName === "BODY" || parent.tagName === "HTML") return false;
      if (parent.contains(b)) return true;
    }
    return false;
  };
  const second = candidates.find(
    (item) =>
      item !== first &&
      sameReader(first.image, item.image) &&
      adjacentMangaPages(first.rect, item.rect),
  );
  return (second ? [first, second] : [first])
    .sort((a, b) => a.rect.x - b.rect.x)
    .map((item) => item.image);
}
