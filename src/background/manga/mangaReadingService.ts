import type { MangaJob } from "../../shared/manga/types";
import type { AstraSettings } from "../../shared/types";
import {
  READING_SESSION_MS,
  isNextMangaPage,
  mangaReadingScope,
  readingPageUrl,
  readingSessionAllows,
  type MangaReadingState,
} from "../../shared/manga/readingPolicy";
import { resolveReadingPage } from "../../shared/manga/readingContext";
import { imageSourceAllowed } from "../../shared/manga/imageGeometry";
import { loadMangaJob } from "../../shared/manga/store";
import { getSettings } from "../../shared/storage";
import { resolveMangaConfiguration } from "../../shared/manga/configuration";
import {
  hasOffscreenDocument,
  sendOffscreenCommand,
} from "../offscreenManager";
const PREFIX = "astra_manga_reading:";
interface Ahead {
  page: string;
  fromPage: string;
  source: string;
  jobId?: string;
  owner: string;
  config: string;
  claimed: boolean;
}
interface ReadingSession extends MangaReadingState {
  generation: string;
  ahead?: Ahead;
  attempt?: string;
}
const locks = new Map<number, Promise<unknown>>();
async function serial<T>(tabId: number, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(tabId) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(run);
  locks.set(tabId, result);
  try {
    return await result;
  } finally {
    if (locks.get(tabId) === result) locks.delete(tabId);
  }
}
async function load(tabId: number): Promise<ReadingSession | undefined> {
  return (await chrome.storage.session.get(PREFIX + tabId))[PREFIX + tabId];
}
export async function automaticMangaAllowed(
  sender: chrome.runtime.MessageSender,
  source?: string,
): Promise<boolean> {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId) || sender.frameId !== 0) return false;
  return serial(tabId!, async () => {
    const tab = await chrome.tabs.get(tabId!);
    const page = resolveReadingPage(sender, tab);
    if (!page || !tab.active) return false;
    const session = await load(tabId!);
    if (!session || !readingSessionAllows(session, page)) return false;
    const ahead = session.ahead;
    // A skipped page must not keep the single prefetch slot (or a worker slot)
    // forever. A matching page claims it before reaching normal MANGA_START.
    if (
      ahead &&
      ahead.source !== source &&
      (ahead.page === page || ahead.fromPage !== page)
    ) {
      await cancelAhead(session);
      session.ahead = undefined;
      await save(tabId!, session);
    }
    return true;
  });
}
async function save(tabId: number, session: ReadingSession) {
  await chrome.storage.session.set({ [PREFIX + tabId]: session });
}
async function cancelAhead(session?: ReadingSession) {
  const ahead = session?.ahead;
  if (ahead?.jobId && (await hasOffscreenDocument()))
    await sendOffscreenCommand({
      type: "MANGA_CANCEL",
      payload: { id: ahead.jobId, owner: ahead.owner },
    }).catch(() => {});
}
export async function stopReadingOutsideScope(tabId: number, url: string) {
  await serial(tabId, async () => {
    const session = await load(tabId);
    if (!session || readingSessionAllows(session, url)) return;
    await chrome.storage.session.remove(PREFIX + tabId);
    await cancelAhead(session);
  });
}
export async function clearMangaReading(tabId: number) {
  await serial(tabId, async () => {
    const session = await load(tabId);
    await chrome.storage.session.remove(PREFIX + tabId);
    await cancelAhead(session);
  });
}
async function configKey(settings: AstraSettings) {
  const { provider } = resolveMangaConfiguration(settings);
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      provider.providerId,
      provider.baseUrl,
      provider.endpoint,
      provider.apiKey,
      provider.customHeaders,
      settings.manga,
      settings.customGlossary,
    ]),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
async function aheadJob(ahead: Ahead): Promise<MangaJob | undefined> {
  if (!ahead.jobId) return;
  const stored = await loadMangaJob(ahead.jobId);
  if (!stored || stored.owner !== ahead.owner) return;
  if (
    ["queued", "loading", "preparing", "translating"].includes(stored.phase) &&
    (await hasOffscreenDocument())
  ) {
    const response = await sendOffscreenCommand({
      type: "MANGA_STATUS",
      payload: { id: ahead.jobId, owner: ahead.owner },
    });
    if (response?.job) return response.job;
  }
  if (
    ["queued", "loading", "preparing", "translating"].includes(stored.phase)
  ) {
    const latest = await loadMangaJob(ahead.jobId!);
    return latest?.phase === "ready"
      ? latest
      : { ...stored, phase: "interrupted" as const };
  }
  return stored;
}
const publicState = (session?: ReadingSession): MangaReadingState => ({
  enabled: !!session?.enabled,
  prefetch: !!session?.prefetch,
  scope: session?.scope,
  expires: session?.expires,
});
/** Sender-derived per-tab consent and a single prefetch slot. No chapter queue. */
export async function handleMangaReading(
  msg: { type: string; payload?: any },
  sender: chrome.runtime.MessageSender,
  owner: string,
  start: (
    source: string,
    token: string,
  ) => Promise<{ success: boolean; jobId?: string; error?: string }>,
) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId) || sender.frameId !== 0)
    return { success: false, errorCode: "READING_SENDER_DENIED" };
  return serial(tabId!, async () => {
    const tab = await chrome.tabs.get(tabId!);
    const page = resolveReadingPage(sender, tab);
    if (!page) return { success: false, errorCode: "READING_PAGE_CHANGED" };
    let session = await load(tabId!);
    if (session && !readingSessionAllows(session, page)) {
      await cancelAhead(session);
      await chrome.storage.session.remove(PREFIX + tabId!);
      session = undefined;
    }
    if (msg.type === "MANGA_READING_STATE")
      return { success: true, state: publicState(session) };
    if (msg.type === "MANGA_READING_SET") {
      if (msg.payload?.enabled !== true) {
        await chrome.storage.session.remove(PREFIX + tabId!);
        await cancelAhead(session);
        return { success: true, state: publicState() };
      }
      const prefetch = msg.payload?.prefetch === true;
      if (!prefetch) await cancelAhead(session);
      session = {
        enabled: true,
        prefetch,
        scope: mangaReadingScope(page)!,
        expires: Date.now() + READING_SESSION_MS,
        generation: session?.generation ?? crypto.randomUUID(),
        ahead: prefetch ? session?.ahead : undefined,
        attempt: prefetch ? session?.attempt : undefined,
      };
      await save(tabId!, session);
      return { success: true, state: publicState(session) };
    }
    if (!session) return { success: false, inactive: true };
    if (msg.type === "MANGA_READING_RELEASE") {
      const ahead = session.ahead;
      if (ahead?.claimed && ahead.page === page && ahead.jobId === msg.payload?.jobId && ahead.source === msg.payload?.imageUrl) {
        await cancelAhead(session);session.ahead = undefined;await save(tabId!, session);
      }
      return { success: true };
    }
    if (msg.type === "MANGA_READING_CLAIM") {
      const ahead = session.ahead;
      if (
        !ahead ||
        ahead.source !== msg.payload?.imageUrl ||
        ahead.page !== page
      )
        return { success: true };
      if (ahead.config !== (await configKey(await getSettings()))) {
        await cancelAhead(session);
        session.ahead = undefined;
        await save(tabId!, session);
        return { success: true };
      }
      const job = await aheadJob(ahead);
      if (!job) return { success: true };
      ahead.claimed = true;
      await save(tabId!, session);
      // No original owner/token is exposed; the requesting document already owns this source page.
      return { success: true, job: { ...job, owner: "" } };
    }
    if (msg.type === "MANGA_READING_PREFETCH") {
      const targetPage = readingPageUrl(msg.payload?.pageUrl || "");
      const source = msg.payload?.imageUrl;
      if (
        !session.prefetch ||
        !tab.active ||
        readingPageUrl(tab.url || "") !== page ||
        !targetPage ||
        !(targetPage === page || isNextMangaPage(page, targetPage)) ||
        typeof source !== "string" ||
        source.length > 8192 ||
        !imageSourceAllowed(source, new URL(page).origin)
      )
        return { success: false };
      const attempt = page + "|" + source;
      if (session.attempt === attempt)
        return { success: true, queued: !!session.ahead?.jobId };
      // Never turn the single ahead slot into an implicit chain while the current page is unchanged.
      if (
        session.ahead &&
        session.ahead.fromPage === page &&
        !session.ahead.claimed
      )
        return { success: false, busy: true };
      await cancelAhead(session);
      session.attempt = attempt;
      session.ahead = {
        page: targetPage,
        fromPage: page,
        source,
        owner,
        config: await configKey(await getSettings()),
        claimed: false,
      };
      await save(tabId!, session);
      const response = await start(source, "ahead-" + crypto.randomUUID());
      if (response.success) session.ahead.jobId = response.jobId;
      await save(tabId!, session);
      return {
        success: response.success,
        queued: !!response.jobId,
        error: response.error,
      };
    }
    return { success: false };
  });
}
