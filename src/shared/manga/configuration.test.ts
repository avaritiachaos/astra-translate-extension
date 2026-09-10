import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveMangaConfiguration } from "./configuration.ts";
import { getDefaultSettings, getSettings, switchProviderSettings } from "../storage.ts";
import { STORAGE_KEY } from "../constants.ts";
import type { AstraSettings } from "../types";

function configured(): AstraSettings {
  return {
    ...getDefaultSettings(),
    manga: { providerId: "current", modelId: "fixture-vision", targetLanguage: "Simplified Chinese" },
    providerId: "google-gemini",
    providerName: "Google Gemini (AI Studio)",
    apiKey: "active-test-key",
    baseUrl: "https://proxy.example.test/v1?unused=not-for-display",
    endpoint: "/chat/completions",
    model: "chat-model-not-the-vision-model",
    customHeaders: { "X-Proxy-Token": "active-test-header" },
    providerConfigs: {},
  };
}
async function readSaved(saved: Partial<AstraSettings>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: { storage: { local: { async get() { return { [STORAGE_KEY]: saved }; } } } },
  });
  try { return await getSettings(); }
  finally {
    if (previous) Object.defineProperty(globalThis, "chrome", previous);
    else Reflect.deleteProperty(globalThis, "chrome");
  }
}

describe("manga provider configuration", () => {
  it("defaults to reusing the current provider, not an empty custom-provider slot", () => {
    assert.equal(getDefaultSettings().manga.providerId, "current");
    const settings = configured(), { status, provider } = resolveMangaConfiguration(settings);
    assert.equal(status.ready, true);
    assert.equal(status.followsCurrent, true);
    assert.equal(status.providerId, settings.providerId);
    assert.equal(provider.apiKey, "active-test-key");
    assert.equal(provider.baseUrl, settings.baseUrl);
    assert.deepEqual(provider.customHeaders, settings.customHeaders);
    assert.equal(status.modelId, "fixture-vision");
  });
  it("reuses an existing configuration when upgrading settings with no manga section", async () => {
    const saved: Partial<AstraSettings> = configured();
    delete saved.manga;
    const migrated = await readSaved(saved);
    const { status } = resolveMangaConfiguration(migrated);
    assert.equal(status.errorCode, "MANGA_SETTINGS_INVALID");
    assert.equal(status.modelId, "");
    assert.equal(status.providerId, "google-gemini");
    assert.equal(resolveMangaConfiguration(migrated, { requireModel: false }).status.ready, true);
    assert.equal(migrated.apiKey, saved.apiKey);
    assert.equal(migrated.baseUrl, saved.baseUrl);
    assert.equal(saved.manga, undefined);
  });
  it("does not silently migrate a saved explicit provider, even if it is empty", async () => {
    const saved = configured();
    saved.manga.providerId = "custom-openai-compatible";
    const migrated = await readSaved(saved);
    const { status, provider } = resolveMangaConfiguration(migrated);
    assert.equal(migrated.manga.providerId, "custom-openai-compatible");
    assert.equal(status.ready, false);
    assert.equal(status.errorCode, "API_KEY_MISSING");
    assert.match(status.error!, /Custom OpenAI-compatible/);
    assert.equal(provider.apiKey, "");
    assert.deepEqual(provider.customHeaders, {});
  });
  it("uses the active top-level key/URL/headers instead of stale saved copies", () => {
    const settings = configured();
    settings.manga.providerId = settings.providerId;
    settings.providerConfigs = { [settings.providerId]: { apiKey: "", baseUrl: "https://stale.example.test", customHeaders: {} } };
    const { provider, status } = resolveMangaConfiguration(settings);
    assert.equal(status.ready, true);
    assert.equal(provider.apiKey, settings.apiKey);
    assert.equal(provider.baseUrl, settings.baseUrl);
    assert.deepEqual(provider.customHeaders, settings.customHeaders);
  });
  it("does not resurrect a deleted active key from a stale provider snapshot", () => {
    const settings = configured();
    settings.apiKey = "";
    settings.providerConfigs = { [settings.providerId]: { apiKey: "revoked-test-key" } };
    const { provider, status } = resolveMangaConfiguration(settings);
    assert.equal(status.errorCode, "API_KEY_MISSING");
    assert.equal(provider.apiKey, "");
  });
  it("does not silently choose a destination for malformed explicit provider values", () => {
    for (const providerId of ["", 123, null, undefined]) {
      const settings = configured();
      settings.manga.providerId = providerId as unknown as string;
      const { status } = resolveMangaConfiguration(settings);
      assert.equal(status.errorCode, "MANGA_PROVIDER_INVALID");
      assert.equal(status.followsCurrent, false);
    }
  });
  it("reuses a pinned secondary provider as a unit without leaking the active credentials", () => {
    const settings = configured();
    settings.manga.providerId = "custom-openai-compatible";
    settings.providerConfigs = { "custom-openai-compatible": {
      apiKey: "secondary-test-key", baseUrl: "http://127.0.0.1:8317/v1",
      endpoint: "/chat/completions", customHeaders: { "X-Secondary": "secondary-test-header" },
    } };
    const before = structuredClone(settings);
    const { provider, status } = resolveMangaConfiguration(settings);
    assert.equal(status.ready, true);
    assert.equal(status.followsCurrent, false);
    assert.equal(provider.apiKey, "secondary-test-key");
    assert.equal(provider.baseUrl, "http://127.0.0.1:8317/v1");
    assert.deepEqual(provider.customHeaders, { "X-Secondary": "secondary-test-header" });
    assert.deepEqual(settings, before);
  });
  it("follows provider switches only in current-provider mode", () => {
    const settings = configured();
    settings.providerConfigs = { "custom-openai-compatible": { apiKey: "proxy-test-key", baseUrl: "https://second.example.test/v1" } };
    const switched = switchProviderSettings(settings, "custom-openai-compatible");
    assert.equal(resolveMangaConfiguration(switched).provider.apiKey, "proxy-test-key");
    switched.manga = { ...switched.manga, providerId: "google-gemini" };
    assert.equal(resolveMangaConfiguration(switched).provider.apiKey, "active-test-key");
  });
  it("keeps the manga model and target language independent of the chat model", () => {
    const settings = configured();
    settings.manga = { providerId: "current", modelId: "  dedicated-vision  ", targetLanguage: "Japanese" };
    const { status } = resolveMangaConfiguration(settings);
    assert.equal(status.modelId, "dedicated-vision");
    assert.notEqual(status.modelId, settings.model);
    assert.equal(settings.manga.targetLanguage, "Japanese");
  });
  it("reports genuinely missing or whitespace-only keys and names the selected provider", () => {
    for (const key of ["", "   "]) {
      const settings = { ...configured(), apiKey: key };
      const { status } = resolveMangaConfiguration(settings);
      assert.equal(status.ready, false);
      assert.equal(status.hasApiKey, false);
      assert.equal(status.errorCode, "API_KEY_MISSING");
      assert.match(status.error!, /Google Gemini/);
    }
  });
  it("does not borrow another provider's key even if the destination has a valid URL", () => {
    const settings = configured();
    settings.manga.providerId = "custom-openai-compatible";
    settings.providerConfigs = { "custom-openai-compatible": { baseUrl: "https://different.example.test/v1" } };
    const { status, provider } = resolveMangaConfiguration(settings);
    assert.equal(status.errorCode, "API_KEY_MISSING");
    assert.equal(provider.apiKey, "");
    assert.deepEqual(provider.customHeaders, {});
  });
  it("does not turn an unknown explicit provider into the active provider", () => {
    const settings = configured();
    settings.manga.providerId = "unknown-provider";
    const { status } = resolveMangaConfiguration(settings);
    assert.equal(status.ready, false);
    assert.equal(status.errorCode, "MANGA_PROVIDER_INVALID");
    assert.equal(status.hasApiKey, false);
    assert.equal(status.origin, "");
  });
  it("rejects unsupported provider formats before a model request", () => {
    const settings = { ...configured(), apiFormat: "anthropic-compatible" as const };
    assert.equal(resolveMangaConfiguration(settings).status.errorCode, "MANGA_FORMAT_UNSUPPORTED");
  });
  it("rejects missing, malformed and embedded-credential API URLs", () => {
    for (const baseUrl of ["", "proxy.example.test", "file:///manga", "https://user:secret@example.test/api"]) {
      const { status } = resolveMangaConfiguration({ ...configured(), baseUrl });
      assert.equal(status.errorCode, "MANGA_ENDPOINT_MISSING");
      assert.equal(status.origin, "");
    }
  });
  it("validates the model and target language without changing them", () => {
    for (const patch of [{ modelId: " " }, { modelId: "x".repeat(201) }, { targetLanguage: " " }, { targetLanguage: "x".repeat(101) }]) {
      const settings = configured();
      settings.manga = { ...settings.manga, ...patch };
      assert.equal(resolveMangaConfiguration(settings).status.errorCode, "MANGA_SETTINGS_INVALID");
    }
  });
  it("returns a public status with no key, header or URL query secrets", () => {
    const { status } = resolveMangaConfiguration(configured());
    assert.equal(status.origin, "https://proxy.example.test");
    const publicStatus = JSON.stringify(status);
    for (const secret of ["active-test-key", "active-test-header", "not-for-display", "X-Proxy-Token"])
      assert.equal(publicStatus.includes(secret), false);
  });
  it("localizes configuration errors in all UI languages", () => {
    for (const uiLanguage of ["zh-CN", "en-US", "ja-JP"] as const) {
      const { status } = resolveMangaConfiguration({ ...configured(), uiLanguage, apiKey: "" });
      assert.ok(status.error?.includes("Google Gemini"));
      assert.equal(status.error?.includes("manga.providerKeyMissing"), false);
    }
  });
});

describe("manga model selection defaults", () => {
  it("does not invent a model id for a newly configured provider", () => {
    const defaults = getDefaultSettings();
    assert.equal(defaults.manga.modelId, "");
    const settings = { ...configured(), manga: defaults.manga };
    assert.equal(resolveMangaConfiguration(settings).status.ready, false);
    assert.equal(resolveMangaConfiguration(settings, { requireModel: false }).status.ready, true);
  });
  it("does not rewrite a saved explicit model name or drop credentials checks during discovery", () => {
    const settings = configured();
    settings.manga.modelId = "gemini-3.8-flash";
    assert.equal(resolveMangaConfiguration(settings).status.modelId, "gemini-3.8-flash");
    settings.apiKey = "";
    assert.equal(resolveMangaConfiguration(settings, { requireModel: false }).status.errorCode, "API_KEY_MISSING");
  });
});
