import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getDefaultSettings,
  getSettings,
  switchProviderSettings,
  resolveDeeplFallbackProviderId,
  resolveDeeplFallbackSettings,
  resolveProviderSettingsById,
  resolveTranslateEngine,
  resolveEngineSettings,
  resolveChatProviderId,
  resolveChatProviderSettings,
  resolveChatSettings,
} from "./storage.ts";
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

  it("upgrades legacy or architectural DeepSeek model names to official deepseek-flash", async () => {
    const memoryStore: Record<string, any> = {};
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: memoryStore[key] }),
          set: async (obj: Record<string, any>) => Object.assign(memoryStore, obj),
        },
      },
    };

    memoryStore[STORAGE_KEY] = {
      model: "deepseek-v4.1-flash",
      providerConfigs: {
        deepseek: { model: "deepseek-v4-flash" },
      },
    };
    const upgraded = await getSettings();
    assert.equal(upgraded.model, "deepseek-flash");
    assert.equal(upgraded.providerConfigs?.deepseek?.model, "deepseek-flash");
  });

  it("never alters models for other providers like Google Gemini", async () => {
    const memoryStore: Record<string, any> = {};
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: memoryStore[key] }),
          set: async (obj: Record<string, any>) => Object.assign(memoryStore, obj),
        },
      },
    };

    memoryStore[STORAGE_KEY] = {
      providerId: "google-gemini",
      model: "gemini-3.7-flash",
      providerConfigs: {
        "google-gemini": { model: "gemini-3.7-flash" },
      },
    };
    const loaded = await getSettings();
    assert.equal(loaded.providerId, "google-gemini");
    assert.equal(loaded.model, "gemini-3.7-flash");
    assert.equal(loaded.providerConfigs?.["google-gemini"]?.model, "gemini-3.7-flash");
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

describe("deepl fallback resolution", () => {
  it("prefers the explicit fallback choice when it has a key", () => {
    const settings = {
      ...getDefaultSettings(),
      deeplFallbackProviderId: "deepseek",
      providerConfigs: {
        deepseek: { apiKey: "sk-deepseek" },
        "google-gemini": { apiKey: "AIza-gemini" },
      },
    };
    assert.equal(resolveDeeplFallbackProviderId(settings), "deepseek");
  });

  it("falls back to the first LLM preset with a key when no choice is set", () => {
    const settings = {
      ...getDefaultSettings(),
      deeplFallbackProviderId: "",
      providerConfigs: {
        "google-gemini": { apiKey: "AIza-gemini" },
      },
    };
    assert.equal(resolveDeeplFallbackProviderId(settings), "google-gemini");
  });

  it("ignores a fallback choice without a key and rejects a text-only choice", () => {
    const settings = {
      ...getDefaultSettings(),
      deeplFallbackProviderId: "deepl",
      providerConfigs: {},
    };
    assert.equal(resolveDeeplFallbackProviderId(settings), null);
  });

  it("returns null when no LLM provider has a key", () => {
    const settings = {
      ...getDefaultSettings(),
      deeplFallbackProviderId: "",
      providerConfigs: {},
    };
    assert.equal(resolveDeeplFallbackProviderId(settings), null);
    assert.equal(resolveDeeplFallbackSettings(settings), null);
  });

  it("builds fallback settings by swapping only the provider fields", () => {
    const settings = {
      ...getDefaultSettings(),
      deeplFallbackProviderId: "google-gemini",
      providerId: "deepl",
      providerName: "DeepL",
      apiFormat: "deepl" as const,
      apiKey: "dl-key",
      baseUrl: "https://api-free.deepl.com/v2",
      providerConfigs: {
        "google-gemini": {
          apiKey: "AIza-gemini",
          model: "gemini-3.7-flash",
        },
      },
      chatPrompt: "custom chat prompt",
    };
    const fallback = resolveDeeplFallbackSettings(settings);
    assert.ok(fallback);
    assert.equal(fallback.providerId, "google-gemini");
    assert.equal(fallback.apiKey, "AIza-gemini");
    assert.equal(fallback.apiFormat, "openai-compatible");
    // Global fields survive the swap.
    assert.equal(fallback.chatPrompt, "custom chat prompt");
    assert.equal(fallback.uiLanguage, settings.uiLanguage);
  });

  it("resolveProviderSettingsById returns null for unknown presets", () => {
    const settings = getDefaultSettings();
    assert.equal(resolveProviderSettingsById(settings, "nope"), null);
  });
});

describe("chat provider resolution", () => {
  it("uses the active provider when it is an LLM", () => {
    const settings = {
      ...getDefaultSettings(),
      providerId: "google-gemini",
      apiFormat: "openai-compatible" as const,
    };
    assert.equal(resolveChatProviderId(settings), "google-gemini");
  });

  it("never selects DeepL for chat, resolving to fallback LLM instead", () => {
    const settings = {
      ...getDefaultSettings(),
      providerId: "deepl",
      apiFormat: "deepl" as const,
      deeplFallbackProviderId: "google-gemini",
      providerConfigs: {
        "google-gemini": { apiKey: "AIza-gemini", model: "gemini-3.7-flash" },
      },
    };
    assert.equal(resolveChatProviderId(settings), "google-gemini");
    const chatProvider = resolveChatProviderSettings(settings);
    assert.equal(chatProvider?.providerId, "google-gemini");
    assert.equal(chatProvider?.model, "gemini-3.7-flash");
  });

  it("reports no chat provider instead of naming an unconfigured one", () => {
    const settings = {
      ...getDefaultSettings(),
      providerId: "deepl",
      apiFormat: "deepl" as const,
      deeplFallbackProviderId: "",
      providerConfigs: {},
    };
    assert.equal(resolveChatProviderId(settings), null);
    assert.equal(resolveChatProviderSettings(settings), null);
    assert.equal(resolveChatSettings(settings), null);
  });

  it("keeps the UI and the backend on the same provider when the pinned fallback has no key", () => {
    // Regression: resolveChatProviderId used to ignore the key while the
    // backend honoured it, so the pill named DeepSeek while Gemini answered.
    const settings = {
      ...getDefaultSettings(),
      providerId: "deepl",
      apiFormat: "deepl" as const,
      deeplFallbackProviderId: "deepseek",
      providerConfigs: {
        deepseek: { apiKey: "", model: "deepseek-v4.1-flash" },
        "google-gemini": { apiKey: "AIza-gemini", model: "gemini-3.7-flash" },
      },
    };
    assert.equal(resolveChatProviderId(settings), "google-gemini");
    assert.equal(resolveChatSettings(settings)?.providerId, "google-gemini");
    assert.equal(resolveChatSettings(settings)?.model, "gemini-3.7-flash");
  });

  it("honours an explicit chat provider without touching the translation provider", () => {
    const settings = {
      ...getDefaultSettings(),
      providerId: "google-gemini",
      apiFormat: "openai-compatible" as const,
      apiKey: "AIza-gemini",
      model: "gemini-3.7-flash",
      chatProviderId: "deepseek",
      providerConfigs: {
        deepseek: { apiKey: "sk-deepseek", model: "deepseek-v4.1-flash" },
        "google-gemini": { apiKey: "AIza-gemini", model: "gemini-3.7-flash" },
      },
    };
    // Chat follows the explicit choice...
    assert.equal(resolveChatProviderId(settings), "deepseek");
    // ...while page / selection translation still follow the active provider.
    assert.equal(settings.providerId, "google-gemini");
    assert.equal(settings.apiFormat, "openai-compatible");
    assert.equal(resolveTranslateEngine(settings, "page"), "llm");
    assert.equal(resolveEngineSettings(settings, "llm")?.model, "gemini-3.7-flash");
  });

  it("ignores a pinned chat provider whose key was removed", () => {
    const settings = {
      ...getDefaultSettings(),
      providerId: "google-gemini",
      apiFormat: "openai-compatible" as const,
      apiKey: "AIza-gemini",
      model: "gemini-3.7-flash",
      chatProviderId: "deepseek",
      providerConfigs: {
        deepseek: { apiKey: "", model: "deepseek-v4.1-flash" },
        "google-gemini": { apiKey: "AIza-gemini", model: "gemini-3.7-flash" },
      },
    };
    assert.equal(resolveChatProviderId(settings), "google-gemini");
    assert.equal(resolveChatSettings(settings)?.model, "gemini-3.7-flash");
  });

  it("resolveChatSettings swaps only the provider fields", () => {
    const settings = {
      ...getDefaultSettings(),
      providerId: "deepl",
      apiFormat: "deepl" as const,
      apiKey: "deepl-key:fx",
      model: "",
      chatProviderId: "deepseek",
      chatPrompt: "keep me",
      uiLanguage: "ja-JP" as const,
      providerConfigs: {
        deepseek: { apiKey: "sk-deepseek", model: "deepseek-v4.1-flash" },
      },
    };
    const chat = resolveChatSettings(settings);
    assert.equal(chat?.providerId, "deepseek");
    assert.equal(chat?.apiKey, "sk-deepseek");
    assert.equal(chat?.model, "deepseek-v4.1-flash");
    assert.equal(chat?.chatPrompt, "keep me");
    assert.equal(chat?.uiLanguage, "ja-JP");
    // The source settings object is never mutated by resolution.
    assert.equal(settings.providerId, "deepl");
  });
});

describe("per-mode engine resolution", () => {
  it("the default \"provider\" follows the active preset's nature", () => {
    const llmActive = {
      ...getDefaultSettings(),
      providerId: "deepseek",
      apiFormat: "openai-compatible" as const,
    };
    assert.equal(resolveTranslateEngine(llmActive, "page"), "llm");
    assert.equal(resolveTranslateEngine(llmActive, "selection"), "llm");
    const deeplActive = { ...getDefaultSettings(), apiFormat: "deepl" as const };
    assert.equal(resolveTranslateEngine(deeplActive, "page"), "deepl");
    assert.equal(resolveTranslateEngine(deeplActive, "selection"), "deepl");
  });

  it("explicit per-mode overrides win over the active preset", () => {
    const settings = {
      ...getDefaultSettings(),
      apiFormat: "deepl" as const,
      pageTranslateEngine: "llm" as const,
      selectionTranslateEngine: "deepl" as const,
    };
    assert.equal(resolveTranslateEngine(settings, "page"), "llm");
    assert.equal(resolveTranslateEngine(settings, "selection"), "deepl");
  });

  it("missing stored fields fall back to \"provider\"", () => {
    const settings = getDefaultSettings();
    const partial: any = { ...settings, apiFormat: "deepl", pageTranslateEngine: undefined };
    assert.equal(resolveTranslateEngine(partial, "page"), "deepl");
  });

  it("resolveEngineSettings(deepl) merges the DeepL preset and keeps globals", () => {
    const settings = {
      ...getDefaultSettings(),
      providerId: "deepl",
      providerConfigs: { deepl: { apiKey: "dl-key:fx" } },
      chatPrompt: "custom",
    };
    const engine = resolveEngineSettings(settings, "deepl");
    assert.ok(engine);
    assert.equal(engine.apiFormat, "deepl");
    assert.equal(engine.apiKey, "dl-key:fx");
    assert.equal(engine.baseUrl, "https://api-free.deepl.com/v2");
    assert.equal(engine.endpoint, "/translate");
    assert.equal(engine.chatPrompt, "custom");
    // Returned even without a key — callers produce the precise key error.
    const noKey = resolveEngineSettings({ ...settings, providerConfigs: {} }, "deepl");
    assert.ok(noKey);
    assert.equal(noKey.apiKey, "");
  });

  it("resolveEngineSettings(llm) uses the active LLM or the fallback", () => {
    const llmActive = {
      ...getDefaultSettings(),
      providerId: "deepseek",
      apiFormat: "openai-compatible" as const,
      apiKey: "sk-active",
    };
    assert.equal(resolveEngineSettings(llmActive, "llm")?.apiKey, "sk-active");

    const deeplActive = {
      ...getDefaultSettings(),
      apiFormat: "deepl" as const,
      providerConfigs: { "google-gemini": { apiKey: "AIza-x" } },
    };
    const fallback = resolveEngineSettings(deeplActive, "llm");
    assert.equal(fallback?.providerId, "google-gemini");
    assert.equal(fallback?.apiKey, "AIza-x");

    assert.equal(
      resolveEngineSettings({ ...deeplActive, providerConfigs: {} }, "llm"),
      null,
    );
  });
});
