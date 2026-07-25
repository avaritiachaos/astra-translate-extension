// ============================================================
// Astra Translate – Message Router
// ============================================================

import type {
  Message,
  TranslateTextMessage,
  TranslateBatchMessage,
  TranslateBatchStreamEvent,
  TranslateBatchStreamRequest,
  TestProviderResponse,
  TranslateResponse,
  TranslateBatchResponse,
  AstraSettings,
  DictionaryResult,
} from "../shared/types";
import { t, type UiLanguage } from "../shared/i18n";
import { getSettings, saveSettings } from "../shared/storage";
import { translateViaProvider, translateViaProviderStream } from "./providerClient";
import { ProviderRequestError, AstraError } from "./errors";
import { extractJson } from "../shared/utils";
import { PAGE_SEGMENT_SEPARATOR } from "../shared/constants";
import { resolveTargetLanguageForText, classifySelectedText, detectNonTranslatableKind, isSoftIdentifier } from "../shared/languageDetect";
import {
  createTranslationCacheKey,
  getCachedTranslation,
  getCachedTranslations,
  setCachedTranslation,
  setCachedTranslations,
} from "./translationCache";
import {
  clearSiteLexicon,
  getSiteLexiconMap,
  getSiteLexiconStats,
  learnSiteLexiconPairs,
} from "./siteLexiconStore";
import { StreamBatchItemParser } from "../shared/streamBatchParser";

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

    case "GET_SITE_LEXICON": {
      const payload = (msg as Message<{ host: string; targetLang: string }>).payload;
      if (!payload?.host || !payload?.targetLang) {
        return { success: true, map: {} as Record<string, string> };
      }
      const lexSettings = await getSettings();
      if (lexSettings.enableSiteLexicon === false) {
        return { success: true, map: {} as Record<string, string> };
      }
      const map = await getSiteLexiconMap(payload.host, payload.targetLang);
      return { success: true, map };
    }

    case "LEARN_SITE_LEXICON": {
      const payload = (msg as Message<{
        host: string;
        targetLang: string;
        pairs: Array<{ source: string; translation: string }>;
      }>).payload;
      if (!payload?.host || !payload?.targetLang || !payload.pairs?.length) {
        return { success: true, learned: 0 };
      }
      // Honour user setting — skip learning when disabled.
      const lexSettings = await getSettings();
      if (lexSettings.enableSiteLexicon === false) {
        return { success: true, learned: 0 };
      }
      const result = await learnSiteLexiconPairs(
        payload.host,
        payload.targetLang,
        payload.pairs
      );
      return { success: true, ...result };
    }

    case "CLEAR_SITE_LEXICON": {
      const payload = (msg as Message<{ host?: string }>).payload;
      const result = await clearSiteLexicon(payload?.host);
      return { success: true, ...result };
    }

    case "GET_SITE_LEXICON_STATS": {
      const stats = await getSiteLexiconStats();
      return { success: true, ...stats };
    }

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

  const { text, targetLang, prompt, mode, contextBefore, contextAfter, fullLineText } = msg.payload!;

  // Smart target language resolution:
  // When smart mode is active and the caller's targetLang is just the default
  // (not an explicit user override), let the resolver pick the best language.
  const effectiveMode = mode || "manual";
  const resolvedLang = resolveTargetLanguageForText(
    text,
    settings,
    effectiveMode === "selection" ? "selection" : "manual"
  );

  // If caller sent an explicit targetLang that differs from the default,
  // respect the caller's choice. Otherwise use the smart-resolved lang.
  const isExplicitOverride = targetLang && targetLang !== settings.defaultTargetLang;
  const finalTargetLang = isExplicitOverride ? targetLang : resolvedLang;

  // Classify the selection: hard-non-translatable / soft-identifier / dictionary / translate.
  const textClass = classifySelectedText(text, effectiveMode, settings);

  // Hard non-translatable (URL, email, path, code, command, hash): never translate.
  // Return the original text plus a kind so the UI can show a fitting hint —
  // no API call needed. The popup simply shows the unchanged text.
  if (textClass === "hard-non-translatable") {
    return {
      success: true,
      translation: text,
      resolvedLang: finalTargetLang,
      nonTranslatable: { kind: detectNonTranslatableKind(text) },
    };
  }

  if (textClass === "dictionary") {
    return handleDictionaryTranslation(
      settings, lang, text, finalTargetLang,
      contextBefore || "", contextAfter || "", fullLineText || "",
      isSoftIdentifier(text)
    );
  }

  // "soft-identifier" and "translate" both use plain translation; the prompt
  // preserves names / code / identifiers unchanged.

  const systemPrompt = (prompt || settings.selectionPrompt).replace(
    /\{\{targetLang\}\}/g,
    finalTargetLang
  );
  const cacheKey = await createTranslationCacheKey({
    mode: effectiveMode === "selection" ? "selection" : "manual",
    text,
    targetLang: finalTargetLang,
    systemPrompt,
    settings,
  });
  const cached = await getCachedTranslation(cacheKey, settings);
  if (cached) {
    return {
      success: true,
      translation: cached.translation,
      resolvedLang: cached.resolvedLang || finalTargetLang,
    };
  }

  if (!settings.apiKey) {
    return { success: false, error: t(lang, "error.apiKeyNotConfigured") };
  }

  try {
    const translation = await translateViaProvider(settings, systemPrompt, text, lang);
    await setCachedTranslation(
      cacheKey,
      { translation, resolvedLang: finalTargetLang },
      settings
    );
    return { success: true, translation, resolvedLang: finalTargetLang };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ProviderRequestError || err instanceof AstraError
        ? err.message
        : t(lang, "error.translationFailed"),
    };
  }
}

async function handleDictionaryTranslation(
  settings: AstraSettings,
  lang: UiLanguage,
  text: string,
  targetLang: string,
  contextBefore: string,
  contextAfter: string,
  fullLineText: string,
  possibleNameOrIdentifier = false,
): Promise<TranslateResponse> {
  const systemPrompt = settings.dictionaryPrompt.replace(
    /\{\{targetLang\}\}/g,
    targetLang
  );

  const userContent = JSON.stringify({
    targetLang,
    selectedText: text,
    contextBefore,
    contextAfter,
    fullLineText,
    possibleNameOrIdentifier,
  });
  const cacheKey = await createTranslationCacheKey({
    mode: "dictionary",
    text,
    targetLang,
    systemPrompt,
    settings,
    contextBefore,
    contextAfter,
    fullLineText,
  });
  const cached = await getCachedTranslation(cacheKey, settings);
  if (cached) {
    return {
      success: true,
      translation: cached.translation,
      resolvedLang: cached.resolvedLang || targetLang,
      dictionaryResult: cached.dictionaryResult,
    };
  }

  if (!settings.apiKey) {
    return { success: false, error: t(lang, "error.apiKeyNotConfigured") };
  }

  try {
    const raw = await translateViaProvider(settings, systemPrompt, userContent, lang);

    // Try to parse as JSON
    let parsed: DictionaryResult | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const jsonStr = extractJson(raw);
      if (jsonStr) {
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          // Give up on JSON parsing
        }
      }
    }

    // Validate the parsed result has required fields
    if (parsed && parsed.mode === "dictionary" && parsed.selectedText) {
      // Clamp arrays to max sizes
      if (parsed.meanings && parsed.meanings.length > 4) {
        parsed.meanings = parsed.meanings.slice(0, 4);
      }
      if (parsed.examples && parsed.examples.length > 3) {
        parsed.examples = parsed.examples.slice(0, 3);
      }
      // Ensure pronunciation is a string or absent
      if (parsed.pronunciation && typeof parsed.pronunciation !== "string") {
        (parsed as any).pronunciation = undefined;
      }
      const translation = parsed.translation || text;
      await setCachedTranslation(
        cacheKey,
        { translation, resolvedLang: targetLang, dictionaryResult: parsed },
        settings
      );
      return {
        success: true,
        translation,
        resolvedLang: targetLang,
        dictionaryResult: parsed,
      };
    }

    // JSON parse failed or invalid format — fall back to plain translation
    await setCachedTranslation(
      cacheKey,
      { translation: raw, resolvedLang: targetLang },
      settings
    );
    return {
      success: true,
      translation: raw,
      resolvedLang: targetLang,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ProviderRequestError || err instanceof AstraError
        ? err.message
        : t(lang, "error.translationFailed"),
    };
  }
}

function buildPageSystemPrompt(
  settings: AstraSettings,
  targetLang: string,
  items: { id: string; text: string }[],
  prompt?: string
): string {
  let systemPrompt = (prompt || settings.pagePrompt).replace(
    /\{\{targetLang\}\}/g,
    targetLang
  );

  // When any item bundles several block fragments (joined by the separator),
  // append a hard rule so the model preserves the separators exactly — this
  // holds even if the user has customized their page prompt. The content side
  // splits on these to map each segment back to its original text node.
  if (items.some((item) => item.text.includes(PAGE_SEGMENT_SEPARATOR))) {
    systemPrompt +=
      `\n\n- Some items contain a separator character (U+E000) joining fragments of one passage. ` +
      `Keep EXACTLY the same number of these separators in each such item, in the same order. ` +
      `Translate the text between separators together as one coherent passage, but return each ` +
      `fragment's translation in its own segment. Never add, remove, merge, reorder, or output an empty segment.`;
  }
  return systemPrompt;
}

async function handleTranslateBatch(
  msg: TranslateBatchMessage
): Promise<TranslateBatchResponse> {
  const settings = await getSettings();
  const lang = getLang(settings);

  const { items, targetLang, prompt } = msg.payload!;
  const finalTargetLang = targetLang || settings.defaultTargetLang;
  const systemPrompt = buildPageSystemPrompt(settings, finalTargetLang, items, prompt);

  const prepared = await prepareBatchCache(items, finalTargetLang, systemPrompt, settings);
  if (prepared.misses.length === 0) {
    return {
      success: true,
      items: items.map((item) => ({
        id: item.id,
        text: prepared.translatedById.get(item.id) || item.text,
      })),
    };
  }

  if (!settings.apiKey) {
    return { success: false, error: t(lang, "error.apiKeyNotConfigured") };
  }

  const requestItems = prepared.misses.map((record) => record.item);
  const userInput = JSON.stringify({
    targetLang: finalTargetLang,
    items: requestItems,
  });

  try {
    const raw = await translateViaProvider(settings, systemPrompt, userInput, lang);
    const parsed = parseBatchResponse(raw);
    if (!parsed) {
      return { success: false, error: t(lang, "error.invalidBatchResponse") };
    }

    await commitBatchResults(
      parsed,
      prepared,
      finalTargetLang,
      settings
    );

    return {
      success: true,
      items: items
        .filter((item) => prepared.translatedById.has(item.id))
        .map((item) => ({ id: item.id, text: prepared.translatedById.get(item.id)! })),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ProviderRequestError || err instanceof AstraError
        ? err.message
        : t(lang, "error.batchFailed"),
    };
  }
}

type CacheRecord = {
  item: { id: string; text: string };
  key: string;
};

async function prepareBatchCache(
  items: { id: string; text: string }[],
  finalTargetLang: string,
  systemPrompt: string,
  settings: AstraSettings
): Promise<{
  translatedById: Map<string, string>;
  misses: CacheRecord[];
  missById: Map<string, CacheRecord>;
}> {
  const cacheRecords = await Promise.all(
    items.map(async (item) => ({
      item,
      key: await createTranslationCacheKey({
        mode: "page",
        text: item.text,
        targetLang: finalTargetLang,
        systemPrompt,
        settings,
      }),
    }))
  );
  const cached = await getCachedTranslations(
    cacheRecords.map((record) => record.key),
    settings
  );
  const translatedById = new Map<string, string>();
  const misses: CacheRecord[] = [];

  for (const record of cacheRecords) {
    const hit = cached.get(record.key);
    if (hit) {
      translatedById.set(record.item.id, hit.translation);
    } else {
      misses.push(record);
    }
  }

  return {
    translatedById,
    misses,
    missById: new Map(misses.map((r) => [r.item.id, r])),
  };
}

function parseBatchResponse(
  raw: string
): { items: { id: string; text: string }[] } | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.items && Array.isArray(parsed.items)) return parsed;
  } catch {
    const jsonStr = extractJson(raw);
    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed?.items && Array.isArray(parsed.items)) return parsed;
      } catch {
        // give up
      }
    }
  }
  return null;
}

async function commitBatchResults(
  parsed: { items: { id: string; text: string }[] },
  prepared: {
    translatedById: Map<string, string>;
    missById: Map<string, CacheRecord>;
  },
  finalTargetLang: string,
  settings: AstraSettings
): Promise<void> {
  const cacheWrites: Array<{
    key: string;
    value: { translation: string; resolvedLang: string };
  }> = [];

  for (const translated of parsed.items) {
    if (typeof translated?.id !== "string" || typeof translated?.text !== "string") {
      continue;
    }
    prepared.translatedById.set(translated.id, translated.text);
    const record = prepared.missById.get(translated.id);
    if (record) {
      cacheWrites.push({
        key: record.key,
        value: { translation: translated.text, resolvedLang: finalTargetLang },
      });
    }
  }

  await setCachedTranslations(cacheWrites, settings);
}

/**
 * Streaming batch translation over a long-lived port.
 * Emits {type:"item"} as each JSON object completes, then {type:"done"}.
 */
export async function handleTranslateBatchStream(
  msg: TranslateBatchStreamRequest,
  post: (event: TranslateBatchStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const settings = await getSettings();
  const lang = getLang(settings);
  const payload = msg.payload;
  if (!payload?.items?.length) {
    post({ type: "done", success: false, error: t(lang, "error.batchFailed"), items: [] });
    return;
  }

  const { items, targetLang, prompt } = payload;
  const finalTargetLang = targetLang || settings.defaultTargetLang;
  const systemPrompt = buildPageSystemPrompt(settings, finalTargetLang, items, prompt);

  const prepared = await prepareBatchCache(items, finalTargetLang, systemPrompt, settings);

  // Emit cache hits immediately so the page paints without waiting for the model.
  for (const [id, text] of prepared.translatedById) {
    post({ type: "item", id, text });
  }

  if (prepared.misses.length === 0) {
    post({
      type: "done",
      success: true,
      items: items.map((item) => ({
        id: item.id,
        text: prepared.translatedById.get(item.id) || item.text,
      })),
    });
    return;
  }

  if (!settings.apiKey) {
    post({
      type: "done",
      success: false,
      error: t(lang, "error.apiKeyNotConfigured"),
      items: items
        .filter((item) => prepared.translatedById.has(item.id))
        .map((item) => ({ id: item.id, text: prepared.translatedById.get(item.id)! })),
    });
    return;
  }

  const requestItems = prepared.misses.map((record) => record.item);
  const userInput = JSON.stringify({
    targetLang: finalTargetLang,
    items: requestItems,
  });

  const parser = new StreamBatchItemParser();
  const streamedIds = new Set<string>();

  try {
    const raw = await translateViaProviderStream(
      settings,
      systemPrompt,
      userInput,
      (delta) => {
        const news = parser.push(delta);
        for (const item of news) {
          if (streamedIds.has(item.id)) continue;
          streamedIds.add(item.id);
          prepared.translatedById.set(item.id, item.text);
          post({ type: "item", id: item.id, text: item.text });
        }
      },
      lang,
      signal
    );

    // Catch any trailing complete objects.
    for (const item of parser.finish()) {
      if (streamedIds.has(item.id)) continue;
      streamedIds.add(item.id);
      prepared.translatedById.set(item.id, item.text);
      post({ type: "item", id: item.id, text: item.text });
    }

    // Prefer full JSON parse when possible (more reliable id/text mapping).
    const parsed = parseBatchResponse(raw) || parseBatchResponse(parser.raw);
    if (parsed) {
      for (const item of parsed.items) {
        if (typeof item?.id !== "string" || typeof item?.text !== "string") continue;
        if (!prepared.translatedById.has(item.id)) {
          prepared.translatedById.set(item.id, item.text);
          post({ type: "item", id: item.id, text: item.text });
        } else {
          // Prefer final parse text if it differs (model corrected mid-stream).
          prepared.translatedById.set(item.id, item.text);
        }
      }
      await commitBatchResults(parsed, prepared, finalTargetLang, settings);
    } else if (streamedIds.size > 0) {
      // Partial stream success without a final parse — cache what we have.
      await commitBatchResults(
        {
          items: Array.from(streamedIds, (id) => ({
            id,
            text: prepared.translatedById.get(id)!,
          })),
        },
        prepared,
        finalTargetLang,
        settings
      );
    } else {
      post({
        type: "done",
        success: false,
        error: t(lang, "error.invalidBatchResponse"),
        items: items
          .filter((item) => prepared.translatedById.has(item.id))
          .map((item) => ({ id: item.id, text: prepared.translatedById.get(item.id)! })),
      });
      return;
    }

    post({
      type: "done",
      success: true,
      items: items
        .filter((item) => prepared.translatedById.has(item.id))
        .map((item) => ({ id: item.id, text: prepared.translatedById.get(item.id)! })),
    });
  } catch (err) {
    const partial = items
      .filter((item) => prepared.translatedById.has(item.id))
      .map((item) => ({ id: item.id, text: prepared.translatedById.get(item.id)! }));

    // Cache whatever streamed successfully before the error.
    if (partial.length > 0) {
      await commitBatchResults(
        { items: partial.filter((p) => prepared.missById.has(p.id)) },
        prepared,
        finalTargetLang,
        settings
      ).catch(() => {});
    }

    post({
      type: "done",
      success: partial.length > 0,
      error:
        partial.length > 0
          ? undefined
          : err instanceof ProviderRequestError || err instanceof AstraError
            ? err.message
            : t(lang, "error.batchFailed"),
      items: partial,
    });
  }
}
