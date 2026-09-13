import { t, type UiLanguage } from "../../shared/i18n";
import type { MangaReadingUi } from "../../shared/manga/readingPolicy";
import { getSettings, saveSettings } from "../../shared/storage";

export function createMangaReadingPanel(
  change: (enabled: boolean, prefetch: boolean) => void,
  recover: () => void,
  onPrefetchDepthChange?: (depth: number) => void,
) {
  const element = document.createElement("div");
  element.className = "reading-options";
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
  void getSettings().then((s) => {
    if (s.manga?.prefetchDepth) {
      currentDepth = s.manga.prefetchDepth;
      syncDepthButtons();
    }
  }).catch(() => {});

  const depthButtons: { depth: number; btn: HTMLButtonElement }[] = [1, 2, 3].map(
    (d) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "depth-btn";
      btn.onclick = () => {
        currentDepth = d;
        syncDepthButtons();
        void getSettings().then(async (settings) => {
          settings.manga = { ...settings.manga, prefetchDepth: d };
          await saveSettings(settings);
          onPrefetchDepthChange?.(d);
        }).catch(() => {});
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
    else recover();
  };
  element.append(auto, ahead, depthRow, status, failure, recovery, quota);
  let current: MangaReadingUi = { enabled: false, prefetch: false };
  auto.onclick = () => change(!current.enabled, false);
  ahead.onclick = () => change(true, !current.prefetch);
  return {
    element,
    update(language: UiLanguage, state: MangaReadingUi) {
      current = state;
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

      const key =
        state.hint ||
        (state.enabled ? "manga.autoWaiting" : "manga.autoStopped");
      if (key === "manga.prefetchQueued") {
        status.textContent = t(language, "manga.prefetchQueuedCount", { count: currentDepth });
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
