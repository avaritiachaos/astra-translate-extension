import { MangaOverlay, imageBox } from "./mangaOverlay";
import { createMangaPicker } from "./mangaPicker";
import { createMangaReaderControls } from "./mangaReaderControls";
import { createMangaAutoReader } from "./mangaAutoReader";
import {
  isCanvasImage,
  mangaImageSize,
  mangaImageSource,
  visibleMangaImageRect,
  intersectRects,
  visibleMangaSpread,
  type MangaImage,
} from "./mangaImage";
import { MangaViewportLease, whileMangaWanted } from "../../shared/manga/workInterest";
import { imageBlobToDataUrl } from "../../shared/imageAssets";
import { t, type UiLanguage } from "../../shared/i18n";
import type { MangaJob, Rect } from "../../shared/manga/types";
interface Entry {
  image: MangaImage;
  url: string;
  page: string;
  token: string;
  view: MangaOverlay;
  jobId?: string;
  claimedJobId?: string;
  lifetime: AbortController;
  viewportLease: MangaViewportLease;
  timer?: ReturnType<typeof setTimeout>;
  cancelled: boolean;
  automatic: boolean;
  fallback: boolean;
  force: boolean;
  failures: number;
  crop?: Rect;
  observer: ResizeObserver;
}
const entries = new Map<MangaImage, Entry>();
const starts = new WeakMap<MangaImage, number>();
let language: UiLanguage = "zh-CN";
let lastImage: HTMLImageElement | null = null;
let stopPicking: (() => void) | undefined;
let readerControls: ReturnType<typeof createMangaReaderControls> | undefined;
let autoReader: ReturnType<typeof createMangaAutoReader> | undefined;
let readingSession = false,
  showOriginal = false,
  captureActive = false;
let anchor: MangaImage | undefined;
let batchGeneration = 0;
const scheduled = new Set<MangaImage>();
let captures: Promise<unknown> = Promise.resolve();
let lastCapture = 0;
function currentEntry(image: MangaImage): Entry | undefined {
  const entry = entries.get(image);
  return entry &&
    entry.image.isConnected &&
    entry.page === pageKey() &&
    currentSource(image) === entry.url
    ? entry
    : undefined;
}
function refreshReader() {
  if (!readerControls) return;
  const visible = [...entries.values()]
    .filter(
      (entry) =>
        currentEntry(entry.image) === entry &&
        visibleMangaImageRect(entry.image),
    )
    .sort(
      (a, b) =>
        a.image.getBoundingClientRect().x - b.image.getBoundingClientRect().x,
    );
  const spread = visibleMangaSpread(document, anchor);
  readerControls.update(
    visible.map((entry) => ({
      id: entry.token,
      ...entry.view.state,
      retry: () => void start(entry.image, true),
      restore: () => restore(entry),
    })),
    spread.length,
    readingSession,
    spread.some(
      (image) =>
        !currentEntry(image) ||
        currentEntry(image)?.view.state.phase === "error",
    ),
  );
}
async function startImages(images: MangaImage[], automatic = false) {
  if (!images.length) return;
  readingSession = true;
  anchor = images[0];
  const generation = batchGeneration;
  for (const image of images.slice(0, 2)) {
    if (generation !== batchGeneration) break;
    if (!image.isConnected || !visibleMangaImageRect(image)) continue;
    const previous = currentEntry(image);
    if (
      scheduled.has(image) ||
      (previous && previous.view.state.phase !== "error")
    )
      continue;
    scheduled.add(image);
    try {
      await start(image, !!previous, automatic);
    } finally {
      scheduled.delete(image);
    }
  }
  refreshReader();
}
function restoreAll(disableReading = true) {
  if (disableReading && autoReader?.state.enabled)
    void autoReader.set(false, false);
  batchGeneration++;
  readingSession = false;
  showOriginal = false;
  for (const entry of [...entries.values()]) restore(entry);
  refreshReader();
}
let frame = 0;
let visibilityCheck: ReturnType<typeof setTimeout> | undefined;
let documentObserver: MutationObserver | undefined;
const pageKey = () => location.origin + location.pathname + location.search;
const currentSource = mangaImageSource;
function scheduleLayout() {
  if (
    frame ||
    (!entries.size && !readingSession && !document.fullscreenElement)
  )
    return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    clearTimeout(visibilityCheck);visibilityCheck = undefined;
    let recheck = Infinity;
    for (const entry of entries.values()) {
      if (
        !entry.image.isConnected ||
        entry.page !== pageKey() ||
        currentSource(entry.image) !== entry.url
      )
        restore(entry);
      else {
        const state = entry.viewportLease.update(entry.view.state.phase === "working", !!visibleMangaImageRect(entry.image), Date.now());
        if (state.cancel) restore(entry);
        else { recheck = Math.min(recheck, state.delay ?? Infinity);entry.view.layout(); }
      }
    }
    if (Number.isFinite(recheck)) visibilityCheck = setTimeout(scheduleLayout, Math.max(1, recheck));
    refreshReader();
  });
}
function cancel(id: string) {
  void chrome.runtime
    .sendMessage({ type: "MANGA_CANCEL", payload: { id } })
    .catch(() => {});
}
function restore(entry: Entry, invalidate = true) {
  if (entry.cancelled) return;
  if (invalidate) starts.set(entry.image, (starts.get(entry.image) ?? 0) + 1);
  entry.cancelled = true;
  entry.lifetime.abort();
  clearTimeout(entry.timer);
  entry.observer.disconnect();
  entry.view.dispose();
  if (entries.get(entry.image) === entry) entries.delete(entry.image);
  if (entry.jobId) cancel(entry.jobId);
  if (entry.claimedJobId) void chrome.runtime.sendMessage({
    type: "MANGA_READING_RELEASE", payload: { imageUrl: entry.url, jobId: entry.claimedJobId },
  }).catch(() => {});
  if (entries.size === 0) { documentObserver?.disconnect();clearTimeout(visibilityCheck);visibilityCheck = undefined; }
  refreshReader();
}
function visibleImage(entry: Entry): Promise<string> {
  // Chrome limits captureVisibleTab frequency. Serialize the entire hide/crop/
  // restore sequence so another page never captures our first page's overlays.
  const work = captures.then(async () => {
    const wait = Math.max(0, 600 - (Date.now() - lastCapture));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    if (entry.cancelled) throw new Error("CANCELLED");
    lastCapture = Date.now();
    return captureImage(entry);
  });
  captures = work.catch(() => {});
  return work;
}
async function captureImage(entry: Entry): Promise<string> {
  const { content, drawn } = imageBox(entry.image);
  const vp = visualViewport;
  const viewport = {
    x: vp?.offsetLeft ?? 0,
    y: vp?.offsetTop ?? 0,
    width: vp?.width ?? innerWidth,
    height: vp?.height ?? innerHeight,
  };
  const visible = visibleMangaImageRect(entry.image);
  const imageContent = intersectRects(content, drawn);
  const captureRect =
    visible && imageContent && intersectRects(visible, imageContent);
  if (!captureRect || captureRect.width < 20 || captureRect.height < 20)
    throw new Error(t(language, "manga.scrollToImage"));
  const { x: left, y: top, width, height } = captureRect;
  const right = left + width,
    bottom = top + height;
  const size = mangaImageSize(entry.image);
  const before = JSON.stringify([
    scrollX,
    scrollY,
    innerWidth,
    innerHeight,
    vp?.scale,
    vp?.offsetLeft,
    vp?.offsetTop,
    entry.image.getBoundingClientRect().toJSON(),
    visible,
    size,
  ]);
  captureActive = true;
  for (const item of entries.values()) item.view.hide(true);
  readerControls?.capture(true);
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  try {
    const capture = await chrome.runtime.sendMessage({
      type: "CAPTURE_VISIBLE_TAB",
    });
    const after = JSON.stringify([
      scrollX,
      scrollY,
      innerWidth,
      innerHeight,
      vp?.scale,
      vp?.offsetLeft,
      vp?.offsetTop,
      entry.image.getBoundingClientRect().toJSON(),
      visibleMangaImageRect(entry.image),
      mangaImageSize(entry.image),
    ]);
    if (!capture?.success)
      throw new Error(capture?.error || t(language, "manga.sourceFailed"));
    if (before !== after || entry.cancelled)
      throw Object.assign(new Error(t(language, "error.captureChanged")), {
        code: "CAPTURE_CHANGED",
      });
    const bitmap = await createImageBitmap(
      await (await fetch(capture.dataUrl)).blob(),
    );
    try {
      const sx = bitmap.width / viewport.width,
        sy = bitmap.height / viewport.height;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((right - left) * sx));
      canvas.height = Math.max(1, Math.round((bottom - top) * sy));
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(
        bitmap,
        (left - viewport.x) * sx,
        (top - viewport.y) * sy,
        (right - left) * sx,
        (bottom - top) * sy,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      entry.crop = {
        x: ((left - drawn.x) / drawn.width) * size.width,
        y: ((top - drawn.y) / drawn.height) * size.height,
        width: ((right - left) / drawn.width) * size.width,
        height: ((bottom - top) / drawn.height) * size.height,
      };
      entry.view.setCrop(entry.crop);
      return canvas.toDataURL("image/png");
    } finally {
      bitmap.close();
    }
  } finally {
    captureActive = false;
    for (const item of entries.values()) item.view.hide(false);
    readerControls?.capture(false);
  }
}
async function submit(entry: Entry, url: string, force: boolean) {
  if (entry.cancelled) return;
  if (
    entry.automatic &&
    (document.hidden ||
      !autoReader?.state.enabled ||
      !visibleMangaImageRect(entry.image))
  ) {
    restore(entry);
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: "MANGA_START",
    payload: {
      imageUrl: url,
      imageToken: entry.token,
      force,
      automatic: entry.automatic,
    },
  });
  if (entry.cancelled) {
    if (response?.jobId) cancel(response.jobId);
    return;
  }
  if (!response?.success) {
    if (response?.inactive) {
      restore(entry);
      return;
    }
    if (response?.needsSetup) {
      entry.view.configurationError(
        response.error || t(language, "manga.setupHint"),
      );
      return;
    }
    if (response?.errorCode === "MANGA_SOURCE_UNREADABLE" && !entry.fallback) {
      await fallback(entry, force);
      return;
    }
    const failure = new Error(response?.error || t(language, "manga.failed"));
    Object.assign(failure, { code: response?.errorCode });
    throw failure;
  }
  entry.jobId = response.jobId;
  await poll(entry);
}
async function fallback(entry: Entry, force: boolean) {
  entry.fallback = true;
  entry.view.message(t(language, "manga.captureFallback"));
  await submit(entry, await visibleImage(entry), force);
}
async function poll(entry: Entry) {
  if (entry.cancelled || !entry.jobId) return;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "MANGA_STATUS",
      payload: { id: entry.jobId },
    });
    if (entry.cancelled) return;
    if (entry.page !== pageKey() || currentSource(entry.image) !== entry.url) {
      restore(entry);
      return;
    }
    if (!response?.success || !response.job)
      throw new Error(response?.error || t(language, "manga.interrupted"));
    const job = response.job as MangaJob;
    if (
      job.phase === "failed" &&
      job.errorCode === "MANGA_SOURCE_UNREADABLE" &&
      !entry.fallback
    ) {
      await fallback(entry, entry.force);
      return;
    }
    entry.failures = 0;
    entry.view.update(job);
    if (["ready", "failed", "cancelled", "interrupted"].includes(job.phase))
      return;
    entry.timer = setTimeout(() => void poll(entry), 650);
  } catch (error) {
    if (!entry.cancelled) {
      if (++entry.failures <= 3) {
        entry.timer = setTimeout(() => void poll(entry), 1000);
        return;
      }
      entry.view.error(
        error instanceof Error ? error.message : t(language, "manga.failed"),
        typeof (error as { code?: unknown })?.code === "string"
          ? (error as { code: string }).code
          : undefined,
      );
    }
  }
}
async function start(image: MangaImage, force = false, automatic = false) {
  const expectedSource = currentSource(image),
    expectedPage = pageKey();
  const generation = batchGeneration;
  readingSession = true;
  const version = (starts.get(image) ?? 0) + 1;
  starts.set(image, version);
  const old = entries.get(image);
  if (old) restore(old, false);
  const preferences = await chrome.runtime
    .sendMessage({ type: "MANGA_PREFERENCES" })
    .catch(() => null);
  if (
    starts.get(image) !== version ||
    generation !== batchGeneration ||
    !image.isConnected ||
    !visibleMangaImageRect(image) ||
    currentSource(image) !== expectedSource ||
    pageKey() !== expectedPage ||
    (automatic &&
      (!autoReader?.state.enabled ||
        document.hidden ||
        !visibleMangaImageRect(image)))
  )
    return;
  if (preferences?.language) language = preferences.language;
  let entry: Entry;
  const view = new MangaOverlay(image, language, refreshReader);
  view.setOriginal(showOriginal);
  view.hide(captureActive);
  // Keep only a small set of page overlays; completed results remain in the existing cache.
  for (const old of [...entries.values()]) {
    if (entries.size < 6) break;
    if (!visibleMangaImageRect(old.image)) restore(old);
  }
  const observer = new ResizeObserver(scheduleLayout);
  entry = {
    image,
    url: currentSource(image),
    page: pageKey(),
    token: crypto.randomUUID(),
    view,
    observer,
    cancelled: false,
    lifetime: new AbortController(),
    viewportLease: new MangaViewportLease(),
    automatic,
    fallback: false,
    force,
    failures: 0,
  };
  entries.set(image, entry);
  refreshReader();
  readerControls?.raise();
  observer.observe(image);
  documentObserver?.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src", "srcset", "style", "class", "width", "height"],
  });
  try {
    // Check the saved provider before reading/capturing a page. Configuration
    // failure must not capture a screenshot or start a model request.
    if (preferences?.configuration?.ready === false) {
      view.configurationError(
        preferences.configuration.error || t(language, "manga.setupHint"),
      );
      return;
    }
    if (!isCanvasImage(image) && !force && autoReader?.state.enabled) {
      // Reuse the one prefetched result even across a same-chapter navigation.
      // Ownership remains enforced by the per-tab reading service, not the DOM.
      let claim = await chrome.runtime
        .sendMessage({
          type: "MANGA_READING_CLAIM",
          payload: { imageUrl: entry.url },
        })
        .catch(() => null);
      const deadline = Date.now() + 150_000;
      while (claim?.job && !entry.cancelled) {
        entry.claimedJobId = claim.job.id;
        if (currentSource(image) !== entry.url || entry.page !== pageKey()) {
          restore(entry);
          return;
        }
        if (
          claim.job.phase === "failed" &&
          claim.job.errorCode === "MANGA_SOURCE_UNREADABLE"
        )
          break;
        entry.view.update(claim.job);
        if (
          ["ready", "failed", "cancelled", "interrupted"].includes(
            claim.job.phase,
          )
        )
          return;
        if (Date.now() > deadline) {
          entry.view.error(t(language, "manga.interrupted"));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 650));
        if (entry.cancelled) return;
        claim = await chrome.runtime
          .sendMessage({
            type: "MANGA_READING_CLAIM",
            payload: { imageUrl: entry.url },
          })
          .catch(() => null);
      }
      if (entry.cancelled) return;
    }
    if (isCanvasImage(image)) {
      // Readers often use origin-tainted canvases. Reuse the bounded visible
      // capture path instead of trying to recover protected source images.
      await fallback(entry, force);
      return;
    }
    await whileMangaWanted(image.decode(), entry.lifetime.signal);
    if (entry.cancelled) return;
    if (!visibleMangaImageRect(image)) { restore(entry);return; }
    if (currentSource(image) !== entry.url || entry.page !== pageKey()) {
      restore(entry);
      return;
    }
    let source = entry.url;
    if (source.startsWith("blob:")) {
      const blob = await (await fetch(source)).blob();
      if (blob.size > 15 * 1024 * 1024)
        throw new Error(t(language, "manga.tooLarge"));
      source = await imageBlobToDataUrl(blob);
    }
    await submit(entry, source, force);
  } catch (error) {
    if (!entry.cancelled)
      view.error(
        error instanceof Error ? error.message : t(language, "manga.failed"),
        typeof (error as { code?: unknown })?.code === "string"
          ? (error as { code: string }).code
          : undefined,
      );
  }
}
function translateCurrent() {
  const images = visibleMangaSpread(document, anchor);
  if (!images.length) {
    pickImage();
    return { pickerReady: true, currentStarted: false };
  }
  showOriginal = false;
  readerControls?.reflectOriginal(false);
  for (const entry of entries.values()) entry.view.setOriginal(false);
  void startImages(images);
  return { pickerReady: false, currentStarted: true };
}
function pickImage() {
  stopPicking?.();
  stopPicking = createMangaPicker(
    language,
    (images) => void startImages(images),
    () => {
      stopPicking = undefined;
      readerControls?.setPicking(false);
    },
  );
  readerControls?.setPicking(true);
}
export function initMangaController(repair = false) {
  const state = globalThis as typeof globalThis & {
    __astraMangaController?: { alive: () => boolean; dispose: () => void };
  };
  if (!repair && state.__astraMangaController?.alive()) return;
  state.__astraMangaController?.dispose();
  // Capture this runtime object: after an extension reload, an old controller
  // must not pass its liveness check using the newly injected runtime.
  const runtime = chrome.runtime;
  let disposed = false;
  const alive = () => {
    try {
      return !disposed && Boolean(runtime.id);
    } catch {
      return false;
    }
  };
  const requestPick = async () => {
    const preferences = await runtime
      .sendMessage({ type: "MANGA_PREFERENCES" })
      .catch(() => null);
    if (!alive()) throw new Error("MANGA_CONTEXT_INVALIDATED");
    if (preferences?.language) language = preferences.language;
    readerControls?.refresh();
    pickImage();
  };
  const contextmenu = (event: MouseEvent) => {
    if (event.isTrusted)
      lastImage =
        event.target instanceof HTMLImageElement ? event.target : null;
  };
  const onMessage = (
    msg: { type: string; payload?: { srcUrl?: string } },
    sender: chrome.runtime.MessageSender,
    reply: (response: unknown) => void,
  ) => {
    if (!alive() || sender.id !== runtime.id) return;
    if (msg.type === "MANGA_PING") {
      reply({ success: true, pickerVersion: 2 });
      return;
    }
    if (msg.type === "MANGA_TRANSLATE_CURRENT") {
      reply({ success: true, ...translateCurrent() });
      return;
    }
    if (msg.type === "MANGA_PICK_IMAGE") {
      void requestPick().then(
        () => reply({ success: true, pickerReady: true }),
        () => reply({ success: false, pickerReady: false }),
      );
      return true;
    }
    if (msg.type === "MANGA_TRANSLATE_IMAGE") {
      const image = lastImage?.isConnected
        ? lastImage
        : Array.from(document.images).find(
            (item) =>
              currentSource(item) === msg.payload?.srcUrl ||
              item.src === msg.payload?.srcUrl,
          );
      if (image) {
        void start(image);
        reply({ success: true });
      } else {
        void requestPick().then(
          () => reply({ success: true, pickerReady: true }),
          () => reply({ success: false, pickerReady: false }),
        );
        return true;
      }
    }
  };
  const pagehide = () => {
    autoReader?.dispose();
    stopPicking?.();
    restoreAll(false);
  };
  document.addEventListener("contextmenu", contextmenu, true);
  runtime.onMessage.addListener(onMessage);
  addEventListener("scroll", scheduleLayout, { passive: true, capture: true });
  addEventListener("resize", scheduleLayout);
  document.addEventListener("fullscreenchange", scheduleLayout);
  documentObserver = new MutationObserver((records) => {
    // Setting either canvas dimension resets its pixels, even at the same size.
    for (const entry of entries.values()) {
      if (
        isCanvasImage(entry.image) &&
        records.some(
          (record) =>
            record.target === entry.image &&
            record.type === "attributes" &&
            (record.attributeName === "width" ||
              record.attributeName === "height"),
        )
      )
        restore(entry);
    }
    if (
      records.some(
        (record) =>
          record.type === "childList" ||
          [...entries.values()].some(
            (entry) =>
              record.target === entry.image ||
              (record.target instanceof Element &&
                record.target.contains(entry.image)),
          ),
      )
    )
      scheduleLayout();
  });
  readerControls = createMangaReaderControls(() => language, {
    pick: () => void requestPick().catch(() => {}),
    translate: () => {
      translateCurrent();
    },
    original: (value) => {
      showOriginal = value;
      for (const entry of entries.values()) entry.view.setOriginal(value);
    },
    restore: restoreAll,
    reading: (enabled, prefetch) => {
      void autoReader?.set(enabled, prefetch);
    },
  });
  autoReader = createMangaAutoReader({
    start: (images) => startImages(images, true),
    prioritize: images => {
      for (const entry of [...entries.values()]) {
        if (entry.view.state.phase === "working" && !images.includes(entry.image)) restore(entry);
      }
    },
    existing: (image) => currentEntry(image)?.view.state.phase,
    failure: (image) => {
      const state = currentEntry(image)?.view.state;
      return {
        code: state?.errorCode,
        message: state?.status,
        needsSetup: state?.needsSetup,
      };
    },
    paused: () => !!stopPicking || captureActive || showOriginal || !alive(),
    stopped: () => {
      batchGeneration++;
      for (const entry of [...entries.values()])
        if (entry.automatic && entry.view.state.phase === "working")
          restore(entry);
    },
    changed: (state) => {
      if (state.enabled) readingSession = true;
      readerControls?.setReading(state);
      refreshReader();
    },
  });
  refreshReader();
  void runtime
    .sendMessage({ type: "MANGA_PREFERENCES" })
    .then((preferences) => {
      if (!alive() || !preferences?.language) return;
      language = preferences.language;
      readerControls?.refresh();
    })
    .catch(() => {});
  const pageshow = (event: PageTransitionEvent) => {
    if (event.persisted) initMangaController(true);
  };
  addEventListener("pageshow", pageshow);
  addEventListener("pagehide", pagehide);
  state.__astraMangaController = {
    alive,
    dispose() {
      disposed = true;
      pagehide();
      readerControls?.dispose();
      documentObserver?.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(visibilityCheck);visibilityCheck = undefined;
      frame = 0;
      document.removeEventListener("contextmenu", contextmenu, true);
      removeEventListener("scroll", scheduleLayout, true);
      removeEventListener("resize", scheduleLayout);
      document.removeEventListener("fullscreenchange", scheduleLayout);
      removeEventListener("pagehide", pagehide);
      removeEventListener("pageshow", pageshow);
      try {
        runtime.onMessage.removeListener(onMessage);
      } catch {
        /* Old extension context. */
      }
    },
  };
}
