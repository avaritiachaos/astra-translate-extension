// ============================================================
// Astra Translate – Unified Provider Client
// ============================================================

import type { UserProviderSettings } from "../shared/types";
import { t, type UiLanguage } from "../shared/i18n";
import { openAIChat, openAIChatStream } from "./openAICompatibleClient";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function messagesOf(systemPrompt: string, userContent: string): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
}

/**
 * Multi-turn chat completion (popup chat mode). Same provider dispatch and
 * retry/backoff stack as translation, but the caller owns the messages array.
 */
export async function chatViaProvider(
  settings: UserProviderSettings,
  messages: ChatMessage[],
  lang: UiLanguage = "zh-CN"
): Promise<string> {
  switch (settings.apiFormat) {
    case "openai-compatible":
      return openAIChat(settings, messages, lang);

    case "gemini-compatible":
      throw new Error(t(lang, "error.geminiNotImplemented"));

    case "anthropic-compatible":
      throw new Error(t(lang, "error.anthropicNotImplemented"));

    default:
      throw new Error(t(lang, "error.unknownApiFormat", { format: settings.apiFormat }));
  }
}

/**
 * Unified translate function – dispatches to the correct provider client
 * based on the user's configured apiFormat.
 */
export async function translateViaProvider(
  settings: UserProviderSettings,
  systemPrompt: string,
  userContent: string,
  lang: UiLanguage = "zh-CN"
): Promise<string> {
  const messages = messagesOf(systemPrompt, userContent);

  switch (settings.apiFormat) {
    case "openai-compatible":
      return openAIChat(settings, messages, lang);

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
  signal?: AbortSignal
): Promise<string> {
  const messages = messagesOf(systemPrompt, userContent);

  switch (settings.apiFormat) {
    case "openai-compatible":
      return openAIChatStream(settings, messages, onDelta, lang, signal);

    case "gemini-compatible":
    case "anthropic-compatible":
    default: {
      // No stream path — emit full text once.
      const full = await translateViaProvider(settings, systemPrompt, userContent, lang);
      if (full) onDelta(full);
      return full;
    }
  }
}
