// ============================================================
// Astra Translate - Manga reasoning effort adapter
// ============================================================

import type { UserProviderSettings } from "../types";
import type { MangaThinkingEffort } from "./types";

/**
 * Build optional request body parameters for manga vision translation.
 * Safe for:
 * 1. Google Gemini models (AI Studio direct & CPA reverse proxies)
 * 2. OpenAI reasoning models (o1, o3, o4)
 * 3. OpenAI standard vision models (gpt-4o, gpt-4o-mini, gpt-4-turbo) -> omitted to avoid 400
 * 4. DeepSeek models
 * 5. Anthropic Claude and other non-reasoning vision models -> omitted to avoid 400
 */
export function buildMangaEffortBody(
  provider: UserProviderSettings,
  effort: MangaThinkingEffort = "low"
): Record<string, unknown> {
  if (effort === "default") {
    return {};
  }

  const modelLower = (provider.model || "").toLowerCase();
  const isGoogle = provider.providerId === "google-gemini" || modelLower.includes("gemini");
  const isDeepSeek = provider.providerId === "deepseek" || modelLower.includes("deepseek");
  const isOpenAiReasoning = /^(o1|o3|o4)(\b|-)/i.test(modelLower);

  if (isGoogle) {
    if (effort === "off") {
      // Gemini 2.5 Flash supports "none", but Gemini 3 does not support turning off reasoning.
      // For safety across Google AI Studio and proxies:
      // If model is Gemini 2.5 (non-Pro), send "none". Otherwise (Gemini 3/unknown), fall back to "low".
      if (modelLower.includes("2.5") && !modelLower.includes("pro")) {
        return { reasoning_effort: "none" };
      }
      return { reasoning_effort: "low" };
    }
    if (effort === "low") {
      return { reasoning_effort: "low" };
    }
    if (effort === "medium") {
      return { reasoning_effort: "medium" };
    }
    if (effort === "high") {
      return { reasoning_effort: "high" };
    }
    return {};
  }

  if (isDeepSeek) {
    if (effort === "off") {
      return { thinking: { type: "disabled" } };
    }
    if (effort === "high") {
      return { thinking: { type: "enabled" }, reasoning_effort: "high" };
    }
    return { thinking: { type: "enabled" } };
  }

  if (isOpenAiReasoning) {
    if (effort === "off") {
      return {};
    }
    return { reasoning_effort: effort };
  }

  if (effort === "off" && provider.disableThinking) {
    return { thinking: false };
  }

  // Non-reasoning models (GPT-4o, Claude, generic VLMs):
  // OpenAI API returns HTTP 400 if `reasoning_effort` is supplied for gpt-4o!
  // Anthropic / Ollama may also reject or fail.
  // Therefore, omit thinking parameters for these models.
  return {};
}