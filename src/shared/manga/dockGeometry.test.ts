import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dockPoint,
  normalizedDockPosition,
  validDockPosition,
  panelAtDock,
} from "./dockGeometry.ts";
import {
  comparisonCardRect,
  layoutMangaText,
  markerRect,
} from "./textLayout.ts";
const view = { x: 0, y: 0, width: 1200, height: 800 };
const toolbar = { width: 500, height: 50 };
const fits = (r: { x: number; y: number; width: number; height: number }) =>
  r.x >= 0 &&
  r.y >= 0 &&
  r.x + r.width <= view.width &&
  r.y + r.height <= view.height;

describe("draggable manga reading toolbar", () => {
  it("round trips saved normalized positions without depending on an absolute viewport size", () => {
    const position = { x: 0.3, y: 0.8 };
    const point = dockPoint(position, toolbar, view);
    const normalized = normalizedDockPosition(point, toolbar, view);
    assert.ok(
      Math.abs(normalized.x - position.x) < 1e-9 &&
        Math.abs(normalized.y - position.y) < 1e-9,
    );
    const resized = dockPoint(position, toolbar, { width: 760, height: 650 });
    assert.ok(
      resized.x + toolbar.width <= 752 && resized.y + toolbar.height <= 642,
    );
  });
  it("clamps dragging past every edge while keeping the handle accessible", () => {
    assert.deepEqual(
      normalizedDockPosition({ x: -500, y: -20 }, toolbar, view),
      { x: 0, y: 0 },
    );
    assert.deepEqual(
      normalizedDockPosition({ x: 5000, y: 9000 }, toolbar, view),
      { x: 1, y: 1 },
    );
    const p = dockPoint({ x: 1, y: 1 }, toolbar, view);
    assert.ok(fits({ ...p, ...toolbar }));
  });
  it("rejects corrupt position memory", () => {
    for (const value of [
      null,
      {},
      { x: NaN, y: 0 },
      { x: Infinity, y: 0 },
      { x: -1, y: 0 },
      { x: 1, y: 2 },
      { x: "0", y: 0 },
    ])
      assert.equal(validDockPosition(value), false);
    assert.equal(validDockPosition({ x: 0.5, y: 1 }), true);
  });
  it("opens details below a top-positioned dock and above a bottom-positioned dock", () => {
    const top = panelAtDock(
      { x: 10, y: 8, width: 500, height: 50 },
      { width: 390, height: 400 },
      view,
    );
    const bottom = panelAtDock(
      { x: 650, y: 720, width: 500, height: 50 },
      { width: 390, height: 400 },
      view,
    );
    assert.ok(top.y >= 66 && fits(top));
    assert.ok(bottom.y + bottom.height < 720 && fits(bottom));
  });
  it("clamps panel width and height on a narrow or centered viewport", () => {
    const p = panelAtDock(
      { x: 8, y: 250, width: 304, height: 80 },
      { width: 390, height: 600 },
      { width: 320, height: 600 },
    );
    assert.ok(
      p.x >= 0 && p.x + p.width <= 320 && p.y >= 0 && p.y + p.height <= 600,
    );
  });
});
describe("manga click and readability improvements", () => {
  const input = {
    text: "我回来了，给你。",
    rect: { x: 130, y: 130, width: 60, height: 150 },
    page: view,
    flat: false,
    vertical: false,
    unsafe: false,
  };
  const measure = (text: string, font: number) => text.length * font;
  it("uses reliable balloons even when OCR glyphs extend past the conservative center inset", () => {
    const bubble = { x: 110, y: 100, width: 100, height: 200 };
    const layout = layoutMangaText({ ...input, bubble }, measure);
    assert.equal(layout.mode, "inline");
    assert.ok(layout.rect.x >= bubble.x + 2 && layout.rect.y >= bubble.y + 2);
    assert.ok(layout.rect.x + layout.rect.width <= bubble.x + bubble.width - 2);
  });
  it("adapts Chinese translation to a tall English text box instead of folding it solely for direction", () => {
    const layout = layoutMangaText(
      {
        ...input,
        flat: true,
        rect: { x: 130, y: 130, width: 40, height: 170 },
      },
      measure,
    );
    assert.equal(layout.mode, "inline");
    assert.equal(layout.writingMode, "vertical-rl");
  });
  it("uses larger text for generous space, smaller text for narrow space, without overflowing", () => {
    const big = layoutMangaText(
      {
        ...input,
        flat: true,
        rect: { x: 130, y: 130, width: 180, height: 100 },
      },
      measure,
    );
    const small = layoutMangaText(
      { ...input, flat: true, rect: { x: 130, y: 130, width: 44, height: 90 } },
      measure,
    );
    assert.equal(big.fontSize, 28);
    assert.equal(small.mode, "inline");
    assert.ok(small.fontSize < big.fontSize && small.fontSize >= 12);
  });
  it("still folds genuinely unsafe regions without painting over characters", () => {
    assert.equal(layoutMangaText(input, measure).markerReason, "background");
    assert.equal(
      layoutMangaText(
        { ...input, flat: true, unsafe: true, unsafeReason: "sfx" },
        measure,
      ).markerReason,
      "sfx",
    );
  });
  it("gives small markers a 40px target clamped inside page edges", () => {
    for (const rect of [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 1199, y: 799, width: 2, height: 2 },
    ]) {
      const m = markerRect(rect, view);
      assert.equal(m.width, 40);
      assert.equal(m.height, 40);
      assert.ok(fits(m));
    }
  });
  it("uses a larger comparison card without letting a dragged dock cap its entire height", () => {
    const dock = { x: 300, y: 100, width: 500, height: 50 };
    const card = comparisonCardRect(
      { x: 100, y: 280, width: 40, height: 40 },
      view,
      280,
      dock,
    );
    assert.equal(card.width, 400);
    assert.equal(card.height, 280);
    assert.ok(fits(card));
    assert.ok(
      card.y >= dock.y + dock.height ||
        card.x + card.width <= dock.x ||
        card.x >= dock.x + dock.width,
    );
  });
});
