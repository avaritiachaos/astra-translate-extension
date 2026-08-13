import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildEffortBody,
  normalizeChatEffort,
  CHAT_EFFORTS,
  DEFAULT_CHAT_EFFORT,
} from "./chatEffort.ts";

describe("normalizeChatEffort", () => {
  it("exposes exactly the three official chat modes", () => {
    assert.deepEqual(CHAT_EFFORTS, ["off", "high", "max"]);
  });

  it("passes through DeepSeek's official values", () => {
    for (const level of CHAT_EFFORTS) {
      assert.equal(normalizeChatEffort(level), level);
    }
  });

  it("maps legacy level names so stored sessions keep working", () => {
    assert.equal(normalizeChatEffort("disabled"), "off");
    assert.equal(normalizeChatEffort("fast"), "high");
    assert.equal(normalizeChatEffort("balanced"), "high");
    assert.equal(normalizeChatEffort("low"), "high");
    assert.equal(normalizeChatEffort("deep"), "max");
    assert.equal(normalizeChatEffort("xhigh"), "max");
  });

  it("falls back to the default for anything else", () => {
    for (const raw of [undefined, null, "", "medium", 3, {}, []]) {
      assert.equal(normalizeChatEffort(raw), DEFAULT_CHAT_EFFORT);
    }
  });

  it("keeps the existing high default", () => {
    assert.equal(DEFAULT_CHAT_EFFORT, "high");
  });
});

describe("buildEffortBody", () => {
  it("disables thinking without sending an effort value", () => {
    assert.deepEqual(buildEffortBody("off"), {
      thinking: { type: "disabled" },
    });
  });

  it("sends DeepSeek's official value without translation", () => {
    for (const level of CHAT_EFFORTS.filter((value) => value !== "off")) {
      assert.deepEqual(buildEffortBody(level), {
        reasoning_effort: level,
        thinking: { type: "enabled" },
      });
    }
  });
});
