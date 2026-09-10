import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markerRect } from "./textLayout.ts";
import type { Rect } from "./types.ts";
const page = { x: 0, y: 0, width: 600, height: 900 };
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;
const badge = (box: Rect): Rect => ({
  x: box.x + 7,
  y: box.y + 7,
  width: box.width - 14,
  height: box.height - 14,
});
const contained = (box: Rect) =>
  box.x >= 0 &&
  box.y >= 0 &&
  box.x + box.width <= page.width &&
  box.y + box.height <= page.height;

describe("manga badge placement beside text", () => {
  it("keeps both the dot and hit target outside a central text region", () => {
    const text = { x: 280, y: 120, width: 35, height: 110 };
    const result = markerRect(text, page);
    assert.equal(result.width, 40);
    assert.equal(result.height, 40);
    assert.equal(overlaps(result, text), false);
    assert.equal(overlaps(badge(result), text), false);
  });
  it("chooses the other side instead of covering adjacent original glyphs", () => {
    const text = { x: 280, y: 120, width: 35, height: 110 };
    const nearby = { x: 222, y: 110, width: 55, height: 140 };
    const result = markerRect(text, page, [text, nearby]);
    assert.ok(result.x >= text.x + text.width);
    assert.equal(overlaps(badge(result), nearby), false);
  });
  it("keeps markers in view without returning onto letters near any page corner", () => {
    for (const text of [
      { x: 0, y: 0, width: 45, height: 120 },
      { x: 550, y: 0, width: 50, height: 90 },
      { x: 0, y: 785, width: 35, height: 110 },
      { x: 565, y: 790, width: 35, height: 110 },
    ]) {
      const result = markerRect(text, page);
      assert.ok(contained(result));
      assert.equal(overlaps(badge(result), text), false);
    }
  });
  it("avoids an already placed marker if another clear position exists", () => {
    const text = { x: 280, y: 120, width: 35, height: 110 };
    const first = markerRect(text, page);
    const next = markerRect(text, page, [text], [first]);
    assert.equal(overlaps(first, next), false);
    assert.equal(overlaps(next, text), false);
  });
  it("uses vertical clearance when both side positions hit nearby text", () => {
    const text = { x: 160, y: 180, width: 90, height: 100 };
    const sideA = { x: 50, y: 155, width: 110, height: 160 };
    const sideB = { x: 250, y: 155, width: 150, height: 160 };
    const result = markerRect(text, page, [text, sideA, sideB]);
    assert.equal(
      [text, sideA, sideB].some((t) => overlaps(badge(result), t)),
      false,
    );
  });
});
