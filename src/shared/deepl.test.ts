import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chunkDeeplTexts,
  deeplSourceCode,
  deeplTargetCode,
  joinDeeplSegments,
  resolveDeeplBase,
  splitDeeplSegments,
} from "./deepl.ts";
import { PAGE_SEGMENT_SEPARATOR } from "./constants.ts";

describe("resolveDeeplBase", () => {
  it("free keys (:fx) stay on the free host", () => {
    assert.equal(
      resolveDeeplBase("abc123:fx", "https://api-free.deepl.com/v2"),
      "https://api-free.deepl.com/v2",
    );
  });

  it("pro keys on the default free host are re-pointed to the pro host", () => {
    assert.equal(
      resolveDeeplBase("abc123", "https://api-free.deepl.com/v2"),
      "https://api.deepl.com/v2",
    );
  });

  it("free keys entered with the pro host are re-pointed to the free host", () => {
    assert.equal(
      resolveDeeplBase("abc:fx", "https://api.deepl.com/v2"),
      "https://api-free.deepl.com/v2",
    );
  });

  it("a custom proxy base URL wins over key-suffix rewriting", () => {
    assert.equal(
      resolveDeeplBase("abc:fx", "https://proxy.example.com/deepl/"),
      "https://proxy.example.com/deepl",
    );
  });

  it("blank base falls back by key suffix", () => {
    assert.equal(resolveDeeplBase("k:fx", ""), "https://api-free.deepl.com/v2");
    assert.equal(resolveDeeplBase("k", ""), "https://api.deepl.com/v2");
  });
});

describe("deeplTargetCode", () => {
  it("maps the supported target languages", () => {
    assert.equal(deeplTargetCode("Simplified Chinese"), "ZH");
    assert.equal(deeplTargetCode("English"), "EN");
    assert.equal(deeplTargetCode("Japanese"), "JA");
    assert.equal(deeplTargetCode("Portuguese"), "PT-BR");
    assert.equal(deeplTargetCode("Indonesian"), "ID");
  });

  it("attempts ZH-HANT for Traditional Chinese (error surfaced on 400)", () => {
    assert.equal(deeplTargetCode("Traditional Chinese"), "ZH-HANT");
  });

  it("returns null for unknown languages", () => {
    assert.equal(deeplTargetCode("Klingon"), null);
    assert.equal(deeplTargetCode(""), null);
  });
});

describe("deeplSourceCode", () => {
  it("maps known sources and strips regions", () => {
    assert.equal(deeplSourceCode("Portuguese"), "PT");
    assert.equal(deeplSourceCode("English"), "EN");
  });

  it("returns undefined for auto/unknown", () => {
    assert.equal(deeplSourceCode("Auto"), undefined);
    assert.equal(deeplSourceCode(undefined), undefined);
    assert.equal(deeplSourceCode("Klingon"), undefined);
  });
});

describe("segment split/join", () => {
  it("round-trips U+E000-joined fragments", () => {
    const sep = PAGE_SEGMENT_SEPARATOR;
    const original = ["第一章", "第二章", "第三章"].join(sep);
    const parts = splitDeeplSegments(original, sep);
    assert.deepEqual(parts, ["第一章", "第二章", "第三章"]);
    assert.equal(joinDeeplSegments(["一", "二", "三"], sep), `一${sep}二${sep}三`);
  });

  it("items without the separator stay a single fragment", () => {
    assert.deepEqual(splitDeeplSegments("hello", PAGE_SEGMENT_SEPARATOR), ["hello"]);
  });
});

describe("chunkDeeplTexts", () => {
  it("keeps every text and its index", () => {
    const texts = Array.from({ length: 120 }, (_, i) => `t${i}`);
    const chunks = chunkDeeplTexts(texts);
    assert.equal(chunks.length, 3); // 50 + 50 + 20
    const flat = chunks.flatMap((c) => c.indices);
    assert.deepEqual(
      flat,
      Array.from({ length: 120 }, (_, i) => i),
    );
    for (const chunk of chunks) {
      assert.ok(chunk.texts.length <= 50);
      assert.deepEqual(
        chunk.texts,
        chunk.indices.map((i) => texts[i]),
      );
    }
  });

  it("splits before the byte budget is exceeded", () => {
    const big = "x".repeat(60 * 1024);
    const chunks = chunkDeeplTexts([big, big], 50, 96 * 1024);
    assert.equal(chunks.length, 2);
    assert.deepEqual(chunks[0].indices, [0]);
    assert.deepEqual(chunks[1].indices, [1]);
  });

  it("a single oversized entry still ships alone", () => {
    const huge = "y".repeat(200 * 1024);
    const chunks = chunkDeeplTexts([huge], 50, 96 * 1024);
    assert.equal(chunks.length, 1);
    assert.deepEqual(chunks[0].texts, [huge]);
  });

  it("returns an empty list for empty input", () => {
    assert.deepEqual(chunkDeeplTexts([]), []);
  });
});
