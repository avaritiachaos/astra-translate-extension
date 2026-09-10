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
import { mangaReaderRoot, nextMangaImage } from "./mangaNextPage";
import {
  changeMangaReading,
  readingControlErrorKey,
} from "../../shared/manga/readingClient";
import {
  MangaRecoveryBudget,
  type MangaFailure,
} from "../../shared/manga/readingRecovery";

export function createMangaAutoReader(actions: {
  start: (images: MangaImage[]) => Promise<void>;
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
  const stopTimer = () => {
    clearTimeout(timer);
    timer = undefined;
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
    if (!readingSessionAllows(state, location.href)) {
      await set(false, false, "manga.autoScopeEnded");
      return;
    }
    if (document.hidden || actions.paused()) return;
    const images = visible();
    if (!images.length) {
      if (state.hint !== "manga.autoNoPage") {
        state.hint = "manga.autoNoPage";
        publish();
      }
      return;
    }
    const sources = images.map(mangaImageSource);
    const canvasVersions = images.map((image) => versions.get(image) ?? 0);
    const sourcePage = location.href;
    const stillCurrent = () =>
      location.href === sourcePage &&
      images.every(
        (image, index) =>
          image.isConnected &&
          mangaImageSource(image) === sources[index] &&
          (!isCanvasImage(image) ||
            (versions.get(image) ?? 0) === canvasVersions[index]),
      );
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
    const pending = images.filter((image) => !actions.existing(image));
    if (pending.length) {
      state.hint = "manga.autoTranslating";
      state.failure = undefined;
      state.recovery = undefined;
      publish();
      await actions.start(pending);
      if (turn !== sequence || !state.enabled || disposed) return;
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
    state.hint = "manga.autoWaiting";
    publish();
    if (
      !state.prefetch ||
      aheadSignature === signature ||
      document.hidden ||
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
    aheadSignature = signature;
    if (images.some(isCanvasImage)) {
      state.hint = "manga.prefetchCanvas";
      publish();
      return;
    }
    const abort = new AbortController();
    aheadAbort = abort;
    const timeout = setTimeout(() => abort.abort(), 8000);
    try {
      const next = await nextMangaImage(images, root, abort.signal);
      if (
        turn !== sequence ||
        !state.enabled ||
        !state.prefetch ||
        disposed ||
        document.hidden ||
        !stillCurrent()
      )
        return;
      if (!next) {
        state.hint = "manga.prefetchUnavailable";
        publish();
        return;
      }
      state.hint = "manga.prefetchLoading";
      publish();
      const result = await chrome.runtime.sendMessage({
        type: "MANGA_READING_PREFETCH",
        payload: next,
      });
      if (turn !== sequence || disposed) return;
      state.hint =
        result?.success && result.queued
          ? "manga.prefetchQueued"
          : "manga.prefetchUnavailable";
      publish();
    } catch {
      if (turn === sequence && !disposed) {
        state.hint = "manga.prefetchUnavailable";
        publish();
      }
    } finally {
      clearTimeout(timeout);
      if (aheadAbort === abort) aheadAbort = undefined;
    }
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
  const visibility = () => {
    if (document.hidden) aheadAbort?.abort();
    else gate.reset();
  };
  document.addEventListener("visibilitychange", visibility);
  const init = ++sequence;
  void chrome.runtime
    .sendMessage({ type: "MANGA_READING_STATE" })
    .then((response) => {
      if (disposed || sequence !== init || !response?.state?.enabled) return;
      state = { ...response.state, hint: "manga.autoWaiting" };
      launch();
      publish();
    })
    .catch(() => {});
  return {
    set,
    get state(): MangaReadingState {
      return state;
    },
    dispose() {
      disposed = true;
      sequence++;
      stopTimer();
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
