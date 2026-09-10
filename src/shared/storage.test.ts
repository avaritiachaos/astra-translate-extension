import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getDefaultSettings, switchProviderSettings } from "./storage.ts";

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
