import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRequestParts } from "./openAICompatibleClient.ts";
import type { UserProviderSettings } from "../shared/types.ts";

const BASE_SETTINGS: UserProviderSettings = {
  providerId: "google-gemini",
  providerName: "Google Gemini (AI Studio)",
  apiFormat: "openai-compatible",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  endpoint: "/chat/completions",
  model: "gemini-3.7-flash",
  apiKey: "test-api-key",
  temperature: 0.3,
  disableThinking: false,
  timeoutMs: 30000,
};

describe("openAICompatibleClient buildRequestParts", () => {
  it("disables reasoning_effort by default for Google Gemini translation requests", () => {
    const parts = buildRequestParts(
      BASE_SETTINGS,
      [{ role: "user", content: "Translate this" }],
      false,
      "zh-CN"
    );

    assert.equal(parts.body.reasoning_effort, "none");
    assert.deepEqual(parts.optionalKeys, ["reasoning_effort"]);
  });

  it("disables thinking for DeepSeek translation requests", () => {
    const parts = buildRequestParts(
      {
        ...BASE_SETTINGS,
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
      },
      [{ role: "user", content: "Translate this" }],
      false,
      "zh-CN"
    );

    assert.deepEqual(parts.body.thinking, { type: "disabled" });
    assert.deepEqual(parts.optionalKeys, ["thinking"]);
  });

  it("respects extra.optionalBody for Chat requests without overriding", () => {
    const parts = buildRequestParts(
      BASE_SETTINGS,
      [{ role: "user", content: "Chat question" }],
      true,
      "zh-CN",
      { optionalBody: { reasoning_effort: "high" } }
    );

    assert.equal(parts.body.reasoning_effort, "high");
    assert.deepEqual(parts.optionalKeys, ["reasoning_effort"]);
  });

  it("disables reasoning_effort for custom provider when disableThinking is true", () => {
    const parts = buildRequestParts(
      {
        ...BASE_SETTINGS,
        providerId: "custom-openai-compatible",
        disableThinking: true,
      },
      [{ role: "user", content: "Translate this" }],
      false,
      "zh-CN"
    );

    assert.equal(parts.body.reasoning_effort, "none");
    assert.deepEqual(parts.optionalKeys, ["reasoning_effort"]);
  });
});
