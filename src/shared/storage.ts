// ============================================================
// Astra Translate – Chrome Storage Helpers
// ============================================================

import type { AstraSettings } from "./types";
import { STORAGE_KEY, DEFAULT_TARGET_LANG } from "./constants";
import { DEFAULT_SELECTION_PROMPT, DEFAULT_PAGE_PROMPT } from "./prompts";

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
    selectionPrompt: DEFAULT_SELECTION_PROMPT,
    pagePrompt: DEFAULT_PAGE_PROMPT,
    batchSize: 4000,
    concurrency: 2,
    enableRealtimePageTranslate: true,
  };
}

export async function getSettings(): Promise<AstraSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const saved = result[STORAGE_KEY] as Partial<AstraSettings> | undefined;
  if (!saved) return getDefaultSettings();
  return { ...getDefaultSettings(), ...saved };
}

export async function saveSettings(settings: AstraSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

export async function resetSettings(): Promise<AstraSettings> {
  const defaults = getDefaultSettings();
  await saveSettings(defaults);
  return defaults;
}
