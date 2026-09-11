import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMangaEffortBody } from "./thinkingEffort.ts";
import type { UserProviderSettings } from "../types";

const makeProvider = (overrides: Partial<UserProviderSettings> = {}): UserProviderSettings => ({
  providerId: "custom-openai-compatible",
  providerName: "Custom",
  apiFormat: "openai-compatible",
  baseUrl: "https://api.example.com",
  endpoint: "/chat/completions",
  apiKey: "test-key",
  model: "gemini-3.8-flash-high",
  temperature: 0.2,
  timeoutMs: 30000,
  disableThinking: false,
  customHeaders: {},
  ...overrides,
});

describe("manga reasoning effort adapter", () => {
  it("defaults to low effort for Gemini models", () => {
    const provider = makeProvider({ model: "gemini-3.8-flash-high" });
    const body = buildMangaEffortBody(provider);
    assert.deepEqual(body, { reasoning_effort: "low" });
  });

  it("handles Gemini 3.8 effort levels correctly", () => {
    const provider = makeProvider({ model: "gemini-3.8-flash-high" });
    assert.deepEqual(buildMangaEffortBody(provider, "low"), { reasoning_effort: "low" });
    assert.deepEqual(buildMangaEffortBody(provider, "medium"), { reasoning_effort: "medium" });
    assert.deepEqual(buildMangaEffortBody(provider, "high"), { reasoning_effort: "high" });
    assert.deepEqual(buildMangaEffortBody(provider, "default"), {});
    // Gemini 3 models cannot turn off reasoning; safely clamps to low
    assert.deepEqual(buildMangaEffortBody(provider, "off"), { reasoning_effort: "low" });
  });

  it("handles Gemini 2.5 off mode", () => {
    const provider = makeProvider({ model: "gemini-2.5-flash" });
    assert.deepEqual(buildMangaEffortBody(provider, "off"), { reasoning_effort: "none" });
  });

  it("works with google-gemini providerId even without gemini in model name", () => {
    const provider = makeProvider({ providerId: "google-gemini", model: "custom-vision-router" });
    assert.deepEqual(buildMangaEffortBody(provider, "low"), { reasoning_effort: "low" });
  });

  it("never sends reasoning_effort to non-reasoning vision models like gpt-4o", () => {
    const gpt4o = makeProvider({ providerId: "custom-openai-compatible", model: "gpt-4o" });
    assert.deepEqual(buildMangaEffortBody(gpt4o, "low"), {});
    assert.deepEqual(buildMangaEffortBody(gpt4o, "high"), {});
    assert.deepEqual(buildMangaEffortBody(gpt4o, "default"), {});

    const claude = makeProvider({ providerId: "custom-openai-compatible", model: "claude-3-5-sonnet-20241022" });
    assert.deepEqual(buildMangaEffortBody(claude, "low"), {});
  });

  it("supports OpenAI o-series reasoning models", () => {
    const o3 = makeProvider({ providerId: "custom-openai-compatible", model: "o3-mini" });
    assert.deepEqual(buildMangaEffortBody(o3, "low"), { reasoning_effort: "low" });
    assert.deepEqual(buildMangaEffortBody(o3, "high"), { reasoning_effort: "high" });
    assert.deepEqual(buildMangaEffortBody(o3, "default"), {});
  });

  it("handles DeepSeek thinking parameters", () => {
    const ds = makeProvider({ providerId: "deepseek", model: "deepseek-chat" });
    assert.deepEqual(buildMangaEffortBody(ds, "off"), { thinking: { type: "disabled" } });
    assert.deepEqual(buildMangaEffortBody(ds, "high"), { thinking: { type: "enabled" }, reasoning_effort: "high" });
  });
});