import {
  MangaReadingGate,
  readingSessionAllows,
  type MangaReadingState,
  type MangaReadingUi,
} from "../../shared/manga/readingPolicy";
import {
  isCanvasImage,
  mangaImageSource,
  visibleMangaSpread,
  type MangaImage,
} from "./mangaImage";
import { isLikelyMangaPage } from "./mangaDetection";
import { mangaReaderRoot, nextMangaImages, nextMangaImage } from "./mangaNextPage";
import {
  changeMangaReading,
  readingControlErrorKey,
} from "../../shared/manga/readingClient";
import {
  MangaRecoveryBudget,
  type MangaFailure,
} from "../../shared/manga/readingRecovery";
import { getSettings } from "../../shared/storage";

export function createMangaAutoReader(actions: {
  start: (images: MangaImage[]) => Promise<void>;
  prioritize: (images: MangaImage[]) => void;
  existing: (image: MangaImage) => "working" | "ready" | "error" | undefined;
  failure: (image: MangaImage) => MangaFailure;
  paused: () => boolean;
  stopped: () => void;
  changed: (state: MangaReadingUi) => void;
}) {
  let state: MangaReadingUi = { enabled: false, prefetch: false };
  let disposed = false,
    sequence = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  let root: Element | undefined, rootId: string | undefined;
  let aheadAbort: AbortController | undefined,
    aheadSignature = "";
  const ids = new WeakMap<Element, number>(),
    versions = new WeakMap<Element, number>();
  let id = 0;
  const gate = new MangaReadingGate();
  const recovery = new MangaRecoveryBudget();
  const publish = () => actions.changed({ ...state });
  const observer = new MutationObserver((records) => {
    for (const record of records)
      if (
        record.target instanceof HTMLCanvasElement &&
        (record.attributeName === "width" || record.attributeName === "height")
      )
        versions.set(record.target, (versions.get(record.target) ?? 0) + 1);
  });
  const bindRoot = (images: MangaImage[]) => {
    root = mangaReaderRoot(images);
    rootId = root?.id || undefined;
    observer.disconnect();
    if (root)
      observer.observe(root, {
        subtree: true,
        attributes: true,
        attributeFilter: ["width", "height"],
      });
  };
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const pollPrefetch = async () => {
    clearTimeout(pollTimer);
    if (disposed || !state.enabled || !state.prefetch) return;
    const res = await chrome.runtime
      .sendMessage({ type: "MANGA_READING_STATE" })
      .catch(() => null);
    if (disposed || !state.enabled || !res?.state) return;
    const { aheadCount, readyCount, workingCount } = res.state;
    if (
      aheadCount !== state.aheadCount ||
      readyCount !== state.readyCount ||
      workingCount !== state.workingCount
    ) {
      state = { ...state, aheadCount, readyCount, workingCount };
      publish();
    }
    if ((workingCount ?? 0) > 0) {
      pollTimer = setTimeout(pollPrefetch, 1200);
    }
  };
  const stopTimer = () => {
    clearTimeout(timer);
    timer = undefined;
    clearTimeout(pollTimer);
    pollTimer = undefined;
    aheadAbort?.abort();
    observer.disconnect();
  };
  const pauseForError = async (
    hint: string,
    failure?: string,
    recovery?: "retry" | "settings",
  ) => {
    await set(false, false, hint);
    state.failure = failure;
    state.recovery = recovery;
    publish();
  };
  const visible = () => {
    if (root && !root.isConnected) {
      root = rootId
        ? (document.getElementById(rootId) ?? undefined)
        : undefined;
      observer.disconnect();
      if (root)
        observer.observe(root, {
          subtree: true,
          attributes: true,
          attributeFilter: ["width", "height"],
        });
    }
    const images = visibleMangaSpread();
    if (!root) bindRoot(images);
    return root
      ? images.filter(
          (image) =>
            root!.contains(image) &&
            (isCanvasImage(image) ||
              (image.complete && image.naturalWidth > 0)),
        )
      : [];
  };
  const run = async () => {
    if (disposed || !state.enabled) return;
    if (document.hidden || actions.paused()) return;
    if (!readingSessionAllows(state, location.href)) {
      await set(false, false, "manga.autoScopeEnded");
      return;
    }
    const images = visible();
    if (!images.length) {
      if (state.hint !== "manga.autoNoPage") {
        state.hint = "manga.autoNoPage";
        publish();
      }
      return;
    }
    if (!isLikelyMangaPage(document, images)) {
      await set(false, false, "manga.autoScopeEnded");
      return;
    }
    const sources = images.map(mangaImageSource);
    const canvasVersions = images.map((image) => versions.get(image) ?? 0);
    const sourcePage = location.href;
    const stillCurrent = () => {
      const current = visible();
      return current.length === images.length && current.every((image, index) => image === images[index]) &&
      location.href === sourcePage &&
      images.every(
        (image, index) =>
          image.isConnected &&
          mangaImageSource(image) === sources[index] &&
          (!isCanvasImage(image) ||
            (versions.get(image) ?? 0) === canvasVersions[index]),
      );
    };
    const signature =
      location.href +
      "|" +
      images
        .map((image) => {
          if (!ids.has(image)) ids.set(image, ++id);
          const rect = image.getBoundingClientRect();
          return [
            isCanvasImage(image)
              ? ids.get(image) + ":" + (versions.get(image) ?? 0)
              : mangaImageSource(image),
            Math.round(rect.x),
            Math.round(rect.y),
            Math.round(rect.width),
            Math.round(rect.height),
          ].join(":");
        })
        .join("|");
    if (!gate.observe(signature, Date.now())) return;
    const turn = sequence;
    gate.mark(signature);
    actions.prioritize(images);
    const pending = images.filter((image) => !actions.existing(image));
    const triggerPrefetch = async (
      turnId: number,
      targetSig: string,
      targetImages: MangaImage[],
    ) => {
      const settings = await getSettings().catch(() => null);
      const allowBg = settings?.manga?.backgroundPrefetch !== false;
      if (
        !state.prefetch ||
        aheadSignature === targetSig ||
        (!allowBg && document.hidden) ||
        actions.paused()
      )
        return;
      aheadSignature = targetSig;
      if (targetImages.some(isCanvasImage)) {
        state.hint = "manga.prefetchCanvas";
        publish();
        return;
      }
      const abort = new AbortController();
      aheadAbort = abort;
      const timeout = setTimeout(() => abort.abort(), 20000);
      try {
        const depth = Math.max(1, Math.min(5, settings?.manga?.prefetchDepth ?? 3));
        const nextItems = await nextMangaImages(
          targetImages,
          root,
          abort.signal,
          depth,
        );
        if (
          turnId !== sequence ||
          !state.enabled ||
          !state.prefetch ||
          disposed ||
          (!allowBg && document.hidden)
        )
          return;
        if (!nextItems.length) {
          state.hint = "manga.prefetchUnavailable";
          publish();
          return;
        }
        state.hint = "manga.prefetchLoading";
        state.prefetchTarget = nextItems.length;
        publish();
        let anyQueued = false;
        let queuedCount = 0;
        for (const item of nextItems) {
          if (turnId !== sequence || !state.enabled || disposed) break;
          const result = await chrome.runtime.sendMessage({
            type: "MANGA_READING_PREFETCH",
            payload: item,
          });
          if (result?.success && result.queued) {
            anyQueued = true;
            queuedCount++;
          }
        }
        if (turnId !== sequence || disposed) return;
        state.prefetchedCount = queuedCount;
        state.prefetchTarget = nextItems.length;
        state.hint = anyQueued
          ? "manga.prefetchQueued"
          : "manga.prefetchUnavailable";
        publish();
        void pollPrefetch();
      } catch {
        if (turnId === sequence && !disposed) {
          state.hint = "manga.prefetchUnavailable";
          publish();
        }
      } finally {
        clearTimeout(timeout);
        if (aheadAbort === abort) aheadAbort = undefined;
      }
    };
    if (pending.length) {
      state.hint = "manga.autoTranslating";
      state.failure = undefined;
      state.recovery = undefined;
      publish();
      await actions.start(pending);
      if (turn !== sequence || !state.enabled || disposed) return;
      if (state.prefetch && aheadSignature !== signature && !images.some(isCanvasImage)) {
        void triggerPrefetch(turn, signature, images);
      }
    }
    // Let both visible jobs finish before using the spare slot for next-page work.
    while (images.some((image) => actions.existing(image) === "working")) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (
        turn !== sequence ||
        !state.enabled ||
        disposed ||
        document.hidden ||
        !stillCurrent()
      )
        return;
    }
    if (!stillCurrent()) return;
    let failed = images.filter((image) => actions.existing(image) === "error");
    const retries: MangaImage[] = [];
    for (const image of failed) {
      const failure = actions.failure(image);
      const key =
        sourcePage +
        "|" +
        (isCanvasImage(image)
          ? ids.get(image) + ":" + (versions.get(image) ?? 0)
          : mangaImageSource(image));
      const decision = recovery.decide(key, failure);
      if (decision === "settings" || decision === "pause") {
        await pauseForError(
          decision === "settings"
            ? "manga.autoFixSettings"
            : "manga.autoPausedRepeated",
          failure.message,
          decision === "settings" ? "settings" : "retry",
        );
        return;
      }
      if (decision === "retry") retries.push(image);
    }
    if (retries.length) {
      state.hint = "manga.autoRetrying";
      state.failure = undefined;
      state.recovery = undefined;
      publish();
      await new Promise((resolve) => setTimeout(resolve, 1600));
      if (
        turn !== sequence ||
        !state.enabled ||
        disposed ||
        document.hidden ||
        actions.paused() ||
        !stillCurrent()
      ) {
        gate.reset();
        return;
      }
      await actions.start(retries);
      if (
        turn !== sequence ||
        !state.enabled ||
        disposed ||
        document.hidden ||
        !stillCurrent()
      )
        return;
      while (images.some((image) => actions.existing(image) === "working")) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (
          turn !== sequence ||
          !state.enabled ||
          disposed ||
          document.hidden ||
          !stillCurrent()
        )
          return;
      }
      if (!stillCurrent()) return;
      failed = images.filter((image) => actions.existing(image) === "error");
      for (const image of failed) {
        const failure = actions.failure(image);
        const key =
          sourcePage +
          "|" +
          (isCanvasImage(image)
            ? ids.get(image) + ":" + (versions.get(image) ?? 0)
            : mangaImageSource(image));
        const decision = recovery.decide(key, failure);
        if (decision === "settings" || decision === "pause") {
          await pauseForError(
            decision === "settings"
              ? "manga.autoFixSettings"
              : "manga.autoPausedRepeated",
            failure.message,
            decision === "settings" ? "settings" : "retry",
          );
          return;
        }
      }
    }
    if (failed.length) {
      state.hint = "manga.autoSkipPage";
      state.failure = actions.failure(failed[0]).message;
      state.recovery = "retry";
      publish();
      return;
    }
    recovery.success();
    state.failure = undefined;
    state.recovery = undefined;
    if (state.hint !== "manga.prefetchQueued" && state.hint !== "manga.prefetchLoading") {
      state.hint = "manga.autoWaiting";
    }
    publish();
    const settings = await getSettings().catch(() => null);
    const allowBg = settings?.manga?.backgroundPrefetch !== false;
    if (
      !state.prefetch ||
      aheadSignature === signature ||
      (!allowBg && document.hidden) ||
      actions.paused()
    )
      return;
    if (!stillCurrent()) return;
    const nowVisible = visible();
    if (
      nowVisible.length !== images.length ||
      nowVisible.some((image, index) => image !== images[index])
    )
      return;
    await triggerPrefetch(turn, signature, images);
  };
  const tick = async () => {
    const turn = sequence;
    timer = undefined;
    try {
      await run();
    } catch {
      if (!disposed && turn === sequence && state.enabled)
        await pauseForError("manga.autoPausedError");
    }
    if (!disposed && state.enabled && turn === sequence)
      timer = setTimeout(() => void tick(), 400);
  };
  const launch = () => {
    stopTimer();
    gate.reset();
    recovery.reset();
    aheadSignature = "";
    if (state.enabled) {
      bindRoot(visibleMangaSpread());
      timer = setTimeout(() => void tick(), 400);
    }
  };
  async function set(enabled: boolean, prefetch: boolean, hint?: string) {
    const turn = ++sequence;
    stopTimer();
    state = {
      ...state,
      enabled: false,
      prefetch: false,
      busy: true,
      hint: enabled ? "manga.autoStarting" : "manga.autoStopping",
    };
    publish();
    if (!enabled) actions.stopped();
    let next: MangaReadingUi;
    try {
      const result = await changeMangaReading(
        (message) => chrome.runtime.sendMessage(message),
        enabled,
        prefetch,
      );
      next = {
        ...result,
        busy: false,
        hint: hint || (enabled ? "manga.autoWaiting" : "manga.autoStopped"),
      };
    } catch (error) {
      next = {
        enabled: false,
        prefetch: false,
        busy: false,
        hint: readingControlErrorKey(error),
      };
    }
    if (disposed || turn !== sequence) return;
    state = next;
    launch();
    publish();
  }
  const visibility = async () => {
    const settings = await getSettings().catch(() => null);
    const allowBg = settings?.manga?.backgroundPrefetch !== false;
    if (document.hidden) {
      if (!allowBg) aheadAbort?.abort();
    } else {
      gate.reset();
    }
  };
  document.addEventListener("visibilitychange", visibility);

  let batchAbort: AbortController | undefined;
  const startBatchPrefetch = async (overrideLimit?: number) => {
    if (disposed) return;
    if (!state.enabled) {
      await set(true, true);
    }
    batchAbort?.abort();
    const abort = new AbortController();
    batchAbort = abort;
    state.isBatchPrefetching = true;
    state.hint = "manga.prefetchLoading";
    publish();

    try {
      const settings = await getSettings().catch(() => null);
      const limit =
        overrideLimit ??
        Math.max(5, Math.min(50, settings?.manga?.batchPrefetchLimit ?? 20));
      const currentImages = visible();
      if (!currentImages.length) {
        state.hint = "manga.autoNoPage";
        state.isBatchPrefetching = false;
        publish();
        return;
      }
      const nextItems = await nextMangaImages(
        currentImages,
        root,
        abort.signal,
        limit,
      );
      if (abort.signal.aborted || disposed) return;
      if (!nextItems.length) {
        state.hint = "manga.prefetchUnavailable";
        state.isBatchPrefetching = false;
        publish();
        return;
      }

      state.batchTarget = nextItems.length;
      state.batchCompleted = 0;
      publish();

      let consecutiveErrors = 0;
      for (const item of nextItems) {
        if (abort.signal.aborted || disposed) break;
        let queued = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          if (abort.signal.aborted || disposed) break;
          const result = await chrome.runtime.sendMessage({
            type: "MANGA_READING_PREFETCH",
            payload: { ...item, batch: true },
          });
          if (result?.success && result.queued) {
            consecutiveErrors = 0;
            state.batchCompleted = (state.batchCompleted ?? 0) + 1;
            publish();
            queued = true;
            break;
          }
          if (result?.busy) {
            // Buffer full, wait for active prefetching slots to drain
            await new Promise((r) => setTimeout(r, 1200));
            continue;
          }
          // Other transient error, wait briefly before retrying slot
          await new Promise((r) => setTimeout(r, 800));
        }
        if (!queued) {
          consecutiveErrors++;
          if (consecutiveErrors >= 3) break;
        }
        // Micro-pacing between enqueue dispatches to prevent message flooding
        await new Promise((r) => setTimeout(r, 80));
      }
      void pollPrefetch();
    } catch {
      // Aborted or network error
    } finally {
      if (batchAbort === abort) {
        batchAbort = undefined;
        state.isBatchPrefetching = false;
        publish();
      }
    }
  };

  const stopBatchPrefetch = () => {
    batchAbort?.abort();
    batchAbort = undefined;
    state.isBatchPrefetching = false;
    publish();
  };

  const init = ++sequence;
  void chrome.runtime
    .sendMessage({ type: "MANGA_READING_STATE" })
    .then((response) => {
      if (disposed || sequence !== init || !response?.state?.enabled) return;
      if (!readingSessionAllows(response.state, location.href)) {
        void set(false, false, "manga.autoScopeEnded");
        return;
      }
      state = { ...response.state, hint: "manga.autoWaiting" };
      launch();
      publish();
    })
    .catch(() => {});
  return {
    set,
    get state(): MangaReadingUi {
      return state;
    },
    retrigger() {
      aheadSignature = "";
      void tick();
    },
    startBatchPrefetch,
    stopBatchPrefetch,
    dispose() {
      disposed = true;
      sequence++;
      stopTimer();
      batchAbort?.abort();
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
