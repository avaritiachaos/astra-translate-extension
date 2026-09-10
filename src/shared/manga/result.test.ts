import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseMangaResult,
  mapBox,
  positionRegion,
  mergeRegions,
} from "./result.ts";
import {
  planTiles,
  imagePlacement,
  imageSourceAllowed,
} from "./imageGeometry.ts";
const row = {
  id: "a",
  kind: "dialogue",
  sourceText: "HELLO",
  translatedText: "你好",
  textBox: [100, 200, 300, 500],
  bubbleBox: null,
  writingDirection: "horizontal",
  readingOrder: 0,
  uncertain: false,
};
const reply = (regions: unknown[]) =>
  JSON.stringify({ schemaVersion: 1, sourceLanguage: "English", regions });
describe("manga result contract", () => {
  it("accepts a complete result and explicit no-text images", () => {
    assert.equal(parseMangaResult(reply([row]))[0].translatedText, "你好");
    assert.deepEqual(parseMangaResult(reply([])), []);
  });
  it("rejects missing data, invalid regions, duplicated ids and invalid coordinates", () => {
    const invalid = [
      { ...row, id: "" },
      { ...row, translatedText: "" },
      { ...row, textBox: [300, 200, 100, 500] },
      { ...row, textBox: [-1, 200, 300, 500] },
      { ...row, textBox: [100, 200, 300, Infinity] },
      { ...row, uncertain: "false" },
      { ...row, bubbleBox: [200, 200, 250, 400] },
      { ...row, readingOrder: -1 },
    ];
    for (const item of invalid)
      assert.throws(
        () => parseMangaResult(reply([item])),
        /MANGA_INVALID_RESULT/,
      );
    assert.throws(
      () => parseMangaResult(reply([row, row])),
      /MANGA_INVALID_RESULT/,
    );
    assert.throws(() => parseMangaResult("{}"), /MANGA_INVALID_RESULT/);
  });
  it("rejects echoed or truncated objects instead of displaying partial output", () => {
    assert.throws(() => parseMangaResult(reply([row]) + reply([row])));
    assert.throws(() => parseMangaResult(reply([row]).slice(0, -1)));
  });
  it("keeps untrusted model strings as text data", () => {
    const text = "<img src=x onerror=alert(1)>";
    assert.equal(
      parseMangaResult(reply([{ ...row, translatedText: text }]))[0]
        .translatedText,
      text,
    );
  });
  it("maps normalized boxes through the original tile, not its encoded dimensions", () => {
    assert.deepEqual(
      mapBox([100, 200, 300, 500], {
        x: 20,
        y: 1600,
        width: 1000,
        height: 2000,
      }),
      { x: 220, y: 1800, width: 300, height: 400 },
    );
  });
  it("merges overlap duplicates without removing repeated dialogue elsewhere", () => {
    const region = parseMangaResult(reply([row]))[0];
    const first = positionRegion(region, {
      index: 0,
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
    });
    const overlapping = { ...first, id: "1:a", tileIndex: 1 };
    const separate = {
      ...overlapping,
      id: "1:b",
      rect: { ...first.rect, y: 1000 },
    };
    assert.equal(mergeRegions([first], [overlapping, separate]).length, 2);
  });
});
describe("manga image geometry and source boundary", () => {
  it("covers a long strip at full width with overlap and no gaps", () => {
    const tiles = planTiles(1000, 12000);
    assert.ok(tiles.length > 1);
    assert.equal(tiles[0].y, 0);
    assert.equal(tiles.at(-1)!.y + tiles.at(-1)!.height, 12000);
    for (let i = 0; i < tiles.length; i++) {
      assert.equal(tiles[i].width, 1000);
      if (i)
        assert.ok(tiles[i].y <= tiles[i - 1].y + tiles[i - 1].height - 128);
    }
  });
  it("bounds pixel counts and rejects invalid dimensions", () => {
    for (const [w, h] of [
      [0, 100],
      [NaN, 200],
      [10000, 10000],
      [1.5, 100],
    ])
      assert.throws(() => planTiles(w, h));
    assert.equal(planTiles(1600, 2400).length, 1);
  });
  it("accounts for contain, cover, positioning and stretched image boxes", () => {
    const box = { x: 10, y: 20, width: 400, height: 400 };
    assert.deepEqual(imagePlacement(800, 400, box, "contain", "50% 50%"), {
      x: 10,
      y: 120,
      width: 400,
      height: 200,
    });
    assert.deepEqual(imagePlacement(800, 400, box, "cover", "100% 50%"), {
      x: -390,
      y: 20,
      width: 800,
      height: 400,
    });
    assert.deepEqual(imagePlacement(800, 400, box, "fill", "50% 50%"), box);
  });
  it("blocks unrelated local services, credentials and non-image URL schemes", () => {
    for (const url of [
      "http://localhost:8317/management.html",
      "http://127.0.0.1/x",
      "http://2130706433/x",
      "http://[::1]/x",
      "http://[::ffff:127.0.0.1]/x",
      "http://10.0.0.1/x",
      "file:///private",
      "https://user:pass@example.com/x",
    ])
      assert.equal(
        imageSourceAllowed(url, "https://reader.example"),
        false,
        url,
      );
    assert.equal(
      imageSourceAllowed(
        "https://cdn.example/page.png",
        "https://reader.example",
      ),
      true,
    );
    assert.equal(
      imageSourceAllowed(
        "http://localhost:8765/manga.png",
        "http://localhost:8765",
      ),
      true,
    );
  });
});
