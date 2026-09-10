import type { Rect } from "./types.ts";
/** Adjacent visible pages, not arbitrary images elsewhere in the viewport. */
export function adjacentMangaPages(a: Rect, b: Rect): boolean {
  const left = a.x < b.x ? a : b,
    right = left === a ? b : a;
  const gap = right.x - left.x - left.width;
  return (
    Math.min(a.width, b.width) >= 160 &&
    Math.min(a.height, b.height) >= 220 &&
    gap >= -2 &&
    gap <= Math.max(32, Math.min(a.width, b.width) * 0.15) &&
    Math.min(a.height, b.height) / Math.max(a.height, b.height) > 0.82 &&
    Math.min(a.width, b.width) / Math.max(a.width, b.width) > 0.65 &&
    Math.abs(a.y - b.y) < Math.max(20, Math.min(a.height, b.height) * 0.08)
  );
}
