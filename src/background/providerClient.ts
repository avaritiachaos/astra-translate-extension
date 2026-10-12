// ============================================================
// Astra Translate – Unified Provider Client
// ============================================================

import type { UserProviderSettings, UnifiedChatMessage as ChatMessage } from "../shared/types.ts";
import { t, type UiLanguage } from "../shared/i18n.ts";
import {
  openAIChat,
  openAIChatStream,
  type ExtraRequestOptions,
} from "./openAICompatibleClient.ts";
import { deeplTranslate } from "./deeplClient.ts";

export type { ChatMessage, ExtraRequestOptions };

function messagesOf(systemPrompt: string, userContent: string): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
}

/** Target language used when a DeepL call site doesn't pass one explicitly. */
function deeplTargetOf(settings: UserProviderSettings, targetLang?: string): string {
  if (targetLang && targetLang.trim()) return targetLang;
  const fallback = (settings as { defaultTargetLang?: string }).defaultTargetLang;
  return fallback && fallback.trim() ? fallback : "Simplified Chinese";
}

/**
 * Multi-turn chat completion (popup chat mode). Same provider dispatch and
 * retry/backoff stack as translation, but the caller owns the messages array
 * and may pass per-request options (thinking effort).
 */
export async function chatViaProvider(
  settings: UserProviderSettings,
  messages: ChatMessage[],
  lang: UiLanguage = "zh-CN",
  extra?: ExtraRequestOptions
): Promise<string> {
  switch (settings.apiFormat) {
    case "openai-compatible":
      return openAIChat(settings, messages, lang, extra);

    case "deepl":
      // DeepL has no chat surface. Callers (chatService) resolve a fallback
      // LLM provider first; this guard catches any call site that forgets.
      throw new Error(t(lang, "error.deeplTextOnly"));

    case "gemini-compatible":
      throw new Error(t(lang, "error.geminiNotImplemented"));

    case "anthropic-compatible":
      throw new Error(t(lang, "error.anthropicNotImplemented"));

    default:
      throw new Error(t(lang, "error.unknownApiFormat", { format: settings.apiFormat }));
  }
}

/**
 * Streaming multi-turn chat: onDelta fires per content fragment.
 * Formats without a stream path emit the full text once.
 */
export async function chatViaProviderStream(
  settings: UserProviderSettings,
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  lang: UiLanguage = "zh-CN",
  signal?: AbortSignal,
  extra?: ExtraRequestOptions
): Promise<string> {
  switch (settings.apiFormat) {
    case "openai-compatible":
      return openAIChatStream(settings, messages, onDelta, lang, signal, extra);

    default: {
      const full = await chatViaProvider(settings, messages, lang, extra);
      if (full) onDelta(full);
      return full;
    }
  }
}

/**
 * Unified translate function – dispatches to the correct provider client
 * based on the user's configured apiFormat. `targetLang` is required by the
 * DeepL path (MT has no prompt surface); LLM paths ignore it — the target
 * language lives inside the system prompt.
 */
export async function translateViaProvider(
  settings: UserProviderSettings,
  systemPrompt: string,
  userContent: string,
  lang: UiLanguage = "zh-CN",
  targetLang?: string
): Promise<string> {
  const messages = messagesOf(systemPrompt, userContent);

  switch (settings.apiFormat) {
    case "openai-compatible":
      return openAIChat(settings, messages, lang);

    case "deepl":
      return deeplTranslate(settings, userContent, deeplTargetOf(settings, targetLang), lang);

    case "gemini-compatible":
      throw new Error(t(lang, "error.geminiNotImplemented"));

    case "anthropic-compatible":
      throw new Error(t(lang, "error.anthropicNotImplemented"));

    default:
      throw new Error(t(lang, "error.unknownApiFormat", { format: settings.apiFormat }));
  }
}

/**
 * Streaming variant: calls onDelta for each content fragment.
 * Falls back to one-shot translate when the format has no stream support.
 */
export async function translateViaProviderStream(
  settings: UserProviderSettings,
  systemPrompt: string,
  userContent: string,
  onDelta: (delta: string) => void,
  lang: UiLanguage = "zh-CN",
  signal?: AbortSignal,
  targetLang?: string
): Promise<string> {
  const messages = messagesOf(systemPrompt, userContent);

  switch (settings.apiFormat) {
    case "openai-compatible":
      return openAIChatStream(settings, messages, onDelta, lang, signal);

    case "deepl":
    case "gemini-compatible":
    case "anthropic-compatible":
    default: {
      // No stream path — emit full text once.
      const full = await translateViaProvider(
        settings, systemPrompt, userContent, lang, targetLang,
      );
      if (full) onDelta(full);
      return full;
    }
  }
}
