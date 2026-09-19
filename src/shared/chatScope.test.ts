import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chatScopeForSender,
  boundChatHistory,
  writeChatSession,
  getDraftStorageKey,
} from "./chatScope.ts";
import { CHAT_STORAGE_KEY, CHAT_DRAFT_STORAGE_KEY } from "./types.ts";

describe("chat document privacy", () => {
  const sender = {
    id: "astra",
    url: "https://a.example/book",
    tab: { id: 7 },
    documentId: "doc-a",
    frameId: 0,
  };
  it("keeps private extension chat separate from each page document", () => {
    const page = chatScopeForSender(sender, "astra");
    assert.notEqual(page, CHAT_STORAGE_KEY);
    assert.notEqual(
      page,
      chatScopeForSender({ ...sender, documentId: "doc-b" }, "astra"),
    );
    assert.equal(
      chatScopeForSender(
        { id: "astra", url: "chrome-extension://astra/popup.html" },
        "astra",
      ),
      CHAT_STORAGE_KEY,
    );
  });
  it("rejects other extensions, invalid senders and non-web documents", () => {
    assert.equal(chatScopeForSender({ ...sender, id: "other" }, "astra"), null);
    assert.equal(
      chatScopeForSender({ ...sender, url: "file:///private" }, "astra"),
      null,
    );
    assert.equal(chatScopeForSender(undefined, "astra"), null);
  });
  it("separates origins and frames when documentId is unavailable", () => {
    const a = { ...sender, documentId: undefined };
    assert.notEqual(
      chatScopeForSender(a, "astra"),
      chatScopeForSender({ ...a, url: "https://b.example" }, "astra"),
    );
    assert.notEqual(
      chatScopeForSender(a, "astra"),
      chatScopeForSender({ ...a, frameId: 1 }, "astra"),
    );
  });
  it("bounds history by size while preserving the latest exchange", () => {
    const turns = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 ? ("assistant" as const) : ("user" as const),
      content: "x".repeat(8000) + i,
      ts: i,
    }));
    const state = boundChatHistory({ turns, pending: false, gen: 2 });
    assert.ok(JSON.stringify(state).length <= 100000);
    assert.equal(state.turns.at(-1)?.ts, 59);
    assert.equal(state.turns.length % 2, 0);
    assert.equal(turns.length, 60);
  });
  it("evicts only idle page sessions and preserves unrelated session storage", async (ctx) => {
    const values: Record<string, any> = {
      unrelated: "keep",
      [CHAT_STORAGE_KEY]: { turns: [], pending: false, gen: 0 },
    };
    for (let i = 0; i < 18; i++)
      values[CHAT_STORAGE_KEY + ":" + i] = {
        turns: [],
        pending: i === 0,
        gen: 0,
        updatedAt: i,
      };
    const previous = (globalThis as any).chrome;
    (globalThis as any).chrome = {
      storage: {
        session: {
          get: async () => structuredClone(values),
          remove: async (keys: string[]) =>
            keys.forEach((k) => delete values[k]),
          set: async (next: object) => Object.assign(values, next),
        },
      },
    };
    ctx.after(() => {
      (globalThis as any).chrome = previous;
    });
    await writeChatSession(CHAT_STORAGE_KEY + ":new", {
      turns: [],
      pending: false,
      gen: 0,
    });
    assert.equal(values.unrelated, "keep");
    assert.ok(values[CHAT_STORAGE_KEY]);
    assert.ok(values[CHAT_STORAGE_KEY + ":0"]);
    assert.equal(
      Object.keys(values).filter((k) => k.startsWith(CHAT_STORAGE_KEY)).length,
      16,
    );
  });
  it("derives matching draft storage keys for popup and per-page scopes", () => {
    assert.equal(getDraftStorageKey(), CHAT_DRAFT_STORAGE_KEY);
    assert.equal(getDraftStorageKey(CHAT_STORAGE_KEY), CHAT_DRAFT_STORAGE_KEY);
    assert.equal(getDraftStorageKey(null), CHAT_DRAFT_STORAGE_KEY);
    assert.equal(
      getDraftStorageKey(CHAT_STORAGE_KEY + ":7:doc-a"),
      CHAT_DRAFT_STORAGE_KEY + ":7:doc-a"
    );
  });
});

