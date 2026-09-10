import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listProviderModels, parseProviderModels } from "./providerModels.ts";
import type { UserProviderSettings } from "../shared/types.ts";
const provider: UserProviderSettings = {
  providerId: "custom-openai-compatible", providerName: "Fixture CPA", apiFormat: "openai-compatible",
  baseUrl: "http://127.0.0.1:8317/v1/", endpoint: "/chat/completions", apiKey: "fixture-client-key",
  model: "", temperature: 0.2, timeoutMs: 1000, disableThinking: false,
  customHeaders: { "X-Proxy-Token": "fixture-proxy-header" },
};
describe("provider model discovery", () => {
  it("keeps exact model ids, including CPA suffixes, and removes duplicates", () => {
    assert.deepEqual(parseProviderModels({ data: [{ id: "gemini-3.8-flash-high" }, { id: "gemini-3-flash" }, { id: "gemini-3.8-flash-high" }] }),
      ["gemini-3-flash", "gemini-3.8-flash-high"]);
  });
  it("rejects malformed payloads and filters invalid ids", () => {
    assert.throws(() => parseProviderModels({ models: [] }));
    assert.deepEqual(parseProviderModels({ data: [null, {}, { id: 3 }, { id: "" }, { id: " bad " }, { id: "a\nkey" }, { id: "x".repeat(201) }, { id: "valid/vision-model" }] }), ["valid/vision-model"]);
  });
  it("uses the selected provider URL and credentials without a model or image request", async ctx => {
    ctx.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      assert.equal(url, "http://127.0.0.1:8317/v1/models");
      assert.equal(init.method, "GET");
      assert.equal(init.body, undefined);
      assert.equal(init.redirect, "error");
      assert.equal((init.headers as Record<string,string>).Authorization, "Bearer fixture-client-key");
      assert.equal((init.headers as Record<string,string>)["X-Proxy-Token"], "fixture-proxy-header");
      assert.ok(init.signal instanceof AbortSignal);
      return Response.json({ data: [{ id: "gemini-3.8-flash-high" }] });
    });
    assert.deepEqual(await listProviderModels(provider, "en-US"), { success: true, models: ["gemini-3.8-flash-high"] });
  });
  it("does not echo upstream errors or provider secrets", async ctx => {
    ctx.mock.method(globalThis, "fetch", async () => new Response("fixture-client-key fixture-proxy-header", { status: 401 }));
    const result = await listProviderModels(provider, "en-US");
    assert.equal(result.success, false);
    assert.match(result.error!, /401/);
    assert.equal(JSON.stringify(result).includes("fixture-client-key"), false);
    assert.equal(JSON.stringify(result).includes("fixture-proxy-header"), false);
  });
  it("handles empty lists and malformed JSON without claiming a model is available", async ctx => {
    const mock = ctx.mock.method(globalThis, "fetch", async () => Response.json({ data: [] }));
    assert.equal((await listProviderModels(provider, "en-US")).success, false);
    mock.mock.mockImplementation(async () => new Response("not json"));
    assert.equal((await listProviderModels(provider, "en-US")).success, false);
  });
  it("bounds response size", async ctx => {
    ctx.mock.method(globalThis, "fetch", async () => new Response(" ".repeat(512 * 1024 + 1)));
    assert.equal((await listProviderModels(provider, "en-US")).success, false);
  });
  it("reports network/timeout errors without leaking connection details", async ctx => {
    ctx.mock.method(globalThis, "fetch", async () => { throw Error("fixture-client-key"); });
    const result = await listProviderModels(provider, "en-US");
    assert.equal(result.success, false);
    assert.equal(JSON.stringify(result).includes("fixture-client-key"), false);
  });
});
