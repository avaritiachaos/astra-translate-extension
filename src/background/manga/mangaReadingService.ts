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
import { isMangaReaderUrl } from "../../shared/manga/mangaDetection.ts";
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
  aheads?: Ahead[];
  attempt?: string;
  attempts?: string[];
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
  const inSession = (await chrome.storage.session.get(PREFIX + tabId))[PREFIX + tabId];
  if (inSession) return inSession;
  try {
    await chrome.storage.local.remove(PREFIX + tabId);
  } catch {}
  return undefined;
}
function allAheads(session?: ReadingSession): Ahead[] {
  if (!session) return [];
  if (session.aheads && session.aheads.length) return session.aheads;
  return session.ahead ? [session.ahead] : [];
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
    const settings = await getSettings().catch(() => null);
    const allowBg = settings?.manga?.backgroundPrefetch !== false;
    if (!page || (!tab.active && !allowBg) || !isMangaReaderUrl(page)) return false;
    const session = await load(tabId!);
    if (!session || !readingSessionAllows(session, page)) return false;
    const aheads = allAheads(session);
    const obsolete = aheads.filter(
      (ahead) =>
        !ahead.claimed &&
        ahead.source !== source &&
        (ahead.page === page || ahead.fromPage !== page),
    );
    if (obsolete.length) {
      await cancelAheads(session, (a) => obsolete.includes(a));
      session.aheads = aheads.filter((a) => !obsolete.includes(a));
      session.ahead = session.aheads[0];
      await save(tabId!, session);
    }
    return true;
  });
}
async function save(tabId: number, session: ReadingSession) {
  await chrome.storage.session.set({ [PREFIX + tabId]: session });
  try {
    await chrome.storage.local.remove(PREFIX + tabId);
  } catch {}
}
async function removeSession(tabId: number) {
  await chrome.storage.session.remove(PREFIX + tabId).catch(() => {});
  try {
    await chrome.storage.local.remove(PREFIX + tabId);
  } catch {}
}
async function cancelAheads(
  session?: ReadingSession,
  matcher?: (ahead: Ahead) => boolean,
) {
  const aheads = allAheads(session);
  const targets = matcher ? aheads.filter(matcher) : aheads;
  for (const ahead of targets) {
    if (ahead.jobId && (await hasOffscreenDocument()))
      await sendOffscreenCommand({
        type: "MANGA_CANCEL",
        payload: { id: ahead.jobId, owner: ahead.owner },
      }).catch(() => {});
  }
}
async function cancelAhead(session?: ReadingSession) {
  await cancelAheads(session);
}
export async function stopReadingOutsideScope(tabId: number, url: string) {
  await serial(tabId, async () => {
    const session = await load(tabId);
    if (!session || readingSessionAllows(session, url)) return;
    await removeSession(tabId);
    await cancelAheads(session);
  });
}
export async function clearMangaReading(tabId: number) {
  await serial(tabId, async () => {
    const session = await load(tabId);
    await removeSession(tabId);
    await cancelAheads(session);
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
async function publicState(
  session?: ReadingSession,
): Promise<MangaReadingState> {
  if (!session?.enabled) return { enabled: false, prefetch: false };
  const aheads = allAheads(session).filter((a) => !a.claimed);
  let readyCount = 0,
    workingCount = 0;
  for (const a of aheads) {
    if (a.jobId) {
      const job = await aheadJob(a);
      if (job?.phase === "ready") readyCount++;
      else if (
        ["queued", "loading", "preparing", "translating"].includes(
          job?.phase ?? "",
        )
      )
        workingCount++;
    }
  }
  return {
    enabled: !!session.enabled,
    prefetch: !!session.prefetch,
    scope: session.scope,
    expires: session.expires,
    aheadCount: aheads.length,
    readyCount,
    workingCount,
  };
}
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
    const isManga = isMangaReaderUrl(page);
    let session = await load(tabId!);
    if (session && (!isManga || !readingSessionAllows(session, page))) {
      await cancelAhead(session);
      await removeSession(tabId!);
      session = undefined;
    }
    if (msg.type === "MANGA_READING_STATE") {
      if (!isManga) return { success: true, state: await publicState() };
      return { success: true, state: await publicState(session) };
    }
    if (msg.type === "MANGA_READING_SET") {
      if (msg.payload?.enabled !== true || !isManga) {
        await removeSession(tabId!);
        await cancelAhead(session);
        return { success: true, state: await publicState() };
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
        aheads: prefetch ? session?.aheads : undefined,
        attempt: prefetch ? session?.attempt : undefined,
      };
      await save(tabId!, session);
      return { success: true, state: await publicState(session) };
    }
    if (!session) return { success: false, inactive: true };
    if (msg.type === "MANGA_READING_RELEASE") {
      const aheads = allAheads(session);
      const matched = aheads.find(
        (a) =>
          a.claimed &&
          a.page === page &&
          a.jobId === msg.payload?.jobId &&
          a.source === msg.payload?.imageUrl,
      );
      if (matched) {
        await cancelAheads(session, (a) => a === matched);
        session.aheads = aheads.filter((a) => a !== matched);
        session.ahead = session.aheads[0];
        await save(tabId!, session);
      }
      return { success: true };
    }
    if (msg.type === "MANGA_READING_CLAIM") {
      const aheads = allAheads(session);
      const ahead = aheads.find(
        (a) =>
          a.source === msg.payload?.imageUrl &&
          (a.page === page || !a.page),
      );
      if (!ahead) return { success: true };
      if (ahead.config !== (await configKey(await getSettings()))) {
        await cancelAheads(session, (a) => a === ahead);
        session.aheads = aheads.filter((a) => a !== ahead);
        session.ahead = session.aheads[0];
        await save(tabId!, session);
        return { success: true };
      }
      const job = await aheadJob(ahead);
      if (!job) return { success: true };
      ahead.claimed = true;
      session.aheads = aheads;
      session.ahead = aheads[0];
      await save(tabId!, session);
      // No original owner/token is exposed; the requesting document already owns this source page.
      return { success: true, job: { ...job, owner: "" } };
    }
    if (msg.type === "MANGA_READING_PREFETCH") {
      const targetPage = readingPageUrl(msg.payload?.pageUrl || "");
      const source = msg.payload?.imageUrl;
      const settings = await getSettings();
      const allowBg = settings.manga?.backgroundPrefetch !== false;
      const isBatch = msg.payload?.batch === true;
      if (
        !session.prefetch ||
        (!tab.active && !allowBg) ||
        readingPageUrl(tab.url || "") !== page ||
        !targetPage ||
        !(targetPage === page || mangaReadingScope(page) === mangaReadingScope(targetPage)) ||
        typeof source !== "string" ||
        source.length > 8192 ||
        !imageSourceAllowed(source, new URL(page).origin)
      )
        return { success: false };

      const aheads = allAheads(session);
      const existing = aheads.find((a) => a.source === source);
      if (existing) {
        return { success: true, queued: !!existing.jobId };
      }

      const limit = isBatch
        ? Math.max(5, Math.min(50, settings.manga?.batchPrefetchLimit ?? 20))
        : Math.max(1, Math.min(5, settings.manga?.prefetchDepth ?? 3));
      const activeUnclaimed = aheads.filter((a) => !a.claimed);
      if (activeUnclaimed.length >= limit) {
        return { success: false, busy: true };
      }

      const aheadItem: Ahead = {
        page: targetPage,
        fromPage: page,
        source,
        owner,
        config: await configKey(settings),
        claimed: false,
      };
      session.aheads = [...aheads, aheadItem];
      session.ahead = session.aheads[0];
      await save(tabId!, session);

      const response = await start(source, "ahead-" + crypto.randomUUID());
      if (response.success) {
        aheadItem.jobId = response.jobId;
        await save(tabId!, session);
      }
      return {
        success: response.success,
        queued: Boolean(response.jobId),
        error: response.error,
        activeCount: session.aheads.filter((a) => !a.claimed).length,
      };
    }
    return { success: false };
  });
}
