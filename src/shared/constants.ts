// ============================================================
// Astra Translate – Constants
// ============================================================

import type { ProviderPreset } from "./types";

export const AST_PREFIX = "ast";

export const DEFAULT_PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    apiFormat: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    endpoint: "/chat/completions",
    defaultModel: "deepseek-v4-flash",
    website: "https://platform.deepseek.com",
    supportsThinkingToggle: true,
  },
  {
    id: "custom-openai-compatible",
    name: "Custom OpenAI-compatible",
    apiFormat: "openai-compatible",
    baseUrl: "",
    endpoint: "/chat/completions",
    defaultModel: "",
    supportsThinkingToggle: false,
  },
];

export const DEFAULT_TARGET_LANG = "Simplified Chinese";

export const SUPPORTED_LANGUAGES = [
  "Simplified Chinese",
  "Traditional Chinese",
  "English",
  "Japanese",
  "Korean",
  "French",
  "German",
  "Spanish",
  "Portuguese",
  "Russian",
  "Arabic",
  "Italian",
  "Dutch",
  "Polish",
  "Turkish",
  "Vietnamese",
  "Thai",
  "Indonesian",
  "Malay",
  "Hindi",
];

export const STORAGE_KEY = "astra_settings";
