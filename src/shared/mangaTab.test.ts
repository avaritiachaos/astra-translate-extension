import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  openMangaPicker,
  translateCurrentMangaPage,
  isMangaPageUrl,
  MangaPageError,
  type MangaTabApi,
} from "./mangaTab.ts";

const tab = { id: 12, url: "https://shonenjumpplus.com/episode/example" };
function fixture(reply: (type: string) => unknown | Promise<unknown>) {
  const messages: Array<{ tabId: number; type: string; frameId: number }> = [];
  const injections: unknown[] = [];
  const api: MangaTabApi = {
    tabs: {
      async sendMessage(tabId, message, options) {
        const { type } = message as { type: string };
        messages.push({ tabId, type, frameId: options.frameId });
        return reply(type);
      },
    },
    scripting: {
      async executeScript(options) {
        injections.push(options);
      },
    },
  };
  return { api, messages, injections };
}
const healthy = (type: string) =>
  type === "MANGA_PING"
    ? { success: true, pickerVersion: 2 }
    : { success: true, pickerReady: true };
const failure = (code: string) => (error: unknown) =>
  error instanceof MangaPageError && error.code === code;

describe("manga popup and fullscreen entry", () => {
  it("checks the receiver before opening the picker and does not reinject a healthy page", async () => {
    const f = fixture(healthy);
    await openMangaPicker(tab, f.api);
    assert.deepEqual(f.messages, [
      { tabId: 12, type: "MANGA_PING", frameId: 0 },
      { tabId: 12, type: "MANGA_PICK_IMAGE", frameId: 0 },
    ]);
    assert.equal(f.injections.length, 0);
  });
  it("recovers a missing content receiver by injecting only the manga bundle", async () => {
    const f = fixture((type) => {
      if (!f.injections.length) throw Error("Receiving end does not exist");
      return healthy(type);
    });
    await openMangaPicker(tab, f.api);
    assert.deepEqual(f.injections, [
      { target: { tabId: 12, frameIds: [0] }, files: ["manga-content.js"] },
    ]);
    assert.equal(f.messages.at(-1)?.type, "MANGA_PICK_IMAGE");
  });
  it("upgrades a legacy listener that replies without the picker protocol", async () => {
    const f = fixture((type) =>
      f.injections.length ? healthy(type) : { success: true },
    );
    await openMangaPicker(tab, f.api);
    assert.equal(f.injections.length, 1);
  });
  it("recovers an old listener that keeps an unknown message channel open forever", async () => {
    const f = fixture((type) =>
      f.injections.length ? healthy(type) : new Promise(() => {}),
    );
    await openMangaPicker(tab, f.api, 10);
    assert.equal(f.injections.length, 1);
  });
  it("does not accept an early success response before the picker exists", async () => {
    const f = fixture((type) =>
      type === "MANGA_PING" ? healthy(type) : { success: true },
    );
    await assert.rejects(openMangaPicker(tab, f.api), failure("startFailed"));
  });
  it("reports initialization failure separately from unsupported pages", async () => {
    const f = fixture((type) =>
      type === "MANGA_PING"
        ? healthy(type)
        : { success: false, pickerReady: false },
    );
    await assert.rejects(openMangaPicker(tab, f.api), failure("startFailed"));
  });
  it("reports site access denial as a connection failure without repeated injection", async () => {
    const f = fixture(() => {
      throw Error("No receiver");
    });
    f.api.scripting.executeScript = async () => {
      throw Error("Cannot access contents of url");
    };
    await assert.rejects(openMangaPicker(tab, f.api), failure("unreachable"));
    assert.equal(f.messages.length, 1);
  });
  it("requires a live receiver after injection", async () => {
    const f = fixture(() => undefined);
    await assert.rejects(openMangaPicker(tab, f.api), failure("unreachable"));
    assert.equal(f.injections.length, 1);
    assert.deepEqual(
      f.messages.map((m) => m.type),
      ["MANGA_PING", "MANGA_PING"],
    );
  });
  it("bounds a picker reply that never arrives", async () => {
    const f = fixture((type) =>
      type === "MANGA_PING" ? healthy(type) : new Promise(() => {}),
    );
    await assert.rejects(
      openMangaPicker(tab, f.api, 10),
      failure("unreachable"),
    );
  });
  it("does not confuse a tab closing between probe and pick with an unsupported site", async () => {
    const f = fixture((type) => {
      if (type === "MANGA_PING") return healthy(type);
      throw Error("No tab with id");
    });
    await assert.rejects(openMangaPicker(tab, f.api), failure("unreachable"));
  });
  it("rejects restricted or missing pages before messaging or scripting", async () => {
    for (const target of [
      {},
      { id: 12 },
      { id: -1, url: tab.url },
      { id: 12.5, url: tab.url },
      ...[
        "chrome://extensions",
        "edge://settings",
        "about:blank",
        "file:///manga.html",
        "chrome-extension://test/popup.html",
        "https://chromewebstore.google.com/detail/test",
        "https://chrome.google.com/webstore/detail/test",
      ].map((url) => ({ id: 12, url })),
    ]) {
      const f = fixture(healthy);
      await assert.rejects(
        openMangaPicker(target, f.api),
        failure("unsupported"),
      );
      assert.equal(f.messages.length + f.injections.length, 0);
    }
  });
  it("allows ordinary manga URLs including an available tab id zero", async () => {
    for (const url of [
      "https://example.com/reader",
      "http://127.0.0.1:8080/manga",
      "https://chrome.google.com/something-else",
    ])
      assert.equal(isMangaPageUrl(url), true);
    const f = fixture(healthy);
    await openMangaPicker({ ...tab, id: 0 }, f.api);
    assert.equal(f.messages[0].tabId, 0);
  });
});

describe("current-image direct action", () => {
  it("sends the current action rather than opening the picker when pages are detected", async () => {
    const f = fixture((type) =>
      type === "MANGA_PING"
        ? healthy(type)
        : { success: true, currentStarted: true },
    );
    await translateCurrentMangaPage(tab, f.api);
    assert.deepEqual(
      f.messages.map((m) => m.type),
      ["MANGA_PING", "MANGA_TRANSLATE_CURRENT"],
    );
    assert.equal(f.injections.length, 0);
  });
  it("accepts explicit picker fallback when no current image can be detected", async () => {
    const f = fixture(healthy);
    await translateCurrentMangaPage(tab, f.api);
    assert.equal(f.messages.at(-1)?.type, "MANGA_TRANSLATE_CURRENT");
  });
  it("does not accept an acknowledgment without either start or picker readiness", async () => {
    const f = fixture((type) =>
      type === "MANGA_PING" ? healthy(type) : { success: true },
    );
    await assert.rejects(
      translateCurrentMangaPage(tab, f.api),
      failure("startFailed"),
    );
  });
  it("upgrades the prior protocol before sending a new direct action", async () => {
    const f = fixture((type) =>
      !f.injections.length
        ? { success: true, pickerVersion: 1 }
        : type === "MANGA_PING"
          ? healthy(type)
          : { success: true, currentStarted: true },
    );
    await translateCurrentMangaPage(tab, f.api);
    assert.equal(f.injections.length, 1);
  });
});
