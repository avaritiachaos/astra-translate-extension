import type { Rect } from "./types.ts";

export type MangaMarkerReason =
  | "untranslated"
  | "uncertain"
  | "sfx"
  | "oversized"
  | "background"
  | "clipped"
  | "space";

export interface TextLayoutInput {
  text: string;
  rect: Rect;
  bubble?: Rect;
  page: Rect;
  flat: boolean;
  vertical: boolean;
  unsafe: boolean;
  unsafeReason?: "uncertain" | "sfx";
}
export interface MangaTextLayout {
  rect: Rect;
  mode: "inline" | "marker";
  markerReason?: MangaMarkerReason;
  writingMode: "horizontal-tb" | "vertical-rl";
  fontSize: number;
  text: string;
}
const intersection = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
};
const area = (rect: Rect) => rect.width * rect.height;
const contains = (outer: Rect, inner: Rect, tolerance = 2) =>
  outer.x <= inner.x + tolerance &&
  outer.y <= inner.y + tolerance &&
  outer.x + outer.width >= inner.x + inner.width - tolerance &&
  outer.y + outer.height >= inner.y + inner.height - tolerance;
export function markerRect(
  rect: Rect,
  page: Rect,
  textRects: Rect[] = [rect],
  occupied: Rect[] = [],
): Rect {
  // Keep the 40px hit target, but put the painted badge BESIDE the detected
  // glyphs rather than on their first character. Avoid other regions too.
  const size = Math.min(40, page.width, page.height),
    gap = 3;
  const clamp = (n: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, n));
  const candidate = (x: number, y: number): Rect => ({
    x: clamp(x, page.x, page.x + page.width - size),
    y: clamp(y, page.y, page.y + page.height - size),
    width: size,
    height: size,
  });
  const middleX = rect.x + (rect.width - size) / 2,
    middleY = rect.y + (rect.height - size) / 2;
  const choices = [
    candidate(rect.x - size - gap, rect.y),
    candidate(rect.x + rect.width + gap, rect.y),
    candidate(rect.x - size - gap, middleY),
    candidate(rect.x + rect.width + gap, middleY),
    candidate(middleX, rect.y - size - gap),
    candidate(middleX, rect.y + rect.height + gap),
    candidate(rect.x, rect.y - size - gap),
    candidate(rect.x + rect.width - size, rect.y + rect.height + gap),
  ];
  const overlapArea = (a: Rect, b: Rect) => {
    const hit = intersection(a, b);
    return hit ? area(hit) : 0;
  };
  const score = (box: Rect) => {
    const inset = Math.min(7, size / 4);
    const dot = {
      x: box.x + inset,
      y: box.y + inset,
      width: size - 2 * inset,
      height: size - 2 * inset,
    };
    const textOverlap = textRects.reduce(
      (sum, text) => sum + overlapArea(dot, text),
      0,
    );
    const hitOverlap = textRects.reduce(
      (sum, text) => sum + overlapArea(box, text),
      0,
    );
    const markerOverlap = occupied.reduce(
      (sum, other) => sum + overlapArea(box, other),
      0,
    );
    return textOverlap * 100 + hitOverlap * 2 + markerOverlap * 5;
  };
  return choices.reduce((best, item) =>
    score(item) < score(best) ? item : best,
  );
}
/** Never grow a translation into unrecognized artwork just to make it fit. */
export function layoutMangaText(
  input: TextLayoutInput,
  measure: (text: string, fontSize: number) => number,
): MangaTextLayout {
  const { rect, page, bubble } = input;
  const text = input.text.replace(/\s+/g, " ").trim();
  const marker = (markerReason: MangaMarkerReason): MangaTextLayout => ({
    markerReason,
    rect: markerRect(rect, page),
    mode: "marker",
    writingMode: "horizontal-tb",
    fontSize: 12,
    text,
  });
  if (!text) return marker("untranslated");
  if (input.unsafe) return marker(input.unsafeReason ?? "uncertain");
  if (area(rect) > area(page) * 0.22) return marker("oversized");
  let box = {
    x: rect.x - 3,
    y: rect.y - 3,
    width: rect.width + 6,
    height: rect.height + 6,
  };
  let safeBubble = false;
  if (
    bubble &&
    contains(bubble, rect) &&
    area(bubble) <= area(page) * 0.2 &&
    bubble.width <= Math.max(100, rect.width * 4) &&
    bubble.height <= Math.max(150, rect.height * 3)
  ) {
    // Only use the inner bubble; do not cover its outline or tail. Keep enough
    // room to cover the original glyphs even if detection is close to an edge.
    // A rectangular fill must remain inside an oval balloon even at corners.
    const tall = bubble.height > bubble.width;
    const dx = bubble.width * (tall ? 0.19 : 0.12),
      dy = bubble.height * (tall ? 0.12 : 0.19);
    const inner = {
      x: bubble.x + dx,
      y: bubble.y + dy,
      width: bubble.width - 2 * dx,
      height: bubble.height - 2 * dy,
    };
    if (contains(inner, rect, 5)) {
      box = inner;
      safeBubble = true;
    } else {
      // OCR often includes glyphs close to a balloon's edge. The entire inner
      // rectangle need not contain every glyph to trust the original text box.
      // Cover only that box, clipped inside the detected balloon, not its outline.
      const inset = {
        x: bubble.x + 2,
        y: bubble.y + 2,
        width: bubble.width - 4,
        height: bubble.height - 4,
      };
      const original = intersection(box, inset);
      if (original && contains(original, rect, 2)) {
        box = original;
        safeBubble = true;
      }
    }
  }
  if (!input.flat && !safeBubble) return marker("background");
  const clipped = intersection(box, page);
  if (!clipped || area(clipped) < area(box) * 0.88) return marker("clipped");
  box = clipped;
  const chars = Array.from(text);
  const cjk = chars.filter((char) =>
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char),
  ).length;
  const vertical =
    (input.vertical || box.height > box.width * 2.1) &&
    box.height > box.width * 1.45 &&
    cjk / Math.max(1, chars.length) > 0.5;
  const width = box.width - 8,
    height = box.height - 8;
  for (let font = 28; font >= 12; font--) {
    if (vertical) {
      const rows = Math.floor(height / font),
        columns = Math.ceil(chars.length / Math.max(1, rows));
      if (rows >= Math.min(3, chars.length) && columns * font * 1.3 <= width)
        return {
          rect: box,
          mode: "inline",
          writingMode: "vertical-rl",
          fontSize: font,
          text,
        };
    } else {
      // Avoid the one-character-wide horizontal columns seen on vertical OCR
      // boxes. True vertical typesetting above is preferable for CJK balloons.
      if (width < font * Math.min(2, chars.length)) continue;
      let lines = 1,
        used = 0,
        tooWide = false;
      for (const char of chars) {
        const advance = measure(char, font);
        if (advance > width) {
          tooWide = true;
          break;
        }
        if (used + advance > width) {
          lines++;
          used = advance;
        } else used += advance;
      }
      if (!tooWide && lines * font * 1.35 <= height)
        return {
          rect: box,
          mode: "inline",
          writingMode: "horizontal-tb",
          fontSize: font,
          text,
        };
    }
  }
  return marker("space");
}

export function comparisonCardRect(
  anchor: Rect,
  viewport: Rect,
  height: number,
  avoid?: Rect,
): Rect {
  const width = Math.min(400, Math.max(0, viewport.width - 24));
  const h = Math.min(height, Math.max(0, viewport.height - 24));
  const clamp = (n: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, n));
  const box = (x: number, y: number): Rect => ({
    x: clamp(x, viewport.x + 12, viewport.x + viewport.width - width - 12),
    y: clamp(y, viewport.y + 12, viewport.y + viewport.height - h - 12),
    width,
    height: h,
  });
  const candidates = [
    box(anchor.x + anchor.width + 10, anchor.y),
    box(anchor.x - width - 10, anchor.y),
    box(anchor.x, anchor.y + anchor.height + 10),
    box(anchor.x, anchor.y - h - 10),
  ];
  if (avoid)
    candidates.push(
      box(avoid.x - width - 10, anchor.y),
      box(avoid.x + avoid.width + 10, anchor.y),
      box(anchor.x, avoid.y - h - 10),
      box(anchor.x, avoid.y + avoid.height + 10),
    );
  const overlapArea = (a: Rect, b: Rect) => {
    const shared = intersection(a, b);
    return shared ? area(shared) : 0;
  };
  const score = (candidate: Rect) =>
    (avoid ? overlapArea(candidate, avoid) * 10 : 0) +
    overlapArea(candidate, anchor);
  return candidates.reduce((best, candidate) =>
    score(candidate) < score(best) ? candidate : best,
  );
}
