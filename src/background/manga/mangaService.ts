import type { AstraSettings } from "../../shared/types";
import type { MangaJob, MangaSource } from "../../shared/manga/types";
import { MANGA_ACTIVE_PHASES } from "../../shared/manga/types";
import { imageSourceAllowed } from "../../shared/manga/imageGeometry";
import { loadMangaJob, saveMangaJob } from "../../shared/manga/store";
import { chatScopeForSender } from "../../shared/chatScope";
import { getSettings } from "../../shared/storage";
import { listProviderModels } from "../providerModels";
import { handleMangaReading, automaticMangaAllowed } from "./mangaReadingService";
import { resolveMangaConfiguration } from "../../shared/manga/configuration";
import { t } from "../../shared/i18n";
import {
  hasOffscreenDocument,
  sendOffscreenCommand,
  closeIdleOffscreenDocument,
} from "../offscreenManager";
const pending = new Map<string, string>();
function extensionPage(sender?: chrome.runtime.MessageSender) {
  return (
    sender?.id === chrome.runtime.id &&
    sender.url?.startsWith(chrome.runtime.getURL(""))
  );
}
export async function handleMangaMessage(
  msg: { type: string; payload?: any },
  sender?: chrome.runtime.MessageSender,
): Promise<any> {
  if (msg.type === "OFFSCREEN_IDLE") {
    if (
      !extensionPage(sender) ||
      sender?.tab ||
      sender?.url !== chrome.runtime.getURL("offscreen.html")
    )
      return { success: false };
    await closeIdleOffscreenDocument();
    return { success: true };
  }
  const owner = chatScopeForSender(sender, chrome.runtime.id);
  if (!owner) return { success: false, errorCode: "SENDER_DENIED" };
  if (msg.type.startsWith("MANGA_READING_")) return handleMangaReading(msg, sender!, owner,
    (source, token) => handleMangaMessage({ type: "MANGA_START", payload: { imageUrl: source, imageToken: token } }, sender));
  if (msg.type === "MANGA_START" && msg.payload?.automatic === true && !await automaticMangaAllowed(sender!, msg.payload?.imageUrl))
    return { success: false, inactive: true };
  const saved = await getSettings();
  const lang = saved.uiLanguage;
  if (msg.type === "MANGA_PREFERENCES")
    return {
      success: true,
      language: lang,
      targetLanguage: saved.manga.targetLanguage,
      configuration: resolveMangaConfiguration(saved).status,
    };
  if (msg.type === "MANGA_MODELS") {
    if (!extensionPage(sender)) return { success: false, errorCode: "SENDER_DENIED" };
    const draft: AstraSettings = {
      ...saved, ...msg.payload?.settings,
      manga: { ...saved.manga, ...msg.payload?.settings?.manga },
    };
    const { provider, status } = resolveMangaConfiguration(draft, { requireModel: false });
    if (!status.ready) return { success: false, error: status.error, errorCode: status.errorCode };
    return listProviderModels(provider, lang);
  }
  if (msg.type === "MANGA_STATUS" || msg.type === "MANGA_CANCEL") {
    const id = msg.payload?.id;
    if (typeof id !== "string" || id.length > 100) return { success: false };
    const stored = await loadMangaJob(id);
    if (!stored || stored.owner !== owner)
      return { success: false, error: t(lang, "manga.interrupted") };
    if (MANGA_ACTIVE_PHASES.has(stored.phase)) {
      if (await hasOffscreenDocument()) {
        const result = await sendOffscreenCommand({
          type: msg.type,
          payload: { id, owner },
        });
        if (msg.type === "MANGA_STATUS" && result?.job)
          return { success: true, job: result.job };
      }
      stored.phase = msg.type === "MANGA_CANCEL" ? "cancelled" : "interrupted";
      stored.revision++;
      stored.updatedAt = Date.now();
      stored.error = t(lang, "manga.interrupted");
      await saveMangaJob(stored);
    }
    return { success: true, job: stored };
  }
  if (msg.type !== "MANGA_START" && msg.type !== "MANGA_PROBE")
    return { success: false };
  const probe = msg.type === "MANGA_PROBE";
  if (probe && !extensionPage(sender)) return { success: false };
  const settings: AstraSettings =
    probe && msg.payload?.settings
      ? {
          ...saved,
          ...msg.payload.settings,
          manga: { ...saved.manga, ...msg.payload.settings.manga },
        }
      : saved;
  const manga = settings.manga;
  const { provider, status: configuration } = resolveMangaConfiguration(settings);
  if (!configuration.ready) return {
    success: false,
    error: configuration.error,
    errorCode: configuration.errorCode,
    needsSetup: true,
  };
  let source: MangaSource;
  if (probe) source = { kind: "probe" };
  else {
    const url = msg.payload?.imageUrl;
    if (typeof url !== "string" || !sender?.tab)
      return { success: false, error: t(lang, "manga.sourceFailed") };
    if (url.startsWith("data:image/") && url.length <= 22 * 1024 * 1024)
      source = { kind: "data", dataUrl: url };
    else {
      let origin = "";
      try {
        origin = new URL(sender.url || sender.tab.url || "").origin;
      } catch {}
      if (url.length > 8192 || !imageSourceAllowed(url, origin))
        return {
          success: false,
          error: t(lang, "manga.sourceFailed"),
          errorCode: "MANGA_SOURCE_UNREADABLE",
        };
      source = { kind: "url", url, pageOrigin: origin };
    }
  }
  const token =
    typeof msg.payload?.imageToken === "string"
      ? msg.payload.imageToken.slice(0, 100)
      : crypto.randomUUID();
  const requestKey = owner + ":" + token;
  const previous = pending.get(requestKey);
  if (previous) {
    const job = await loadMangaJob(previous);
    if (job && MANGA_ACTIVE_PHASES.has(job.phase))
      return { success: true, jobId: previous };
  }
  const now = Date.now();
  const job: MangaJob = {
    id: crypto.randomUUID(),
    owner,
    phase: "queued",
    revision: 0,
    createdAt: now,
    updatedAt: now,
    model: manga.modelId.trim(),
    width: 0,
    height: 0,
    total: 0,
    completed: 0,
    regions: [],
    probe,
  };
  const result = await sendOffscreenCommand({
    type: "MANGA_EXECUTE",
    payload: {
      job,
      source,
      provider: {
        providerId: provider.providerId,
        providerName: provider.providerName,
        apiFormat: provider.apiFormat,
        baseUrl: provider.baseUrl,
        endpoint: provider.endpoint,
        apiKey: provider.apiKey,
        customHeaders: { ...provider.customHeaders },
        model: job.model,
        temperature: provider.temperature,
        disableThinking: provider.disableThinking,
        timeoutMs: 60_000,
      },
      targetLanguage: manga.targetLanguage,
      glossary: String(settings.customGlossary ?? "").slice(0, 8000),
      language: lang,
      force: probe || msg.payload?.force === true,
    },
  });
  if (!result?.success)
    return {
      success: false,
      error: t(
        lang,
        result?.error === "MANGA_BUSY" ? "manga.busy" : "manga.failed",
      ),
    };
  pending.set(requestKey, job.id);
  if (pending.size > 200) pending.delete(pending.keys().next().value!);
  return { success: true, jobId: job.id };
}
