// ============================================================
// Astra Translate – OpenAI-compatible Client
// ============================================================

import type { UserProviderSettings } from "../shared/types";
import { t, type UiLanguage } from "../shared/i18n";
import {
  mapHttpError,
  isTimeoutError,
  isNetworkError,
  ProviderRequestError,
} from "./errors";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CompletionChoice {
  message: { content: string };
}

interface CompletionResponse {
  choices: CompletionChoice[];
}

/**
 * Send a single chat completion request to an OpenAI-compatible endpoint.
 */
export async function openAIChat(
  settings: UserProviderSettings,
  messages: ChatMessage[],
  lang: UiLanguage = "zh-CN"
): Promise<string> {
  const { baseUrl, endpoint, apiKey, model, temperature, timeoutMs, disableThinking, providerId } = settings;

  if (!apiKey) {
    throw new ProviderRequestError(t(lang, "error.apiKeyNotConfigured"), "API_KEY_MISSING");
  }

  const url = `${baseUrl.replace(/\/+$/, "")}${endpoint}`;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    stream: false,
  };

  if (providerId === "deepseek" && disableThinking) {
    body.thinking = { type: "disabled" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      if (providerId === "deepseek" && disableThinking && res.status === 400) {
        delete body.thinking;
        const retryRes = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!retryRes.ok) {
          throw mapHttpError(retryRes.status, lang);
        }
        const retryData = (await retryRes.json()) as CompletionResponse;
        return extractContent(retryData, lang);
      }
      throw mapHttpError(res.status, lang);
    }

    const data = (await res.json()) as CompletionResponse;
    return extractContent(data, lang);
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new ProviderRequestError(t(lang, "error.timeout"), "TIMEOUT");
    }
    if (isNetworkError(err)) {
      throw new ProviderRequestError(t(lang, "error.network"), "NETWORK_ERROR");
    }
    if (err instanceof ProviderRequestError) throw err;
    throw new ProviderRequestError(
      `${t(lang, "error.unknown")}: ${(err as Error).message}`,
      "UNKNOWN"
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractContent(data: CompletionResponse, lang: UiLanguage = "zh-CN"): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new ProviderRequestError(t(lang, "error.invalidResponse"), "PARSE_ERROR");
  }
  return content.trim();
}
