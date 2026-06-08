// ============================================================
// Astra Translate – Message Router
// ============================================================

import type {
  Message,
  TranslateTextMessage,
  TranslateBatchMessage,
  TestProviderResponse,
  TranslateResponse,
  TranslateBatchResponse,
  AstraSettings,
} from "../shared/types";
import { t, type UiLanguage } from "../shared/i18n";
import { getSettings, saveSettings } from "../shared/storage";
import { translateViaProvider } from "./providerClient";
import { ProviderRequestError, AstraError } from "./errors";
import { extractJson } from "../shared/utils";

/**
 * Handle all messages from popup / options / content scripts.
 */
export async function handleMessage(
  msg: Message,
  _sender?: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (msg.type) {
    case "GET_SETTINGS":
      return getSettings();

    case "SAVE_SETTINGS":
      await saveSettings(msg.payload as AstraSettings);
      return { success: true };

    case "TEST_PROVIDER":
      // Use settings from message payload if provided (draft settings from form),
      // otherwise read from storage
      return testProvider((msg as any).settings as AstraSettings | undefined);

    case "TRANSLATE_TEXT":
      return handleTranslateText(msg as TranslateTextMessage);

    case "TRANSLATE_BATCH":
      return handleTranslateBatch(msg as TranslateBatchMessage);

    case "OPEN_OPTIONS_PAGE":
      chrome.runtime.openOptionsPage();
      return { success: true };

    case "SAVE_FLOATING_BALL_OPACITY": {
      const settings = await getSettings();
      settings.floatingBallOpacity = (msg.payload as any)?.opacity ?? settings.floatingBallOpacity;
      await saveSettings(settings);
      return { success: true };
    }

    case "SAVE_FLOATING_BALL_ENABLED": {
      const settings = await getSettings();
      settings.enableFloatingBall = (msg.payload as any)?.enabled ?? settings.enableFloatingBall;
      await saveSettings(settings);
      return { success: true };
    }

    case "SAVE_FLOATING_BALL_SIZE": {
      const settings = await getSettings();
      settings.floatingBallSize = (msg.payload as any)?.size ?? settings.floatingBallSize;
      await saveSettings(settings);
      return { success: true };
    }

    case "SAVE_POPUP_SCALE": {
      const settings = await getSettings();
      settings.popupScale = (msg.payload as any)?.scale ?? settings.popupScale;
      await saveSettings(settings);
      return { success: true };
    }

    default:
      return { success: false, error: `Unknown message type: ${(msg as any).type}` };
  }
}

function getLang(settings: AstraSettings): UiLanguage {
  return settings.uiLanguage || "zh-CN";
}

async function testProvider(draftSettings?: AstraSettings): Promise<TestProviderResponse> {
  const settings = draftSettings || await getSettings();
  const lang = getLang(settings);

  if (!settings.apiKey) {
    return { success: false, error: t(lang, "error.apiKeyNotConfigured") };
  }
  try {
    await translateViaProvider(
      settings,
      "You are a translator. Translate the user's text into Simplified Chinese. Return the translation only.",
      "Hello, world!",
      lang
    );
    return { success: true, model: settings.model };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function handleTranslateText(
  msg: TranslateTextMessage
): Promise<TranslateResponse> {
  const settings = await getSettings();
  const lang = getLang(settings);

  if (!settings.apiKey) {
    return { success: false, error: t(lang, "error.apiKeyNotConfigured") };
  }

  const { text, targetLang, prompt } = msg.payload!;
  const systemPrompt = (prompt || settings.selectionPrompt).replace(
    /\{\{targetLang\}\}/g,
    targetLang || settings.defaultTargetLang
  );

  try {
    const translation = await translateViaProvider(settings, systemPrompt, text, lang);
    return { success: true, translation };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ProviderRequestError || err instanceof AstraError
        ? err.message
        : t(lang, "error.translationFailed"),
    };
  }
}

async function handleTranslateBatch(
  msg: TranslateBatchMessage
): Promise<TranslateBatchResponse> {
  const settings = await getSettings();
  const lang = getLang(settings);

  if (!settings.apiKey) {
    return { success: false, error: t(lang, "error.apiKeyNotConfigured") };
  }

  const { items, targetLang, prompt } = msg.payload!;
  const systemPrompt = (prompt || settings.pagePrompt).replace(
    /\{\{targetLang\}\}/g,
    targetLang || settings.defaultTargetLang
  );

  const userInput = JSON.stringify({
    targetLang: targetLang || settings.defaultTargetLang,
    items,
  });

  try {
    const raw = await translateViaProvider(settings, systemPrompt, userInput, lang);

    let parsed: { items: { id: string; text: string }[] } | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const jsonStr = extractJson(raw);
      if (jsonStr) {
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          // Give up
        }
      }
    }

    if (!parsed?.items || !Array.isArray(parsed.items)) {
      return {
        success: false,
        error: t(lang, "error.invalidBatchResponse"),
      };
    }

    return { success: true, items: parsed.items };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ProviderRequestError || err instanceof AstraError
        ? err.message
        : t(lang, "error.batchFailed"),
    };
  }
}
