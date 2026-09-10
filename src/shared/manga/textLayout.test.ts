import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { layoutMangaText, comparisonCardRect } from "./textLayout.ts";
import { adjacentMangaPages } from "./pageSelection.ts";
import type { Rect } from "./types.ts";
const measure = (text: string, size: number) =>
  Array.from(text).reduce(
    (n, c) => n + (/\p{Script=Han}/u.test(c) ? size : size * 0.6),
    0,
  );
const page = { x: 0, y: 0, width: 600, height: 900 };
const base = {
  text: "我会很快回来的，你在这里稍等一下。",
  rect: { x: 100, y: 150, width: 55, height: 150 },
  page,
  flat: true,
  vertical: true,
  unsafe: false,
};
const contained = (a: Rect, b: Rect) =>
  a.x >= b.x &&
  a.y >= b.y &&
  a.x + a.width <= b.x + b.width &&
  a.y + a.height <= b.y + b.height;
describe("readable manga text layout", () => {
  it("uses real vertical columns for tall CJK text rather than one-character horizontal lines", () => {
    const layout = layoutMangaText(base, measure);
    assert.equal(layout.mode, "inline");
    assert.equal(layout.writingMode, "vertical-rl");
    assert.ok(layout.fontSize >= 12 && layout.fontSize <= 28);
  });
  it("uses the safely inset bubble instead of squeezing into a narrow OCR column", () => {
    const bubble = { x: 80, y: 120, width: 120, height: 215 };
    const layout = layoutMangaText({ ...base, bubble }, measure);
    assert.equal(layout.mode, "inline");
    assert.ok(layout.rect.width > base.rect.width);
    assert.ok(contained(layout.rect, bubble));
    assert.ok(layout.rect.x > bubble.x);
  });
  it("keeps wide translated text horizontal even when source text is vertical", () => {
    const layout = layoutMangaText(
      { ...base, rect: { x: 50, y: 50, width: 200, height: 80 } },
      measure,
    );
    assert.equal(layout.mode, "inline");
    assert.equal(layout.writingMode, "horizontal-tb");
  });
  it("does not make Latin paragraphs vertical based on the Japanese source", () => {
    const layout = layoutMangaText(
      {
        ...base,
        text: "Wait here. I will be back soon.",
        rect: { x: 100, y: 150, width: 100, height: 180 },
      },
      measure,
    );
    assert.equal(layout.mode, "inline");
    assert.equal(layout.writingMode, "horizontal-tb");
  });
  it("uses a bounded marker for text that cannot fit at a readable font size", () => {
    const layout = layoutMangaText(
      { ...base, text: "很长的译文".repeat(60) },
      measure,
    );
    assert.equal(layout.mode, "marker");
    assert.equal(layout.rect.width, 40);
    assert.equal(layout.rect.height, 40);
  });
  it("does not paint across uncertain text or complex artwork", () => {
    for (const patch of [{ unsafe: true }, { flat: false }, { text: "" }])
      assert.equal(
        layoutMangaText({ ...base, ...patch }, measure).mode,
        "marker",
      );
  });
  it("does not trust an oversized bubble or a bubble that excludes the original text", () => {
    for (const bubble of [page, { x: 250, y: 100, width: 100, height: 200 }])
      assert.equal(
        layoutMangaText({ ...base, flat: false, bubble }, measure).mode,
        "marker",
      );
  });
  it("does not display an image-sized model detection as a giant white block", () => {
    assert.equal(
      layoutMangaText({ ...base, rect: page }, measure).mode,
      "marker",
    );
  });
  it("keeps markers inside the visible page at edges and uses them for mostly clipped text", () => {
    const layout = layoutMangaText(
      { ...base, rect: { x: 580, y: 860, width: 65, height: 150 } },
      measure,
    );
    assert.equal(layout.mode, "marker");
    assert.ok(contained(layout.rect, page));
  });
  it("does not expand automatically on smaller windows and returns to inline layout when space returns", () => {
    const small = layoutMangaText(
      { ...base, rect: { x: 100, y: 150, width: 20, height: 45 } },
      measure,
    );
    assert.equal(small.mode, "marker");
    assert.equal(layoutMangaText(base, measure).mode, "inline");
  });
  it("clamps comparison cards to all viewport edges, including narrow viewports", () => {
    for (const viewport of [page, { x: 0, y: 0, width: 240, height: 280 }]) {
      const card = comparisonCardRect(
        { x: 570, y: 860, width: 22, height: 22 },
        viewport,
        800,
      );
      assert.ok(contained(card, viewport));
      assert.ok(card.width <= 400);
    }
  });
});
describe("visible spread boundary", () => {
  const left = { x: 20, y: 0, width: 580, height: 850 },
    right = { x: 600, y: 0, width: 580, height: 850 };
  it("matches left and right pages independently of DOM order", () => {
    assert.equal(adjacentMangaPages(left, right), true);
    assert.equal(adjacentMangaPages(right, left), true);
  });
  it("allows a modest page gutter", () => {
    assert.equal(adjacentMangaPages(left, { ...right, x: 625 }), true);
  });
  it("rejects below-the-fold chapters, distant ads, overlaps, thumbnails and mismatched pages", () => {
    for (const item of [
      { ...right, y: 860 },
      { ...right, x: 1000 },
      { ...right, x: 500 },
      { ...right, width: 90 },
      { ...right, height: 400 },
    ])
      assert.equal(adjacentMangaPages(left, item), false);
  });
});
