import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { layoutMangaText, type MangaMarkerReason } from "./textLayout.ts";
import {
  translationState,
  translationPresentation,
  summarizeTranslations,
} from "./translationPresentation.ts";

const page = { x: 0, y: 0, width: 600, height: 900 };
const input = {
  text: "你好，再见。",
  rect: { x: 100, y: 100, width: 120, height: 90 },
  page,
  flat: true,
  vertical: false,
  unsafe: false,
};
const measure = (text: string, size: number) => text.length * size;

describe("manga marker explanations", () => {
  it("does not label a translated SFX marker as unrecognized", () => {
    const layout = layoutMangaText(
      { ...input, unsafe: true, unsafeReason: "sfx" },
      measure,
    );
    assert.equal(layout.mode, "marker");
    assert.equal(layout.markerReason, "sfx");
    const display = translationPresentation(
      { translatedText: "砰！", uncertain: false },
      layout.markerReason,
      "zh-CN",
    );
    assert.equal(display.state, "translated");
    assert.match(display.label, /已译.*折叠/);
    assert.match(display.description, /拟声词已有译文/);
  });
  it("explains why a normal translated dialogue is hidden on a complex background", () => {
    const layout = layoutMangaText({ ...input, flat: false }, measure);
    assert.equal(layout.markerReason, "background");
    const display = translationPresentation(
      { translatedText: input.text, uncertain: false },
      layout.markerReason,
      "zh-CN",
    );
    assert.equal(display.state, "translated");
    assert.match(display.description, /已有译文.*背景/);
  });
  it("explains size and clipping limits independently of model confidence", () => {
    const cases = [
      { patch: { text: "很长的译文".repeat(70) }, reason: "space" },
      { patch: { rect: page }, reason: "oversized" },
      {
        patch: { rect: { x: 580, y: 860, width: 80, height: 100 } },
        reason: "clipped",
      },
    ] as const;
    for (const { patch, reason } of cases) {
      const layout = layoutMangaText({ ...input, ...patch }, measure);
      assert.equal(layout.mode, "marker");
      assert.equal(layout.markerReason, reason);
    }
  });
  it("distinguishes uncertain candidate text from no returned translation", () => {
    const candidate = translationPresentation(
      { translatedText: "也许是这个意思", uncertain: true },
      "uncertain",
      "zh-CN",
    );
    assert.equal(candidate.state, "uncertain");
    assert.match(candidate.description, /候选译文/);
    const missing = translationPresentation(
      { translatedText: " \n ", uncertain: true },
      "uncertain",
      "zh-CN",
    );
    assert.equal(missing.state, "untranslated");
    assert.match(missing.description, /尚无可用译文/);
    assert.doesNotMatch(missing.label, /已译/);
  });
  it("prioritizes missing translation over SFX or oversized boxes", () => {
    const layout = layoutMangaText(
      { ...input, text: "", rect: page, unsafe: true, unsafeReason: "sfx" },
      measure,
    );
    assert.equal(layout.markerReason, "untranslated");
  });
  it("gives normally displayed text no folding reason", () => {
    const layout = layoutMangaText(input, measure);
    assert.equal(layout.mode, "inline");
    assert.equal(layout.markerReason, undefined);
    const display = translationPresentation(
      { translatedText: input.text, uncertain: false },
      undefined,
      "zh-CN",
    );
    assert.equal(display.description, "");
    assert.equal(display.label, "已译");
  });
  it("drops the space reason when the same translation can fit after resizing", () => {
    const small = layoutMangaText(
      { ...input, rect: { x: 100, y: 100, width: 15, height: 24 } },
      measure,
    );
    assert.equal(small.markerReason, "space");
    assert.equal(layoutMangaText(input, measure).markerReason, undefined);
  });
  it("localizes every marker explanation and state in all three UI languages", () => {
    const reasons: MangaMarkerReason[] = [
      "untranslated",
      "uncertain",
      "sfx",
      "oversized",
      "background",
      "clipped",
      "space",
    ];
    for (const lang of ["zh-CN", "en-US", "ja-JP"] as const) {
      for (const reason of reasons) {
        const display = translationPresentation(
          {
            translatedText: reason === "untranslated" ? "" : "some text",
            uncertain: reason === "uncertain",
          },
          reason,
          lang,
        );
        assert.ok(display.description);
        assert.equal(display.description.includes("manga."), false);
        assert.equal(display.label.includes("manga."), false);
      }
    }
  });
});

describe("returned translation counts", () => {
  it("counts folded translations as translated and does not count missing text as translated", () => {
    const regions = [
      { translatedText: "直接显示", uncertain: false, folded: false },
      { translatedText: "背景复杂，折叠", uncertain: false, folded: true },
      { translatedText: "砰", uncertain: false, folded: true },
      { translatedText: "候选词", uncertain: true, folded: true },
      { translatedText: "", uncertain: true, folded: true },
      { translatedText: "  ", uncertain: false, folded: true },
    ];
    assert.deepEqual(summarizeTranslations(regions), {
      translated: 3,
      folded: 2,
      uncertain: 1,
      untranslated: 2,
    });
  });
  it("does not guess that unreturned source text has been translated", () => {
    assert.deepEqual(summarizeTranslations([]), {
      translated: 0,
      folded: 0,
      uncertain: 0,
      untranslated: 0,
    });
  });
  it("does not mutate source or translation strings while presenting state", () => {
    const region = {
      translatedText: " <img src=x onerror=alert(1)> \n文字",
      uncertain: false,
    };
    const before = structuredClone(region);
    assert.equal(translationState(region), "translated");
    translationPresentation(region, "space", "zh-CN");
    summarizeTranslations([region]);
    assert.deepEqual(region, before);
  });
});
