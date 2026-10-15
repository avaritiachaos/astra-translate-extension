// ============================================================
// Astra Translate – Chrome Storage Helpers
// ============================================================

import type { AstraSettings, ConcreteTranslateEngine, UserProviderSettings } from "./types";
import { STORAGE_KEY, DEFAULT_TARGET_LANG, DEFAULT_PROVIDER_PRESETS } from "./constants.ts";
import {
  DEFAULT_SELECTION_PROMPT,
  DEFAULT_PAGE_PROMPT,
  DEFAULT_DICTIONARY_PROMPT,
  DEFAULT_CHAT_PROMPT,
  DEFAULT_LIVE_TRANSLATE_PROMPT,
  LEGACY_DICTIONARY_PROMPTS,
  LEGACY_SELECTION_PROMPTS,
  LEGACY_PAGE_PROMPTS,
} from "./prompts.ts";

export function getDefaultSettings(): AstraSettings {
  return {
    manga: {
      providerId: "current",
      modelId: "",
      targetLanguage: "Simplified Chinese",
      thinkingEffort: "low",
      concurrency: 3,
      prefetchDepth: 2,
      autoReadingDefault: true,
      prefetchDefault: true,
      backgroundPrefetch: true,
      batchPrefetchLimit: 20,
      fontFamily: "sans",
      bubbleTheme: "auto",
    },
    providerId: "deepseek",
    providerName: "DeepSeek",
    apiFormat: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    endpoint: "/chat/completions",
    apiKey: "",
    model: "deepseek-v4.1-flash",
    temperature: 0.2,
    timeoutMs: 30000,
    disableThinking: true,
    customHeaders: {},
    uiLanguage: "zh-CN",
    defaultTargetLang: DEFAULT_TARGET_LANG,
    pageTargetLang: DEFAULT_TARGET_LANG,
    selectionTargetLang: DEFAULT_TARGET_LANG,
    selectionPrompt: DEFAULT_SELECTION_PROMPT,
    pagePrompt: DEFAULT_PAGE_PROMPT,
    batchSize: 6000,
    concurrency: 4,
    enableRealtimePageTranslate: true,
    translateWholePage: false,
    translatePageChrome: true,
    translateUiControls: true,
    enableStreamingPageTranslate: true,
    enableSiteLexicon: true,
    enableFloatingBall: true,
    floatingBallOpacity: 0.8,
    floatingBallSize: 48,
    popupScale: 1.0,
    smartTargetEnabled: true,
    secondaryTargetLang: "English",
    smartTargetMaxChars: 40,
    smartTargetMaxWords: 8,
    smartTargetMaxCjkChars: 20,
    sameLanguageToSecondaryEnabled: true,
    sameLanguageMinPurity: 0.82,
    dictionaryModeEnabled: true,
    dictionaryPrompt: DEFAULT_DICTIONARY_PROMPT,
    chatPrompt: DEFAULT_CHAT_PROMPT,
    chatWebSearchEnabled: false,
    chatWebSearchFallbackEnabled: true,
    serperApiKey: "",
    googleSearchApiKey: "",
    googleSearchCx: "",
    chatAutoAttachPage: true,
    enableTranslationCache: true,
    translationCacheMaxEntries: 5000,
    customGlossary: "",
    liveTranslateApiKey: "",
    liveTranslateModel: "models/gemini-3.5-live-translate-preview",
    liveTranslateTargetLang: DEFAULT_TARGET_LANG,
    liveTranslateShowOriginal: false,
    liveTranslateVadEnabled: true,
    // Tab audio (especially ASMR/whispers) is often much quieter than a mic.
    liveTranslateVadThreshold: 80,
    liveTranslateFontSize: 20,
    liveTranslateBgOpacity: 80,
    liveTranslatePrompt: DEFAULT_LIVE_TRANSLATE_PROMPT,
    deeplFallbackProviderId: "",
    pageTranslateEngine: "provider",
    selectionTranslateEngine: "provider",

    popupTabs: {
      chat: true,
      manga: true,
      live: true,
    },

    providerConfigs: {
      deepseek: {
        apiKey: "",
        baseUrl: "https://api.deepseek.com",
        endpoint: "/chat/completions",
        model: "deepseek-v4.1-flash",
        disableThinking: true,
        temperature: 0.2,
        apiFormat: "openai-compatible",
      },
      "google-gemini": {
        apiKey: "",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        endpoint: "/chat/completions",
        model: "gemini-3.7-flash",
        disableThinking: false,
        temperature: 0.2,
        apiFormat: "openai-compatible",
      },
    },
  };
}

export async function getSettings(): Promise<AstraSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const saved = result[STORAGE_KEY] as Partial<AstraSettings> | undefined;
  if (!saved) return getDefaultSettings();
  const merged = { ...getDefaultSettings(), ...saved };
  // 200 was the old built-in threshold; it commonly drops quiet tab audio
  // (ASMR, whispers, podcasts) even though the capture stream is healthy.
  if (saved.liveTranslateVadThreshold === undefined || saved.liveTranslateVadThreshold === 200) {
    merged.liveTranslateVadThreshold = 80;
  }
  merged.manga = { ...getDefaultSettings().manga, ...saved.manga };
  merged.popupTabs = { ...getDefaultSettings().popupTabs, ...saved.popupTabs };
  if (!merged.liveTranslateApiKey) {
    // If user previously stored the live key under the old config, smoothly adopt it
    merged.liveTranslateApiKey = saved.liveTranslateApiKey || saved.providerConfigs?.["google-gemini"]?.apiKey || "";
  }
  if (!merged.providerConfigs) {
    merged.providerConfigs = {};
  }
  if (merged.providerId) {
    merged.providerConfigs[merged.providerId] = {
      apiKey: merged.apiKey,
      baseUrl: merged.baseUrl,
      endpoint: merged.endpoint,
      model: merged.model,
      disableThinking: merged.disableThinking,
      temperature: merged.temperature,
      apiFormat: merged.apiFormat,
      ...merged.providerConfigs[merged.providerId],
      customHeaders: { ...(merged.customHeaders ?? {}) },
    };
  }
  // Auto-upgrade prompts for users who never customized them, so improved rules
  // apply without requiring a manual "restore default prompts".
  const savedPrompt = saved.dictionaryPrompt?.trim();
  if (!savedPrompt || LEGACY_DICTIONARY_PROMPTS.some((p) => p.trim() === savedPrompt)) {
    merged.dictionaryPrompt = DEFAULT_DICTIONARY_PROMPT;
  }
  const savedSelectionPrompt = saved.selectionPrompt?.trim();
  if (!savedSelectionPrompt || LEGACY_SELECTION_PROMPTS.some((p) => p.trim() === savedSelectionPrompt)) {
    merged.selectionPrompt = DEFAULT_SELECTION_PROMPT;
  }
  const savedPagePrompt = saved.pagePrompt?.trim();
  if (!savedPagePrompt || LEGACY_PAGE_PROMPTS.some((p) => p.trim() === savedPagePrompt)) {
    merged.pagePrompt = DEFAULT_PAGE_PROMPT;
  }
  // Auto-upgrade legacy default model "deepseek-v4-flash" to "deepseek-v4.1-flash"
  if (merged.model === "deepseek-v4-flash") {
    merged.model = "deepseek-v4.1-flash";
  }
  if (merged.providerConfigs?.deepseek?.model === "deepseek-v4-flash") {
    merged.providerConfigs.deepseek.model = "deepseek-v4.1-flash";
  }
  return merged;
}

export async function saveSettings(settings: AstraSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

export async function resetSettings(): Promise<AstraSettings> {
  const defaults = getDefaultSettings();
  await saveSettings(defaults);
  return defaults;
}

/** Switch active provider preset while preserving per-provider configurations. */
export function switchProviderSettings(
  settings: AstraSettings,
  targetPresetId: string
): AstraSettings {
  const preset = DEFAULT_PROVIDER_PRESETS.find((p) => p.id === targetPresetId);
  if (!preset) return settings;

  const configs = { ...(settings.providerConfigs || {}) };
  if (settings.providerId) {
    configs[settings.providerId] = {
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      endpoint: settings.endpoint,
      model: settings.model,
      disableThinking: settings.disableThinking,
      temperature: settings.temperature,
      apiFormat: settings.apiFormat,
      customHeaders: { ...(settings.customHeaders ?? {}) },
    };
  }

  const targetSaved = configs[preset.id];
  return {
    ...settings,
    providerId: preset.id,
    providerName: preset.name,
    apiFormat: targetSaved?.apiFormat ?? preset.apiFormat,
    baseUrl: targetSaved?.baseUrl ?? preset.baseUrl,
    endpoint: targetSaved?.endpoint ?? preset.endpoint,
    model: targetSaved?.model ?? (preset.defaultModel || ""),
    apiKey: targetSaved?.apiKey ?? "",
    disableThinking:
      targetSaved?.disableThinking ??
      (preset.supportsThinkingToggle ? false : true),
    temperature: targetSaved?.temperature ?? settings.temperature,
    customHeaders: { ...(targetSaved?.customHeaders ?? {}) },
    providerConfigs: configs,
  };
}

/**
 * Build the full provider settings for an arbitrary preset WITHOUT switching
 * the active provider — used by the DeepL fallback path (chat / dictionary
 * keep running on an LLM provider while DeepL owns translation).
 * Returns null when the preset id is unknown.
 */
export function resolveProviderSettingsById(
  settings: AstraSettings,
  presetId: string
): UserProviderSettings | null {
  const preset = DEFAULT_PROVIDER_PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  const saved = settings.providerConfigs?.[presetId];
  return {
    providerId: preset.id,
    providerName: preset.name,
    apiFormat: saved?.apiFormat ?? preset.apiFormat,
    baseUrl: saved?.baseUrl ?? preset.baseUrl,
    endpoint: saved?.endpoint ?? preset.endpoint,
    apiKey: saved?.apiKey ?? "",
    model: saved?.model ?? (preset.defaultModel || ""),
    temperature: saved?.temperature ?? settings.temperature,
    timeoutMs: settings.timeoutMs,
    disableThinking:
      saved?.disableThinking ?? (preset.supportsThinkingToggle ? false : true),
    customHeaders: { ...(saved?.customHeaders ?? {}) },
  };
}

/** True when the preset id refers to a real, LLM-capable (non-text-only) provider. */
export function isLlmPresetId(presetId: string): boolean {
  const preset = DEFAULT_PROVIDER_PRESETS.find((p) => p.id === presetId);
  return !!preset && preset.apiFormat === "openai-compatible";
}

/**
 * Pick the LLM provider that serves chat / dictionary while a text-only MT
 * provider (DeepL) is active. Preference order:
 *   1. the explicit user choice (deeplFallbackProviderId) when it has a key;
 *   2. the first LLM preset with a configured API key.
 * Returns null when no LLM provider has a key — callers surface a clear error.
 */
export function resolveDeeplFallbackProviderId(
  settings: Pick<AstraSettings, "deeplFallbackProviderId" | "providerConfigs">
): string | null {
  const configs = settings.providerConfigs || {};
  const preferred = settings.deeplFallbackProviderId;
  if (preferred && isLlmPresetId(preferred) && (configs[preferred]?.apiKey || "").trim()) {
    return preferred;
  }
  for (const preset of DEFAULT_PROVIDER_PRESETS) {
    if (preset.apiFormat !== "openai-compatible") continue;
    if ((configs[preset.id]?.apiKey || "").trim()) return preset.id;
  }
  return null;
}

/**
 * Pick the active LLM provider id for Chat mode.
 * Chat is an LLM surface and never runs on DeepL. If the active provider is
 * DeepL, Chat resolves to the fallback LLM (or deepseek default).
 */
export function resolveChatProviderId(
  settings: Pick<
    AstraSettings,
    "providerId" | "apiFormat" | "deeplFallbackProviderId" | "providerConfigs"
  > | null
): string {
  if (!settings) return "deepseek";
  if (settings.apiFormat === "openai-compatible" && isLlmPresetId(settings.providerId)) {
    return settings.providerId;
  }
  if (settings.deeplFallbackProviderId && isLlmPresetId(settings.deeplFallbackProviderId)) {
    return settings.deeplFallbackProviderId;
  }
  return resolveDeeplFallbackProviderId(settings) || "deepseek";
}

/**
 * Return the provider settings currently active for Chat.
 * If the active provider is an LLM, returns settings. If it is DeepL,
 * resolves to the LLM fallback provider settings.
 */
export function resolveChatProviderSettings(
  settings: AstraSettings
): UserProviderSettings {
  const chatId = resolveChatProviderId(settings);
  if (settings.providerId === chatId) {
    return settings;
  }
  return resolveProviderSettingsById(settings, chatId) || settings;
}

/**
 * Full settings for the DeepL chat/dictionary fallback: the whole settings
 * object with only the provider fields swapped to the fallback LLM provider
 * (prompts, cache limits, UI language etc. stay global). Null when no LLM
 * provider with an API key exists.
 */
export function resolveDeeplFallbackSettings(
  settings: AstraSettings
): AstraSettings | null {
  const id = resolveDeeplFallbackProviderId(settings);
  if (!id) return null;
  const provider = resolveProviderSettingsById(settings, id);
  if (!provider) return null;
  return {
    ...settings,
    providerId: provider.providerId,
    providerName: provider.providerName,
    apiFormat: provider.apiFormat,
    baseUrl: provider.baseUrl,
    endpoint: provider.endpoint,
    apiKey: provider.apiKey,
    model: provider.model,
    temperature: provider.temperature,
    disableThinking: provider.disableThinking,
    customHeaders: provider.customHeaders,
  };
}

/**
 * Resolve the engine actually serving a translation mode. A per-mode override
 * ("llm"/"deepl") wins; "provider" (the default) resolves to the active
 * preset's nature — a DeepL active provider serves MT, anything else serves
 * the LLM path.
 */
export function resolveTranslateEngine(
  settings: Pick<
    AstraSettings,
    "pageTranslateEngine" | "selectionTranslateEngine" | "apiFormat"
  >,
  mode: "page" | "selection"
): ConcreteTranslateEngine {
  const chosen =
    (mode === "page"
      ? settings.pageTranslateEngine
      : settings.selectionTranslateEngine) || "provider";
  if (chosen === "deepl") return "deepl";
  if (chosen === "llm") return "llm";
  return settings.apiFormat === "deepl" ? "deepl" : "llm";
}

/**
 * Full settings for a resolved engine: the whole settings object with only
 * the provider fields swapped to that engine's provider.
 *  - "llm": the active preset when it is an LLM, else the fallback LLM
 *    (null when no LLM provider with a key exists);
 *  - "deepl": the DeepL preset config — returned even without a key so
 *    callers can produce the precise "DeepL key missing" error.
 */
export function resolveEngineSettings(
  settings: AstraSettings,
  engine: ConcreteTranslateEngine
): AstraSettings | null {
  if (engine === "llm") {
    return settings.apiFormat === "deepl"
      ? resolveDeeplFallbackSettings(settings)
      : settings;
  }
  const provider = resolveProviderSettingsById(settings, "deepl");
  if (!provider) return null;
  return {
    ...settings,
    providerId: provider.providerId,
    providerName: provider.providerName,
    apiFormat: provider.apiFormat,
    baseUrl: provider.baseUrl,
    endpoint: provider.endpoint,
    apiKey: provider.apiKey,
    model: provider.model,
    temperature: provider.temperature,
    disableThinking: provider.disableThinking,
    customHeaders: provider.customHeaders,
  };
}
