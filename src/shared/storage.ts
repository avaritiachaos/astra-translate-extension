// ============================================================
// Astra Translate – Chrome Storage Helpers
// ============================================================

import type { AstraSettings } from "./types";
import { STORAGE_KEY, DEFAULT_TARGET_LANG, DEFAULT_PROVIDER_PRESETS } from "./constants";
import {
  DEFAULT_SELECTION_PROMPT,
  DEFAULT_PAGE_PROMPT,
  DEFAULT_DICTIONARY_PROMPT,
  DEFAULT_CHAT_PROMPT,
  DEFAULT_LIVE_TRANSLATE_PROMPT,
  LEGACY_DICTIONARY_PROMPTS,
} from "./prompts";

export function getDefaultSettings(): AstraSettings {
  return {
    providerId: "deepseek",
    providerName: "DeepSeek",
    apiFormat: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    endpoint: "/chat/completions",
    apiKey: "",
    model: "deepseek-v4-flash",
    temperature: 0.2,
    timeoutMs: 30000,
    disableThinking: true,
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
    translatePageChrome: false,
    translateUiControls: false,
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
    chatAutoAttachPage: true,
    enableTranslationCache: true,
    translationCacheMaxEntries: 5000,
    customGlossary: "",
    liveTranslateModel: "models/gemini-3.5-live-translate-preview",
    liveTranslateTargetLang: DEFAULT_TARGET_LANG,
    liveTranslateShowOriginal: false,
    liveTranslateVadEnabled: true,
    liveTranslateVadThreshold: 200,
    liveTranslateFontSize: 20,
    liveTranslateBgOpacity: 80,
    liveTranslatePrompt: DEFAULT_LIVE_TRANSLATE_PROMPT,

    providerConfigs: {
      deepseek: {
        apiKey: "",
        baseUrl: "https://api.deepseek.com",
        endpoint: "/chat/completions",
        model: "deepseek-v4-flash",
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
    };
  }
  // Auto-upgrade the dictionary prompt for users who never customized it, so the
  // dictionary / name-meaning behavior applies without a manual "restore default".
  const savedPrompt = saved.dictionaryPrompt?.trim();
  if (!savedPrompt || LEGACY_DICTIONARY_PROMPTS.some((p) => p.trim() === savedPrompt)) {
    merged.dictionaryPrompt = DEFAULT_DICTIONARY_PROMPT;
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
    providerConfigs: configs,
  };
}
