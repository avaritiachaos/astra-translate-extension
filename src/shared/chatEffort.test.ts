import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildEffortBody,
  effortPromptSuffix,
  normalizeChatEffort,
  DEFAULT_CHAT_EFFORT,
} from "./chatEffort.ts";

describe("normalizeChatEffort", () => {
  it("passes through known levels", () => {
    assert.equal(normalizeChatEffort("fast"), "fast");
    assert.equal(normalizeChatEffort("balanced"), "balanced");
    assert.equal(normalizeChatEffort("deep"), "deep");
  });

  it("falls back to the default for anything else", () => {
    for (const raw of [undefined, null, "", "high", 3, {}, []]) {
      assert.equal(normalizeChatEffort(raw), DEFAULT_CHAT_EFFORT);
    }
  });
});

describe("buildEffortBody", () => {
  it("sends nothing at all for balanced", () => {
    assert.deepEqual(buildEffortBody("balanced"), {});
    assert.deepEqual(buildEffortBody("balanced", "deepseek"), {});
  });

  it("asks for low reasoning on fast", () => {
    assert.deepEqual(buildEffortBody("fast", "custom-openai-compatible"), {
      reasoning_effort: "low",
    });
  });

  it("keeps DeepSeek's own thinking switch on fast", () => {
    assert.deepEqual(buildEffortBody("fast", "deepseek"), {
      reasoning_effort: "low",
      thinking: { type: "disabled" },
    });
  });

  it("asks for high reasoning on deep, without the thinking switch", () => {
    assert.deepEqual(buildEffortBody("deep", "deepseek"), {
      reasoning_effort: "high",
    });
  });
});

describe("effortPromptSuffix", () => {
  it("is empty for balanced so the prompt is untouched", () => {
    assert.equal(effortPromptSuffix("balanced"), "");
  });

  it("steers the model on fast and deep, so levels work without params", () => {
    assert.match(effortPromptSuffix("fast"), /briefly and directly/);
    assert.match(effortPromptSuffix("deep"), /carefully before answering/);
    assert.notEqual(effortPromptSuffix("fast"), effortPromptSuffix("deep"));
  });
});
