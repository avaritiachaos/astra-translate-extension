import { it } from "node:test";
import assert from "node:assert/strict";
import { setCachedTranslations } from "./translationCache.ts";
import { getDefaultSettings } from "../shared/storage.ts";
it("optional cache write failure does not reject an already completed translation", async (ctx) => {
  const previous = (globalThis as any).chrome;
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {
          throw new Error("Quota exceeded");
        },
      },
    },
  };
  ctx.after(() => {
    (globalThis as any).chrome = previous;
  });
  const warn = ctx.mock.method(console, "warn", () => {});
  await setCachedTranslations(
    [{ key: "example", value: { translation: "translated" } }],
    { ...getDefaultSettings(), enableTranslationCache: true },
  );
  assert.equal(warn.mock.callCount(), 1);
});
it("bounds serialized cache bytes while retaining a usable recent result", async (ctx) => {
  const previous = (globalThis as any).chrome;
  let saved: any;
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: async (value: unknown) => {
          saved = value;
        },
      },
    },
  };
  ctx.after(() => {
    (globalThis as any).chrome = previous;
  });
  await setCachedTranslations(
    Array.from({ length: 100 }, (_, i) => ({
      key: String(i),
      value: { translation: "a".repeat(100000) },
    })),
    { ...getDefaultSettings(), enableTranslationCache: true },
  );
  assert.ok(Buffer.byteLength(JSON.stringify(saved)) < 4 * 1024 * 1024 + 100);
  assert.ok(Object.values(saved)[0]);
});
