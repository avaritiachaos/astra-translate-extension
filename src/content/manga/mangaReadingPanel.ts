import { t, type UiLanguage } from "../../shared/i18n";
import type { MangaReadingUi } from "../../shared/manga/readingPolicy";
import { getSettings, saveSettings } from "../../shared/storage";

export interface MangaReadingPanelOptions {
  change: (enabled: boolean, prefetch: boolean) => void;
  recover: () => void;
  onPrefetchDepthChange?: (depth: number) => void;
  getScale?: () => number;
  setScale?: (scale: number) => void;
  toggleOriginal?: () => void;
  isOriginal?: () => boolean;
  pick?: () => void;
  retranslate?: () => void;
  showTranslations?: () => void;
  toggleOrientation?: () => void;
  isVertical?: () => boolean;
  collapseToCapsule?: () => void;
  close?: () => void;
}

export function createMangaReadingPanel(
  optionsOrChange: ((enabled: boolean, prefetch: boolean) => void) | MangaReadingPanelOptions,
  recoverArg?: () => void,
  onPrefetchDepthChangeArg?: (depth: number) => void,
) {
  const options: MangaReadingPanelOptions =
    typeof optionsOrChange === "function"
      ? {
          change: optionsOrChange,
          recover: recoverArg || (() => {}),
          onPrefetchDepthChange: onPrefetchDepthChangeArg,
        }
      : optionsOrChange;

  const element = document.createElement("div");
  element.className = "reading-dialog-container";

  // 1. Header with Title, Scale Controls, and Close Button
  const header = document.createElement("div");
  header.className = "reading-dialog-header";

  const title = document.createElement("div");
  title.className = "reading-dialog-title";

  const headerRight = document.createElement("div");
  headerRight.className = "reading-header-actions";

  const scaleGroup = document.createElement("div");
  scaleGroup.className = "reading-scale-group";

  const zoomOutBtn = document.createElement("button");
  zoomOutBtn.type = "button";
  zoomOutBtn.className = "scale-btn";
  zoomOutBtn.textContent = "A-";
  zoomOutBtn.onclick = () => {
    const cur = options.getScale?.() ?? 1.2;
    options.setScale?.(Math.max(0.75, Math.round((cur - 0.15) * 100) / 100));
  };

  const scaleDisplay = document.createElement("button");
  scaleDisplay.type = "button";
  scaleDisplay.className = "scale-display";
  scaleDisplay.textContent = "120%";
  scaleDisplay.onclick = () => {
    options.setScale?.(1.2);
  };

  const zoomInBtn = document.createElement("button");
  zoomInBtn.type = "button";
  zoomInBtn.className = "scale-btn";
  zoomInBtn.textContent = "A+";
  zoomInBtn.onclick = () => {
    const cur = options.getScale?.() ?? 1.2;
    options.setScale?.(Math.min(1.6, Math.round((cur + 0.15) * 100) / 100));
  };

  scaleGroup.append(zoomOutBtn, scaleDisplay, zoomInBtn);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "reading-dialog-close";
  closeBtn.textContent = "×";
  closeBtn.onclick = () => options.close?.();

  headerRight.append(scaleGroup, closeBtn);
  header.append(title, headerRight);

  // 2. Reading & Prefetch Settings Card
  const readingCard = document.createElement("div");
  readingCard.className = "reading-card-section";

  const auto = document.createElement("button"),
    ahead = document.createElement("button");
  const labels = [
    document.createElement("span"),
    document.createElement("span"),
  ];
  for (const [index, button] of [auto, ahead].entries()) {
    button.type = "button";
    button.className = "reading-switch";
    button.setAttribute("role", "switch");
    const track = document.createElement("span");
    track.className = "switch-track";
    track.setAttribute("aria-hidden", "true");
    button.append(labels[index], track);
  }
  auto.dataset.setting = "automatic";
  ahead.dataset.setting = "prefetch";

  // In-panel prefetch depth selector
  const depthRow = document.createElement("div");
  depthRow.className = "reading-depth-row";
  const depthLabel = document.createElement("span");
  depthLabel.className = "depth-label";
  const depthButtonsWrap = document.createElement("div");
  depthButtonsWrap.className = "depth-buttons";

  let currentDepth = 2;
  void getSettings()
    .then((s) => {
      if (s.manga?.prefetchDepth) {
        currentDepth = s.manga.prefetchDepth;
        syncDepthButtons();
      }
    })
    .catch(() => {});

  const depthButtons: { depth: number; btn: HTMLButtonElement }[] = [1, 2, 3].map(
    (d) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "depth-btn";
      btn.onclick = () => {
        currentDepth = d;
        syncDepthButtons();
        void getSettings()
          .then(async (settings) => {
            settings.manga = { ...settings.manga, prefetchDepth: d };
            await saveSettings(settings);
            options.onPrefetchDepthChange?.(d);
          })
          .catch(() => {});
      };
      depthButtonsWrap.append(btn);
      return { depth: d, btn };
    },
  );

  const syncDepthButtons = () => {
    for (const item of depthButtons) {
      item.btn.classList.toggle("active", item.depth === currentDepth);
    }
  };

  depthRow.append(depthLabel, depthButtonsWrap);

  const status = document.createElement("div"),
    quota = document.createElement("p");
  status.className = "reading-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  quota.className = "reading-quota";

  const failure = document.createElement("p"),
    recovery = document.createElement("button");
  failure.className = "reading-failure";
  recovery.className = "reading-recover";
  recovery.type = "button";
  recovery.onclick = () => {
    if (current.recovery === "settings")
      void chrome.runtime
        .sendMessage({
          type: "OPEN_OPTIONS_PAGE",
          payload: { section: "manga" },
        })
        .catch(() => {});
    else options.recover();
  };

  readingCard.append(auto, ahead, depthRow, status, failure, recovery);

  // 3. Quick Reading Actions Grid
  const toolsCard = document.createElement("div");
  toolsCard.className = "reading-card-section";

  const toolsGrid = document.createElement("div");
  toolsGrid.className = "reading-tools-grid";

  const origBtn = document.createElement("button");
  origBtn.type = "button";
  origBtn.className = "reading-tool-btn";
  origBtn.onclick = () => {
    options.toggleOriginal?.();
    origBtn.classList.toggle("active", !!options.isOriginal?.());
  };

  const pickBtn = document.createElement("button");
  pickBtn.type = "button";
  pickBtn.className = "reading-tool-btn";
  pickBtn.onclick = () => options.pick?.();

  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.className = "reading-tool-btn";
  retryBtn.onclick = () => options.retranslate?.();

  const transBtn = document.createElement("button");
  transBtn.type = "button";
  transBtn.className = "reading-tool-btn";
  transBtn.onclick = () => options.showTranslations?.();

  toolsGrid.append(origBtn, pickBtn, retryBtn, transBtn);
  toolsCard.append(toolsGrid);

  // 4. Form & Minimize Footer Row
  const footerCard = document.createElement("div");
  footerCard.className = "reading-footer-row";

  const orientBtn = document.createElement("button");
  orientBtn.type = "button";
  orientBtn.className = "reading-footer-btn";
  orientBtn.onclick = () => options.toggleOrientation?.();

  const capsuleBtn = document.createElement("button");
  capsuleBtn.type = "button";
  capsuleBtn.className = "reading-footer-btn";
  capsuleBtn.onclick = () => options.collapseToCapsule?.();

  footerCard.append(orientBtn, capsuleBtn);

  element.append(header, readingCard, toolsCard, footerCard, quota);

  let current: MangaReadingUi = { enabled: false, prefetch: false };
  auto.onclick = () => options.change(!current.enabled, false);
  ahead.onclick = () => options.change(true, !current.prefetch);

  return {
    element,
    reflectOriginal(isOrig: boolean) {
      origBtn.classList.toggle("active", isOrig);
    },
    reflectScale(scale: number) {
      scaleDisplay.textContent = Math.round(scale * 100) + "%";
    },
    update(language: UiLanguage, state: MangaReadingUi) {
      current = state;
      title.textContent = "📖 " + t(language, "manga.readingSettingsTitle");
      zoomOutBtn.title = t(language, "manga.scaleZoomOut");
      zoomInBtn.title = t(language, "manga.scaleZoomIn");
      scaleDisplay.title = t(language, "manga.scaleReset");
      closeBtn.title = t(language, "manga.closeDialog");

      const currentScale = options.getScale?.() ?? 1.2;
      scaleDisplay.textContent = Math.round(currentScale * 100) + "%";

      labels[0].textContent = t(language, "manga.autoTranslate");
      labels[1].textContent = t(language, "manga.prefetchPages");
      auto.setAttribute("aria-label", labels[0].textContent);
      ahead.setAttribute("aria-label", labels[1].textContent);
      auto.setAttribute("aria-checked", String(state.enabled));
      ahead.setAttribute("aria-checked", String(state.prefetch));
      auto.disabled = !!state.busy;
      ahead.disabled = !!state.busy || !state.enabled;
      auto.setAttribute("aria-busy", String(!!state.busy));

      depthLabel.textContent = t(language, "manga.prefetchDepth");
      depthButtons[0].btn.textContent = t(language, "manga.depth1");
      depthButtons[1].btn.textContent = t(language, "manga.depth2");
      depthButtons[2].btn.textContent = t(language, "manga.depth3");
      syncDepthButtons();
      depthRow.hidden = !state.prefetch || !state.enabled;

      origBtn.textContent = t(language, "manga.compareOriginal");
      origBtn.classList.toggle("active", !!options.isOriginal?.());
      pickBtn.textContent = t(language, "manga.cropSelect");
      retryBtn.textContent = t(language, "manga.retranslateCurrent");
      transBtn.textContent = t(language, "manga.viewTranslations");

      orientBtn.textContent = t(language, "manga.dockOrientationToggle");
      capsuleBtn.textContent = t(language, "manga.minimizeCapsule");

      const key =
        state.hint ||
        (state.enabled ? "manga.autoWaiting" : "manga.autoStopped");
      if (state.enabled && state.prefetch && (state.aheadCount ?? 0) > 0) {
        const total = state.aheadCount!;
        const ready = state.readyCount ?? 0;
        if (ready >= total) {
          status.textContent = t(language, "manga.readingPrefetchReadyAll", {
            count: total,
          });
        } else {
          status.textContent = t(language, "manga.readingPrefetchWorking", {
            ready,
            total,
          });
        }
      } else if (key === "manga.prefetchLoading") {
        status.textContent = t(language, "manga.readingPrefetchSearching");
      } else if (key === "manga.prefetchQueued") {
        status.textContent = t(language, "manga.prefetchQueuedCount", {
          count: state.prefetchTarget || currentDepth,
        });
      } else {
        status.textContent = t(language, key);
      }
      status.classList.toggle(
        "error",
        [
          "manga.readingPageChanged",
          "manga.readingTimedOut",
          "manga.readingConnectionFailed",
          "manga.autoPausedError",
          "manga.autoFixSettings",
          "manga.autoPausedRepeated",
          "manga.autoSkipPage",
        ].includes(key),
      );
      failure.textContent = state.failure?.slice(0, 240) || "";
      failure.hidden = !state.failure;
      recovery.hidden = !state.recovery;
      recovery.disabled = !!state.busy;
      recovery.textContent = t(
        language,
        state.recovery === "settings"
          ? "manga.openSettings"
          : state.enabled
            ? "manga.retryPage"
            : "manga.retryAndContinue",
      );
      quota.textContent = t(language, "manga.readingQuotaHint");
    },
  };
}
