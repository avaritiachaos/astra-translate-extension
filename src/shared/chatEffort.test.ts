import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildEffortBody,
  effortPromptSuffix,
  normalizeChatEffort,
  CHAT_EFFORTS,
  DEFAULT_CHAT_EFFORT,
} from "./chatEffort.ts";

describe("normalizeChatEffort", () => {
  it("passes through DeepSeek's four request values", () => {
    for (const level of CHAT_EFFORTS) {
      assert.equal(normalizeChatEffort(level), level);
    }
  });

  it("maps pre-4.8.1 level names so stored sessions keep working", () => {
    assert.equal(normalizeChatEffort("fast"), "low");
    assert.equal(normalizeChatEffort("balanced"), "high");
    assert.equal(normalizeChatEffort("deep"), "xhigh");
  });

  it("falls back to the default for anything else", () => {
    for (const raw of [undefined, null, "", "medium", 3, {}, []]) {
      assert.equal(normalizeChatEffort(raw), DEFAULT_CHAT_EFFORT);
    }
  });

  it("defaults to high, matching DeepSeek's own default", () => {
    assert.equal(DEFAULT_CHAT_EFFORT, "high");
  });
});

describe("buildEffortBody", () => {
  it("sends DeepSeek its own vocabulary verbatim", () => {
    // The provider maps the request value onto the model's real effort
    // per model, so we must not pre-collapse xhigh/max ourselves.
    for (const level of CHAT_EFFORTS) {
      assert.deepEqual(buildEffortBody(level, "deepseek"), {
        reasoning_effort: level,
        thinking: { type: "enabled" },
      });
    }
  });

  it("translates to the standard vocabulary for other endpoints", () => {
    const generic = "custom-openai-compatible";
    assert.deepEqual(buildEffortBody("low", generic), { reasoning_effort: "low" });
    assert.deepEqual(buildEffortBody("high", generic), { reasoning_effort: "medium" });
    assert.deepEqual(buildEffortBody("xhigh", generic), { reasoning_effort: "high" });
    assert.deepEqual(buildEffortBody("max", generic), { reasoning_effort: "high" });
  });

  it("never sends xhigh/max to a non-DeepSeek endpoint", () => {
    for (const level of CHAT_EFFORTS) {
      const body = buildEffortBody(level, "custom-openai-compatible");
      assert.ok(["low", "medium", "high"].includes(body.reasoning_effort as string));
      assert.equal("thinking" in body, false);
    }
  });
});

describe("effortPromptSuffix", () => {
  it("is empty at the default level so the prompt is untouched", () => {
    assert.equal(effortPromptSuffix("high"), "");
  });

  it("steers the model at the extremes, so levels work without params", () => {
    assert.match(effortPromptSuffix("low"), /briefly and directly/);
    assert.match(effortPromptSuffix("xhigh"), /carefully before answering/);
    assert.match(effortPromptSuffix("max"), /carefully before answering/);
    assert.notEqual(effortPromptSuffix("low"), effortPromptSuffix("max"));
  });
});
