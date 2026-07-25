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
  /** Translate the entire page at once. When false (default), translation is
   * viewport-first: only the visible area is translated, the rest as you scroll. */
  translateWholePage: boolean;
  /** Also translate page chrome (nav / header / footer / aside). Off by default
   * to save tokens and avoid rewriting site furniture. */
  translatePageChrome: boolean;
  /** Also translate UI control labels: <button> text, submit/button/reset
   * input values, and placeholders. Off by default. Typed field values stay skipped. */
  translateUiControls: boolean;
  /**
   * Stream page-batch model output and apply each item as soon as it completes.
   * Faster perceived latency; falls back to one-shot if the stream path fails.
   */
  enableStreamingPageTranslate: boolean;
  /**
   * Learn short UI labels per hostname and reuse them on later visits (zero API).
   */
  enableSiteLexicon: boolean;
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
  | "GET_SITE_LEXICON"
  | "LEARN_SITE_LEXICON"
  | "CLEAR_SITE_LEXICON"
  | "GET_SITE_LEXICON_STATS"
  | "PAGE_TRANSLATE_START"
  | "PAGE_TRANSLATE_RESTORE"
  | "PAGE_TRANSLATE_STATUS"
  | "OPEN_OPTIONS_PAGE"
  | "SAVE_FLOATING_BALL_OPACITY"
  | "SAVE_FLOATING_BALL_ENABLED"
  | "SAVE_FLOATING_BALL_SIZE"
  | "SAVE_POPUP_SCALE";

/** Port name for streaming page-batch translation (content ↔ service worker). */
export const TRANSLATE_BATCH_STREAM_PORT = "astra-translate-batch-stream";

export interface TranslateBatchStreamRequest {
  type: "TRANSLATE_BATCH_STREAM";
  payload: {
    items: { id: string; text: string }[];
    targetLang: string;
    prompt?: string;
  };
}

export type TranslateBatchStreamEvent =
  | { type: "item"; id: string; text: string }
  | {
      type: "done";
      success: boolean;
      items: { id: string; text: string }[];
      error?: string;
    };

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
  /** True when the model judges the text to be a name / username / ID kept unchanged. */
  isNameOrIdentifier?: boolean;
  /** Short note, e.g. word origin, or why it is kept unchanged. */
  note?: string;
}

/** Kind of hard-non-translatable content, used to pick a fitting UI hint. */
export type NonTranslatableKind = "url" | "email" | "path" | "code" | "hash" | "generic";

export interface NonTranslatableInfo {
  kind: NonTranslatableKind;
}

export interface TranslateResponse {
  success: boolean;
  translation?: string;
  error?: string;
  resolvedLang?: string;
  dictionaryResult?: DictionaryResult;
  /** Present when the text is hard-non-translatable (link/path/code/command/hash). */
  nonTranslatable?: NonTranslatableInfo;
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
