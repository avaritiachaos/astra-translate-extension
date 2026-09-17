import { t, type UiLanguage } from "../../shared/i18n";
import type { MangaReadingUi } from "../../shared/manga/readingPolicy";
import type { MangaFontFamily, MangaBubbleTheme } from "../../shared/manga/types";
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
  batchPrefetch?: (start: boolean) => void;
  exportCurrent?: () => void;
  onFontFamilyChange?: (font: MangaFontFamily) => void;
  onBubbleThemeChange?: (theme: MangaBubbleTheme) => void;
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
    const cur = options.getScale?.() ?? 1.0;
    options.setScale?.(Math.max(0.7, Math.round((cur - 0.15) * 100) / 100));
  };

  const scaleDisplay = document.createElement("button");
  scaleDisplay.type = "button";
  scaleDisplay.className = "scale-display";
  scaleDisplay.textContent = "100%";
  scaleDisplay.onclick = () => {
    options.setScale?.(1.0);
  };

  const zoomInBtn = document.createElement("button");
  zoomInBtn.type = "button";
  zoomInBtn.className = "scale-btn";
  zoomInBtn.textContent = "A+";
  zoomInBtn.onclick = () => {
    const cur = options.getScale?.() ?? 1.0;
    options.setScale?.(Math.min(1.5, Math.round((cur + 0.15) * 100) / 100));
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

  // In-panel background prefetch switch
  const bgSwitch = document.createElement("button");
  bgSwitch.type = "button";
  bgSwitch.className = "reading-switch";
  bgSwitch.setAttribute("role", "switch");
  const bgLabel = document.createElement("span");
  const bgTrack = document.createElement("span");
  bgTrack.className = "switch-track";
  bgTrack.setAttribute("aria-hidden", "true");
  bgSwitch.append(bgLabel, bgTrack);
  bgSwitch.dataset.setting = "bgPrefetch";

  let currentBgPrefetch = true;
  void getSettings()
    .then((s) => {
      currentBgPrefetch = s.manga?.backgroundPrefetch !== false;
      bgSwitch.setAttribute("aria-checked", String(currentBgPrefetch));
    })
    .catch(() => {});

  bgSwitch.onclick = () => {
    currentBgPrefetch = !currentBgPrefetch;
    bgSwitch.setAttribute("aria-checked", String(currentBgPrefetch));
    void getSettings()
      .then(async (settings) => {
        settings.manga = {
          ...settings.manga,
          backgroundPrefetch: currentBgPrefetch,
        };
        await saveSettings(settings);
      })
      .catch(() => {});
  };

  // In-panel font style switcher
  const fontRow = document.createElement("div");
  fontRow.className = "reading-depth-row reading-font-row";
  const fontLabel = document.createElement("span");
  fontLabel.className = "depth-label";
  const fontButtonsWrap = document.createElement("div");
  fontButtonsWrap.className = "depth-buttons font-buttons";

  let currentFont: MangaFontFamily = "sans";
  void getSettings()
    .then((s) => {
      if (s.manga?.fontFamily) {
        currentFont = s.manga.fontFamily;
        syncFontButtons();
      }
    })
    .catch(() => {});

  const fontConfig: { id: MangaFontFamily; key: string }[] = [
    { id: "sans", key: "manga.fontSans" },
    { id: "rounded", key: "manga.fontRounded" },
    { id: "comic", key: "manga.fontComic" },
    { id: "serif", key: "manga.fontSerif" },
  ];

  const fontButtons: { id: MangaFontFamily; key: string; btn: HTMLButtonElement }[] =
    fontConfig.map((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "depth-btn font-btn";
      btn.onclick = () => {
        currentFont = item.id;
        syncFontButtons();
        options.onFontFamilyChange?.(item.id);
        void getSettings()
          .then(async (settings) => {
            settings.manga = { ...settings.manga, fontFamily: item.id };
            await saveSettings(settings);
          })
          .catch(() => {});
      };
      fontButtonsWrap.append(btn);
      return { id: item.id, key: item.key, btn };
    });

  const syncFontButtons = () => {
    for (const item of fontButtons) {
      item.btn.classList.toggle("active", item.id === currentFont);
    }
  };

  fontRow.append(fontLabel, fontButtonsWrap);

  // In-panel bubble background theme switcher
  const themeRow = document.createElement("div");
  themeRow.className = "reading-depth-row reading-theme-row";
  const themeLabel = document.createElement("span");
  themeLabel.className = "depth-label";
  const themeButtonsWrap = document.createElement("div");
  themeButtonsWrap.className = "depth-buttons theme-buttons";

  let currentTheme: MangaBubbleTheme = "auto";
  void getSettings()
    .then((s) => {
      if (s.manga?.bubbleTheme) {
        currentTheme = s.manga.bubbleTheme;
        syncThemeButtons();
      }
    })
    .catch(() => {});

  const themeConfig: { id: MangaBubbleTheme; key: string }[] = [
    { id: "auto", key: "manga.bubbleThemeAuto" },
    { id: "dark", key: "manga.bubbleThemeDark" },
    { id: "light", key: "manga.bubbleThemeLight" },
    { id: "translucent", key: "manga.bubbleThemeTranslucent" },
  ];

  const themeButtons: { id: MangaBubbleTheme; key: string; btn: HTMLButtonElement }[] =
    themeConfig.map((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "depth-btn theme-btn";
      btn.onclick = () => {
        currentTheme = item.id;
        syncThemeButtons();
        options.onBubbleThemeChange?.(item.id);
        void getSettings()
          .then(async (settings) => {
            settings.manga = { ...settings.manga, bubbleTheme: item.id };
            await saveSettings(settings);
          })
          .catch(() => {});
      };
      themeButtonsWrap.append(btn);
      return { id: item.id, key: item.key, btn };
    });

  const syncThemeButtons = () => {
    for (const item of themeButtons) {
      item.btn.classList.toggle("active", item.id === currentTheme);
    }
  };

  themeRow.append(themeLabel, themeButtonsWrap);

  // Batch prefetch chapter action button
  const batchBtn = document.createElement("button");
  batchBtn.type = "button";
  batchBtn.className = "reading-batch-btn";
  batchBtn.onclick = () => {
    const isRunning = !!current.isBatchPrefetching;
    options.batchPrefetch?.(!isRunning);
  };

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

  readingCard.append(auto, ahead, depthRow, bgSwitch, fontRow, themeRow, batchBtn, status, failure, recovery);

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

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "reading-tool-btn export-btn";
  exportBtn.onclick = () => options.exportCurrent?.();

  toolsGrid.append(origBtn, pickBtn, retryBtn, transBtn, exportBtn);
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

      const currentScale = options.getScale?.() ?? 1.0;
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

      bgLabel.textContent = t(language, "manga.bgPrefetch");
      bgSwitch.title = t(language, "manga.bgPrefetchHint");
      bgSwitch.setAttribute("aria-label", bgLabel.textContent);
      bgSwitch.setAttribute("aria-checked", String(currentBgPrefetch));
      bgSwitch.disabled = !!state.busy || !state.enabled || !state.prefetch;
      bgSwitch.hidden = !state.prefetch || !state.enabled;

      if (state.isBatchPrefetching) {
        batchBtn.textContent = "⏹ " + t(language, "manga.batchPrefetchStop");
        batchBtn.classList.add("active");
        batchBtn.title = t(language, "manga.batchPrefetchStop");
      } else {
        batchBtn.textContent = "📥 " + t(language, "manga.batchPrefetch");
        batchBtn.classList.remove("active");
        batchBtn.title = t(language, "manga.batchPrefetchHint");
      }
      batchBtn.disabled = !!state.busy || !state.enabled;
      batchBtn.hidden = !state.enabled;

      origBtn.textContent = t(language, "manga.compareOriginal");
      origBtn.classList.toggle("active", !!options.isOriginal?.());
      pickBtn.textContent = t(language, "manga.cropSelect");
      retryBtn.textContent = t(language, "manga.retranslateCurrent");
      transBtn.textContent = t(language, "manga.viewTranslations");
      exportBtn.textContent = t(language, "manga.exportImage");

      fontLabel.textContent = t(language, "manga.fontFamily");
      for (const item of fontButtons) {
        item.btn.textContent = t(language, item.key);
      }
      syncFontButtons();

      themeLabel.textContent = t(language, "manga.bubbleTheme");
      for (const item of themeButtons) {
        item.btn.textContent = t(language, item.key);
      }
      syncThemeButtons();

      orientBtn.textContent = t(language, "manga.dockOrientationToggle");
      capsuleBtn.textContent = t(language, "manga.minimizeCapsule");

      const key =
        state.hint ||
        (state.enabled ? "manga.autoWaiting" : "manga.autoStopped");
      if (state.isBatchPrefetching) {
        const target = state.batchTarget ?? 0;
        const ready = state.readyCount ?? state.batchCompleted ?? 0;
        status.textContent = t(language, "manga.batchWorking", {
          ready,
          total: target || "?",
        });
      } else if (state.enabled && state.prefetch && (state.aheadCount ?? 0) > 0) {
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
