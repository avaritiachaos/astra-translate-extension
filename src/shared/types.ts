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
  // Popup chat mode — system prompt ({{lang}} = answer-language placeholder).
  chatPrompt: string;
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
  | "TOUCH_SITE_LEXICON"
  | "CLEAR_SITE_LEXICON"
  | "GET_SITE_LEXICON_STATS"
  | "PAGE_TRANSLATE_START"
  | "PAGE_TRANSLATE_RESTORE"
  | "PAGE_TRANSLATE_STATUS"
  | "CHAT_MESSAGE"
  | "GET_CHAT_STATE"
  | "CLEAR_CHAT"
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
    /** Correlates events with this request if a port ever carries more than
     * one — events are echoed back tagged with the same id. */
    requestId?: string;
  };
}

export type TranslateBatchStreamEvent =
  | { type: "item"; id: string; text: string; requestId?: string }
  | {
      type: "done";
      success: boolean;
      items: { id: string; text: string }[];
      error?: string;
      /** Structured provider error code (e.g. RATE_LIMIT / TIMEOUT / AUTH_ERROR)
       * so the content side can classify without sniffing localized text. */
      errorCode?: string;
      requestId?: string;
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
  /** Structured provider error code (e.g. RATE_LIMIT / TIMEOUT / AUTH_ERROR). */
  errorCode?: string;
}

export interface TestProviderResponse {
  success: boolean;
  error?: string;
  model?: string;
}

// ---------- Ephemeral chat (popup "chat" mode) ----------

/** chrome.storage.session key holding the one browser-session conversation.
 * Session storage survives popup close and SW idle death, and clears when
 * the browser exits — chats are deliberately ephemeral. */
export const CHAT_STORAGE_KEY = "astra_chat_v1";
/** chrome.storage.session key remembering which popup tab was last active. */
export const POPUP_MODE_STORAGE_KEY = "astra_popup_mode_v1";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  ts: number;
  /** Assistant turn that reports a provider failure instead of an answer.
   * Rendered in the list, but never sent back to the model as context. */
  error?: boolean;
}

export interface ChatState {
  turns: ChatTurn[];
  /** A request is in flight in the service worker. */
  pending: boolean;
  /** Bumped on clear — in-flight results from an older generation are dropped. */
  gen: number;
}

export interface ChatResponse {
  success: boolean;
  error?: string;
  errorCode?: string;
  /** True when a failed reply was appended to the conversation as an error
   * turn (already visible in the list); false for pre-flight rejections
   * (missing key / busy / empty input) the popup must surface itself. */
  appended?: boolean;
}

/** Port name for streaming chat replies (popup ↔ service worker). */
export const CHAT_STREAM_PORT = "astra-chat-stream";

export interface ChatStreamRequest {
  type: "CHAT_STREAM";
  payload: {
    text: string;
    /** Correlates events with this request if a port ever carries more than
     * one — events are echoed back tagged with the same id. */
    requestId?: string;
  };
}

export type ChatStreamEvent =
  | { type: "delta"; text: string; requestId?: string }
  | ({ type: "done"; requestId?: string } & ChatResponse);

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
