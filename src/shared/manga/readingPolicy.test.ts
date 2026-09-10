import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MangaReadingGate,
  isNextNumberedImage,
  isNextMangaPage,
  mangaReadingScope,
  readingPageUrl,
  readingSessionAllows,
  READING_SESSION_MS,
} from "./readingPolicy.ts";

describe("bounded continuous-reading policy", () => {
  it("is scoped to the same numeric chapter and origin, not another comic", () => {
    assert.equal(
      mangaReadingScope("https://reader.test/g/1234/7/"),
      "https://reader.test/g/1234/*/",
    );
    assert.notEqual(
      mangaReadingScope("https://reader.test/g/1234/7/"),
      mangaReadingScope("https://reader.test/g/5555/7/"),
    );
    assert.notEqual(
      mangaReadingScope("https://reader.test/g/1234/7/"),
      mangaReadingScope("https://other.test/g/1234/7/"),
    );
  });
  it("keeps single-path canvas reader permission on that episode", () => {
    const page = "https://shonenjumpplus.com/episode/10834108156641784254";
    assert.equal(mangaReadingScope(page), page);
    assert.notEqual(mangaReadingScope(page), mangaReadingScope(page + "5"));
  });
  it("handles numbered query pages without discarding other query parameters", () => {
    assert.equal(
      mangaReadingScope("https://reader.test/view?book=27&page=2"),
      "https://reader.test/view?book=27&page=*",
    );
    assert.equal(
      isNextMangaPage(
        "https://reader.test/view?book=27&page=2",
        "https://reader.test/view?book=27&page=3",
      ),
      true,
    );
    assert.equal(
      isNextMangaPage(
        "https://reader.test/view?book=27&page=2",
        "https://reader.test/view?book=28&page=3",
      ),
      false,
    );
  });
  it("only accepts exactly one forward numeric step, not an arbitrary or previous link", () => {
    const from = "https://reader.test/reader/book/7/";
    for (const suffix of ["7/", "6/", "9/", "settings", "logout"])
      assert.equal(
        isNextMangaPage(from, "https://reader.test/reader/book/" + suffix),
        false,
      );
    assert.equal(
      isNextMangaPage(from, "https://reader.test/reader/book/8/"),
      true,
    );
  });
  it("rejects unsafe schemes and embedded credentials while ignoring in-page fragments", () => {
    for (const url of [
      "file:///x",
      "chrome://extensions",
      "javascript:alert(1)",
      "https://user:secret@reader.test/g/1/2/",
    ])
      assert.equal(readingPageUrl(url), null);
    assert.equal(
      readingPageUrl("https://reader.test/g/1/2/#a"),
      "https://reader.test/g/1/2/",
    );
  });
  it("expires and remains off without explicit per-tab consent", () => {
    const page = "https://reader.test/g/1/2/",
      now = 1000;
    const session = {
      enabled: true,
      prefetch: false,
      scope: mangaReadingScope(page)!,
      expires: now + READING_SESSION_MS,
    };
    assert.equal(readingSessionAllows(session, page, now), true);
    assert.equal(readingSessionAllows(session, page, session.expires), false);
    assert.equal(
      readingSessionAllows({ ...session, enabled: false }, page, now),
      false,
    );
    assert.equal(
      readingSessionAllows(session, "https://reader.test/g/2/2/", now),
      false,
    );
  });
  it("waits for stable layout rather than submitting intermediate turn animation frames", () => {
    const gate = new MangaReadingGate();
    assert.equal(gate.observe("page-a-at-0", 0), false);
    assert.equal(gate.observe("page-a-at-0", 590), false);
    assert.equal(gate.observe("page-a-at-3", 599), false);
    assert.equal(gate.observe("page-a-at-3", 900), false);
    assert.equal(gate.observe("page-a-at-3", 1200), true);
  });
  it("does not repeatedly retry a stable image but permits the next one", () => {
    const gate = new MangaReadingGate();
    gate.observe("first", 0);
    gate.mark("first");
    assert.equal(gate.observe("first", 10000), false);
    assert.equal(gate.observe("next", 10000), false);
    assert.equal(gate.observe("next", 11000), true);
    gate.reset();
    assert.equal(gate.observe("first", 12000), false);
    assert.equal(gate.observe("first", 13000), true);
  });
});

describe("loaded next-image evidence", () => {
  it("accepts exact adjacent image numbers already present in the reader", () => {
    assert.equal(
      isNextNumberedImage(
        "https://cdn.test/book/a-007.jpg",
        "https://cdn.test/book/a-008.jpg",
      ),
      true,
    );
  });
  it("rejects previous, skipped, unrelated and cross-origin image URLs", () => {
    for (const next of [
      "https://cdn.test/book/a-006.jpg",
      "https://cdn.test/book/a-009.jpg",
      "https://cdn.test/ads/a-008.jpg",
      "https://other.test/book/a-008.jpg",
      "https://cdn.test/book/a-008.png",
    ])
      assert.equal(
        isNextNumberedImage("https://cdn.test/book/a-007.jpg", next),
        false,
      );
  });
  it("does not guess order for opaque image keys", () => {
    assert.equal(
      isNextNumberedImage(
        "https://cdn.test/b9acd.png",
        "https://cdn.test/f13cd.png",
      ),
      false,
    );
    assert.equal(
      isNextNumberedImage(
        "blob:https://reader.test/123",
        "blob:https://reader.test/124",
      ),
      false,
    );
  });
});
