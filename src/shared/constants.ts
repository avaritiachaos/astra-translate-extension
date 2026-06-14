// ============================================================
// Astra Translate – Constants
// ============================================================

import type { ProviderPreset } from "./types";

export const AST_PREFIX = "ast";

/**
 * Separator joining multiple text fragments of one block into a single
 * page-translation item, so the model translates them with full-sentence
 * context. A Private-Use-Area char (U+E000) that never occurs in real page
 * text and that models reliably pass through verbatim. The content script
 * splits the translated item back on this char and writes each segment to its
 * original text node (inline tags are never moved, so they are preserved).
 */
export const PAGE_SEGMENT_SEPARATOR = String.fromCharCode(0xe000);

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
