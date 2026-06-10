// ============================================================
// Astra Translate – Shared Types
// ============================================================

import type { UiLanguage } from "./i18n";

// ---------- Provider ----------
export type ProviderApiFormat =
  | "openai-compatible"
  | "gemini-compatible"
  | "anthropic-compatible";

export interface ProviderPreset {
  id: string;
  name: string;
  apiFormat: ProviderApiFormat;
  baseUrl: string;
  endpoint: string;
  defaultModel: string;
  website?: string;
  supportsThinkingToggle?: boolean;
}

export interface UserProviderSettings {
  providerId: string;
  providerName: string;
  apiFormat: ProviderApiFormat;
  baseUrl: string;
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  disableThinking: boolean;
}

// ---------- Full settings ----------
export interface AstraSettings extends UserProviderSettings {
  uiLanguage: UiLanguage;
  defaultTargetLang: string;
  pageTargetLang: string;
  selectionTargetLang: string;
  selectionPrompt: string;
  pagePrompt: string;
  batchSize: number;
  concurrency: number;
  enableRealtimePageTranslate: boolean;
  enableFloatingBall: boolean;
  floatingBallOpacity: number;
  floatingBallSize: number;
  popupScale: number;
  // Smart Target Language
  smartTargetEnabled: boolean;
  secondaryTargetLang: string;
  smartTargetMaxChars: number;
  smartTargetMaxWords: number;
  smartTargetMaxCjkChars: number;
  sameLanguageToSecondaryEnabled: boolean;
  sameLanguageMinPurity: number;
  // Dictionary Mode
  dictionaryModeEnabled: boolean;
  dictionaryPrompt: string;
  // Translation Cache
  enableTranslationCache: boolean;
  translationCacheMaxEntries: number;
}

// ---------- Messages ----------
export type MessageType =
  | "GET_SETTINGS"
  | "SAVE_SETTINGS"
  | "TEST_PROVIDER"
  | "TRANSLATE_TEXT"
  | "TRANSLATE_BATCH"
  | "PAGE_TRANSLATE_START"
  | "PAGE_TRANSLATE_RESTORE"
  | "PAGE_TRANSLATE_STATUS"
  | "OPEN_OPTIONS_PAGE"
  | "SAVE_FLOATING_BALL_OPACITY"
  | "SAVE_FLOATING_BALL_ENABLED"
  | "SAVE_FLOATING_BALL_SIZE"
  | "SAVE_POPUP_SCALE";

export interface Message<T = unknown> {
  type: MessageType;
  payload?: T;
}

export interface GetSettingsMessage extends Message {
  type: "GET_SETTINGS";
}

export interface SaveSettingsMessage extends Message<AstraSettings> {
  type: "SAVE_SETTINGS";
}

export interface TestProviderMessage extends Message {
  type: "TEST_PROVIDER";
}

export interface TranslateTextMessage extends Message<{
  text: string;
  targetLang: string;
  sourceLang?: string;
  prompt?: string;
  mode?: "selection" | "manual";
  contextBefore?: string;
  contextAfter?: string;
  fullLineText?: string;
}> {
  type: "TRANSLATE_TEXT";
}

export interface TranslateBatchMessage extends Message<{
  items: { id: string; text: string }[];
  targetLang: string;
  prompt?: string;
}> {
  type: "TRANSLATE_BATCH";
}

export interface PageTranslateStartMessage extends Message {
  type: "PAGE_TRANSLATE_START";
}

export interface PageTranslateRestoreMessage extends Message {
  type: "PAGE_TRANSLATE_RESTORE";
}

export interface PageTranslateStatusMessage extends Message<PageTranslateStatus> {
  type: "PAGE_TRANSLATE_STATUS";
}

export interface OpenOptionsMessage extends Message {
  type: "OPEN_OPTIONS_PAGE";
}

// ---------- Responses ----------
export interface DictionaryResult {
  mode: "dictionary";
  selectedText: string;
  translation: string;
  partOfSpeech: string;
  pronunciation?: string;
  meanings: string[];
  contextMeaning: string;
  examples: { source: string; target: string }[];
  isTranslatable: boolean;
}

export interface TranslateResponse {
  success: boolean;
  translation?: string;
  error?: string;
  resolvedLang?: string;
  dictionaryResult?: DictionaryResult;
}

export interface TranslateBatchResponse {
  success: boolean;
  items?: { id: string; text: string }[];
  error?: string;
}

export interface TestProviderResponse {
  success: boolean;
  error?: string;
  model?: string;
}

// ---------- Page Translator ----------
export type PageTranslatePhase =
  | "idle"
  | "collecting"
  | "translating"
  | "done"
  | "error";

export interface PageTranslateStatus {
  phase: PageTranslatePhase;
  total: number;
  completed: number;
  failed: number;
  error?: string;
}

export interface TextNodeInfo {
  id: string;
  node: Text;
  originalText: string;
}
