import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildEffortBody,
  normalizeChatEffort,
  getChatEffortsForProvider,
  DEEPSEEK_EFFORTS,
  GEMINI_EFFORTS,
} from "./chatEffort.ts";

describe("getChatEffortsForProvider", () => {
  it("returns DeepSeek specific effort levels", () => {
    assert.deepEqual(getChatEffortsForProvider("deepseek"), DEEPSEEK_EFFORTS);
    assert.deepEqual(DEEPSEEK_EFFORTS, ["off", "high", "max"]);
  });

  it("returns Google Gemini specific effort levels", () => {
    assert.deepEqual(getChatEffortsForProvider("google-gemini"), GEMINI_EFFORTS);
    assert.deepEqual(GEMINI_EFFORTS, ["off", "low", "medium", "high"]);
  });
});

describe("normalizeChatEffort", () => {
  it("passes through DeepSeek official values", () => {
    for (const level of DEEPSEEK_EFFORTS) {
      assert.equal(normalizeChatEffort(level, "deepseek"), level);
    }
  });

  it("passes through Gemini official values", () => {
    for (const level of GEMINI_EFFORTS) {
      assert.equal(normalizeChatEffort(level, "google-gemini"), level);
    }
  });

  it("adapts cross-provider values appropriately", () => {
    assert.equal(normalizeChatEffort("max", "google-gemini"), "high");
    assert.equal(normalizeChatEffort("medium", "deepseek"), "high");
    assert.equal(normalizeChatEffort("low", "deepseek"), "high");
  });

  it("falls back to provider default for invalid values", () => {
    assert.equal(normalizeChatEffort(undefined, "deepseek"), "high");
    assert.equal(normalizeChatEffort(undefined, "google-gemini"), "medium");
  });
});

describe("buildEffortBody", () => {
  it("disables thinking for DeepSeek", () => {
    assert.deepEqual(buildEffortBody("off", "deepseek"), {
      thinking: { type: "disabled" },
    });
  });

  it("sends DeepSeek official values", () => {
    assert.deepEqual(buildEffortBody("high", "deepseek"), {
      reasoning_effort: "high",
      thinking: { type: "enabled" },
    });
    assert.deepEqual(buildEffortBody("max", "deepseek"), {
      reasoning_effort: "max",
      thinking: { type: "enabled" },
    });
  });

  it("sends Google Gemini reasoning_effort parameters", () => {
    assert.deepEqual(buildEffortBody("off", "google-gemini"), {
      reasoning_effort: "none",
    });
    assert.deepEqual(buildEffortBody("low", "google-gemini"), {
      reasoning_effort: "low",
    });
    assert.deepEqual(buildEffortBody("medium", "google-gemini"), {
      reasoning_effort: "medium",
    });
    assert.deepEqual(buildEffortBody("high", "google-gemini"), {
      reasoning_effort: "high",
    });
  });
});
