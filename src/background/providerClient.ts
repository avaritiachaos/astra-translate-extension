// ============================================================
// Astra Translate – Unified Provider Client
// ============================================================

import type { UserProviderSettings } from "../shared/types";
import { t, type UiLanguage } from "../shared/i18n";
import { openAIChat } from "./openAICompatibleClient";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

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
