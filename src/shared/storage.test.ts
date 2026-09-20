import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getDefaultSettings, getSettings, switchProviderSettings } from "./storage.ts";
import {
  DEFAULT_SELECTION_PROMPT,
  DEFAULT_PAGE_PROMPT,
  LEGACY_SELECTION_PROMPTS,
  LEGACY_PAGE_PROMPTS,
} from "./prompts.ts";
import { STORAGE_KEY } from "./constants.ts";

describe("prompt auto-upgrade", () => {
  it("upgrades legacy selection and page prompts to new defaults while preserving custom prompts", async () => {
    const memoryStore: Record<string, any> = {};
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: memoryStore[key] }),
          set: async (obj: Record<string, any>) => Object.assign(memoryStore, obj),
        },
      },
    };

    // 1. When saved with legacy prompt, getSettings auto-upgrades
    memoryStore[STORAGE_KEY] = {
      selectionPrompt: LEGACY_SELECTION_PROMPTS[0],
      pagePrompt: LEGACY_PAGE_PROMPTS[0],
    };
    const upgraded = await getSettings();
    assert.equal(upgraded.selectionPrompt, DEFAULT_SELECTION_PROMPT);
    assert.equal(upgraded.pagePrompt, DEFAULT_PAGE_PROMPT);

    // 2. When saved with a user-customized prompt, getSettings preserves it
    memoryStore[STORAGE_KEY] = {
      selectionPrompt: "My custom translation prompt",
      pagePrompt: "My custom page prompt",
    };
    const preserved = await getSettings();
    assert.equal(preserved.selectionPrompt, "My custom translation prompt");
    assert.equal(preserved.pagePrompt, "My custom page prompt");
  });
});

describe("provider configuration isolation", () => {
  it("restores destination headers and preserves source headers across round trips", () => {
    const initial = {
      ...getDefaultSettings(),
      customHeaders: { "X-Proxy-Token": "source-placeholder" },
      providerConfigs: {
        "google-gemini": {
          apiKey: "target-placeholder",
          customHeaders: { "X-Target": "target" },
        },
      },
    };
    const target = switchProviderSettings(initial, "google-gemini");
    assert.deepEqual(target.customHeaders, { "X-Target": "target" });
    assert.equal(target.apiKey, "target-placeholder");
    const back = switchProviderSettings(target, initial.providerId);
    assert.deepEqual(back.customHeaders, {
      "X-Proxy-Token": "source-placeholder",
    });
    assert.deepEqual(initial.customHeaders, {
      "X-Proxy-Token": "source-placeholder",
    });
  });

  it("does not forward headers into an unconfigured destination", () => {
    const initial = {
      ...getDefaultSettings(),
      customHeaders: { Authorization: "source-placeholder" },
    };
    const next = switchProviderSettings(initial, "google-gemini");
    assert.deepEqual(next.customHeaders, {});
    assert.equal(next.apiKey, "");
  });
});
