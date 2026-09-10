import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveReadingPage } from "./readingContext.ts";
import { mangaReadingScope, readingSessionAllows } from "./readingPolicy.ts";
const oldPage = "https://reader.test/g/234/1/";
const newPage = "https://reader.test/g/234/2/";
const sender = { frameId: 0, url: oldPage, tab: { id: 7, url: newPage } };
const tab = { id: 7, url: newPage };

describe("reading message current-page context", () => {
  it("accepts a normal top-frame page without any URL change", () => {
    assert.equal(resolveReadingPage({ ...sender, url: newPage }, tab), newPage);
  });
  it("accepts the actual Chrome pushState sender shape with an old document URL", () => {
    assert.equal(resolveReadingPage(sender, tab), newPage);
  });
  it("uses the live query page after replaceState and ignores harmless fragments", () => {
    const current = "https://reader.test/view?book=1&page=3";
    assert.equal(
      resolveReadingPage(
        {
          frameId: 0,
          url: "https://reader.test/view?book=1&page=1",
          tab: { id: 7, url: current + "#caption" },
        },
        { id: 7, url: current },
      ),
      current,
    );
  });
  it("rejects a queued message from an older page after the tab moved again", () => {
    assert.equal(
      resolveReadingPage(sender, {
        ...tab,
        url: "https://reader.test/g/234/3/",
      }),
      null,
    );
  });
  it("does not let an iframe use the top-frame tab URL as its own authority", () => {
    assert.equal(resolveReadingPage({ ...sender, frameId: 2 }, tab), null);
    assert.equal(
      resolveReadingPage({ ...sender, frameId: undefined }, tab),
      null,
    );
  });
  it("rejects a different tab or a cross-origin document", () => {
    assert.equal(resolveReadingPage(sender, { ...tab, id: 8 }), null);
    assert.equal(
      resolveReadingPage(
        { ...sender, url: "https://other.test/g/234/1/" },
        tab,
      ),
      null,
    );
  });
  it("resolves the current comic so old consent cannot leak after SPA navigation to another comic", () => {
    const current = "https://reader.test/g/999/2/";
    const page = resolveReadingPage(
      { ...sender, tab: { id: 7, url: current } },
      { id: 7, url: current },
    );
    assert.equal(page, current);
    assert.equal(
      readingSessionAllows(
        {
          enabled: true,
          prefetch: true,
          scope: mangaReadingScope(oldPage)!,
          expires: Date.now() + 1000,
        },
        page!,
      ),
      false,
    );
  });
  it("can use a matching sender URL if the tab snapshot has no URL", () => {
    assert.equal(
      resolveReadingPage({ frameId: 0, url: newPage, tab: { id: 7 } }, tab),
      newPage,
    );
  });
  it("does not accept missing or restricted URLs", () => {
    assert.equal(resolveReadingPage({ ...sender, url: undefined }, tab), null);
    assert.equal(resolveReadingPage(sender, { id: 7 }), null);
    assert.equal(
      resolveReadingPage(
        {
          frameId: 0,
          url: "file:///page",
          tab: { id: 7, url: "file:///page" },
        },
        { id: 7, url: "file:///page" },
      ),
      null,
    );
  });
});
