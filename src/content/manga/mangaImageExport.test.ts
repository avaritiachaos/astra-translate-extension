import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  wrapHorizontalLines,
  wrapVerticalColumns,
  FONT_FAMILY_MAP,
} from "./mangaImageExport.ts";

describe("mangaImageExport text wrapping", () => {
  it("wraps vertical text into columns by character count", () => {
    const text = "这是一段测试文字，用于验证竖排分列功能";
    const columns = wrapVerticalColumns(text, 6);
    assert.equal(columns[0], "这是一段测试");
    assert.equal(columns[1], "文字，用于验");
    assert.equal(columns[2], "证竖排分列功");
    assert.equal(columns[3], "能");
  });

  it("handles empty text gracefully", () => {
    assert.deepEqual(wrapVerticalColumns("", 5), []);
  });

  it("defines 4 distinct font family mappings", () => {
    assert.ok(FONT_FAMILY_MAP.sans.includes("sans-serif"));
    assert.ok(FONT_FAMILY_MAP.rounded.includes("Quicksand") || FONT_FAMILY_MAP.rounded.includes("PingFang"));
    assert.ok(FONT_FAMILY_MAP.comic.includes("Impact") || FONT_FAMILY_MAP.comic.includes("SimHei"));
    assert.ok(FONT_FAMILY_MAP.serif.includes("serif"));
  });

  it("handles horizontal line wrapping with mock context", () => {
    const mockCtx = {
      measureText: (str: string) => ({ width: str.length * 10 }),
    } as unknown as CanvasRenderingContext2D;

    const lines = wrapHorizontalLines(mockCtx, "Hello World this is a test", 100);
    assert.ok(lines.length > 1);
    assert.equal(wrapHorizontalLines(mockCtx, "", 100).length, 0);
  });
});

describe("manga enhancements i18n keys completeness", async () => {
  const { t } = await import("../../shared/i18n.ts");
  const languages = ["zh-CN", "en-US", "ja-JP"] as const;
  const requiredKeys = [
    "manga.cacheTitle",
    "manga.cacheStats",
    "manga.cacheClear",
    "manga.cacheClearConfirm",
    "manga.cacheCleared",
    "manga.cacheEmpty",
    "manga.fontFamily",
    "manga.fontSans",
    "manga.fontRounded",
    "manga.fontComic",
    "manga.fontSerif",
    "manga.exportImage",
    "manga.exportSuccess",
    "manga.exportNoTranslation",
    "manga.exportFailed",
  ];

  for (const lang of languages) {
    it(`provides all enhancement keys in ${lang}`, () => {
      for (const key of requiredKeys) {
        const text = t(lang, key as any);
        assert.ok(text && text !== key, `Missing or untranslated key "${key}" in ${lang}`);
      }
    });
  }
});
