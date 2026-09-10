import { t, type UiLanguage } from "../../shared/i18n";
import type { MangaViewState } from "./mangaOverlay";
import { isolateMangaControls, MANGA_CARD_OPEN_EVENT } from "./mangaControls";
import { summarizeTranslations } from "../../shared/manga/translationPresentation";
import { appendMangaTranslations } from "./mangaTranslationList";
import { makeMangaDockDraggable } from "./mangaDockDrag";
import { panelAtDock } from "../../shared/manga/dockGeometry";
import type { MangaReadingUi } from "../../shared/manga/readingPolicy";
import { createMangaReadingPanel } from "./mangaReadingPanel";

export interface ReaderItem extends MangaViewState {
  id: string;
  retry: () => void;
  restore: () => void;
}
export function createMangaReaderControls(
  language: () => UiLanguage,
  actions: {
    pick: () => void;
    translate: () => void;
    restore: () => void;
    original: (value: boolean) => void;
    reading: (enabled: boolean, prefetch: boolean) => void;
  },
) {
  const host = document.createElement("div"),
    root = host.attachShadow({ mode: "open" });
  host.className = "ast-manga-reader";
  host.setAttribute("popover", "manual");
  const style = document.createElement("style");
  style.textContent = `
:host{all:initial;position:fixed;inset:auto auto 16px 50%;transform:translateX(-50%);margin:0;padding:0;border:0;background:transparent;width:max-content;max-width:calc(100vw - 24px);overflow:visible;z-index:2147483645;font:13px "Segoe UI","Microsoft YaHei",sans-serif;color:#efedf9}
*{box-sizing:border-box}[hidden]{display:none!important}button{font:inherit;border:0;cursor:pointer;color:inherit;white-space:nowrap}button:focus-visible{outline:2px solid #c6baff;outline-offset:2px}button:disabled{opacity:.45;cursor:default}
.grip{cursor:grab!important;touch-action:none;user-select:none;flex:none;font-size:20px;line-height:1;padding:8px 9px!important;color:#bfb6d2}.grip:hover{color:#fff}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:4px}.dock.compact .actions{display:none}.compact-button{min-width:46px;color:#ece8ff;font-size:12px}.compact-button[data-mode=auto]{color:#b7f3ce}.compact-button[data-mode=error]{color:#ffd09e}.compact-button:focus-visible{outline:2px solid #c6baff}.reading-switch{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;min-height:42px;padding:7px 0;color:#302b3a;border-radius:6px;font-size:14px}.reading-switch:hover{background:#f3f0fa}.reading-switch:focus-visible{outline-color:#8978bd}.switch-track{display:block;width:34px;height:20px;flex:none;border-radius:12px;background:#d5cedf;padding:3px;transition:background .12s}.switch-track::after{content:"";display:block;width:14px;height:14px;border-radius:50%;background:white;box-shadow:0 1px 3px #0002;transition:transform .12s}.reading-switch[aria-checked=true] .switch-track{background:#7161ce}.reading-switch[aria-checked=true] .switch-track::after{transform:translateX(14px)}.reading-switch:disabled{opacity:.5;cursor:default}.reading-status{font-size:12px;line-height:1.5;color:#7b7189;margin-top:6px;min-height:18px}.reading-status.error{color:#a55c32}.reading-failure{font-size:12px;line-height:1.5;color:#8c6f67;white-space:normal;overflow-wrap:anywhere;margin:5px 0 8px}.reading-recover{display:block;text-align:left;color:#6f54a2!important;background:#f1edf8!important;font-size:12px;border:1px solid #e6e0f0!important;padding:6px 10px!important;border-radius:8px;margin:4px 0 8px}.reading-quota{font-size:11px;color:#9a91a6;line-height:1.5;margin:7px 0 0}.panel.reading{width:290px}

.dock{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:6px 7px;background:#292731f5;border:1px solid #ffffff20;border-radius:13px;box-shadow:0 3px 16px #17132922;backdrop-filter:blur(8px);max-width:calc(100vw - 24px)}
button{background:transparent;padding:8px 10px;border-radius:10px}button:hover{background:#ffffff18}.primary{background:#7969b2;color:#fff;font-weight:550}.primary:hover{background:#8d7bc6}.original[aria-pressed=true]{background:#eeebff;color:#4a3b97}.all-results{color:#ded6ff}.all-results[aria-expanded=true]{background:#ffffff20}.summary{max-width:100px;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:#c7c2d9}.summary.error{color:#ffd09e}.clear{font-size:19px;line-height:1;padding:8px}.trigger{background:#7161dc;color:#fff;border-radius:22px;padding:10px 16px;box-shadow:0 3px 16px #17132930}
.panel{position:absolute;right:0;bottom:54px;width:340px;max-width:calc(100vw - 24px);max-height:min(65vh,440px);overflow:auto;color:#292533;background:#faf9ff;border:1px solid #e5e1f1;border-radius:16px;box-shadow:0 10px 36px #17132930;padding:14px}
.translation-result{border:1px solid #e6e1ee;border-radius:10px;padding:10px;margin:8px 0;background:white}.result-heading{display:flex;gap:6px;align-items:center;margin-bottom:5px}.result-badge{font-size:11px;line-height:1.5;color:#6751a3;background:#f2eefc;border-radius:5px;padding:2px 5px}.translation-result[data-translation-state=uncertain] .result-badge{color:#825915;background:#fff4df}.translation-result[data-translation-state=untranslated] .result-badge{color:#72657b;background:#efecf2}.row .result-reason{font-size:11px;color:#84748f;margin-bottom:8px}.result-translation{font-size:14px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.row .result-source{font-size:12px;color:#8c8293;border-top:1px solid #f0edf4;margin-top:9px;padding-top:7px}.row .result-counts{font-size:11px;color:#84788f}.panel.translations{width:390px}.panel.translations header{margin-bottom:8px}
.panel header{font-size:13px;font-weight:600;margin-bottom:8px}.row{border-top:1px solid #e9e6f2;padding:10px 0}.row:first-child{border-top:0}.row p{font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 5px;color:#736b82}.row.error p{color:#8d5315}.row button{color:#66519a;background:#f0edf8;font-size:12px;padding:5px 8px;margin-right:4px}.hint{font-size:11px;color:#9690a3;line-height:1.5;margin:8px 0 0}
@media(max-width:620px){.summary{max-width:80px}.dock{gap:1px}button{padding:8px 7px}}
`;
  const dock = document.createElement("div");
  dock.className = "dock";
  dock.setAttribute("role", "toolbar");
  dock.setAttribute("aria-label", t(language(), "manga.title"));
  const actionGroup = document.createElement("div");
  actionGroup.className = "actions";
  const compact = document.createElement("button"),
    collapse = document.createElement("button"),
    reading = document.createElement("button");
  compact.className = "compact-button";
  collapse.className = "collapse";
  reading.className = "reading-settings";
  for (const button of [compact, collapse, reading]) button.type = "button";
  collapse.textContent = "−";
  const grip = document.createElement("button");
  grip.className = "grip";
  grip.type = "button";
  grip.textContent = "⠿";
  const trigger = document.createElement("button"),
    translate = document.createElement("button"),
    pick = document.createElement("button"),
    original = document.createElement("button"),
    summary = document.createElement("button"),
    results = document.createElement("button"),
    clear = document.createElement("button");
  trigger.className = "trigger";
  translate.className = "primary";
  original.className = "original";
  summary.className = "summary";
  results.className = "all-results";
  clear.className = "clear";
  for (const button of [
    trigger,
    translate,
    pick,
    original,
    results,
    summary,
    clear,
  ])
    button.type = "button";
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.hidden = true;
  panel.id = "manga-reader-panel";
  panel.setAttribute("role", "region");
  summary.setAttribute("aria-controls", panel.id);
  results.setAttribute("aria-controls", panel.id);
  const heading = document.createElement("header"),
    rows = document.createElement("div"),
    hint = document.createElement("p");
  hint.className = "hint";
  panel.append(heading, rows, hint);
  const readingPanel = createMangaReadingPanel(
    (enabled, prefetch) => actions.reading(enabled, prefetch),
    () => {
      actions.translate();
      if (!readingState.enabled) actions.reading(true, false);
    },
  );
  actionGroup.append(
    translate,
    pick,
    original,
    results,
    reading,
    summary,
    collapse,
    clear,
  );
  dock.append(grip, compact, actionGroup);
  root.append(style, trigger, dock, panel);
  let session = false,
    picking = false,
    captures = 0,
    showingOriginal = false,
    items: ReaderItem[] = [],
    pageCount = 0,
    canTranslate = false,
    signature = "";
  let errorSignature = "";
  let panelMode: "progress" | "translations" | "reading" = "progress";
  let readingState: MangaReadingUi = { enabled: false, prefetch: false };
  let expanded = false;
  let collapseTimer: ReturnType<typeof setTimeout> | undefined;
  const syncExpanded = () => {
    summary.setAttribute(
      "aria-expanded",
      String(!panel.hidden && panelMode === "progress"),
    );
    results.setAttribute(
      "aria-expanded",
      String(!panel.hidden && panelMode === "translations"),
    );
    reading.setAttribute(
      "aria-expanded",
      String(!panel.hidden && panelMode === "reading"),
    );
  };
  trigger.onclick = actions.pick;
  pick.onclick = actions.pick;
  translate.onclick = actions.translate;
  clear.textContent = "×";
  clear.onclick = () => {
    showingOriginal = false;
    actions.original(false);
    actions.restore();
  };
  original.onclick = () => {
    showingOriginal = !showingOriginal;
    actions.original(showingOriginal);
    panel.hidden = true;
    syncExpanded();
    original.setAttribute("aria-pressed", String(showingOriginal));
  };
  const collapseDock = () => {
    expanded = false;
    panel.hidden = true;
    refresh();
  };
  compact.onclick = () => {
    expanded = true;
    refresh();
  };
  collapse.onclick = collapseDock;
  dock.addEventListener("pointerenter", () => clearTimeout(collapseTimer));
  dock.addEventListener("pointerleave", () => {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      if (panel.hidden && !root.activeElement?.matches(":focus-visible"))
        collapseDock();
    }, 2400);
  });
  const togglePanel = (mode: "progress" | "translations" | "reading") => {
    panel.hidden = !panel.hidden && panelMode === mode;
    panelMode = mode;
    refresh();
  };
  summary.onclick = () => togglePanel("progress");
  results.onclick = () => togglePanel("translations");
  reading.onclick = () => togglePanel("reading");
  const visibility = () => {
    host.style.visibility = picking || captures ? "hidden" : "visible";
  };
  const layoutPanel = () => {
    if (panel.hidden || !host.isConnected) return;
    const bounds = host.getBoundingClientRect();
    panel.style.width =
      Math.min(
        panelMode === "translations"
          ? 390
          : panelMode === "reading"
            ? 290
            : 340,
        innerWidth - 24,
      ) + "px";
    panel.style.maxHeight = Math.min(innerHeight * 0.65, 500) + "px";
    const box = panelAtDock(
      bounds,
      {
        width: panel.offsetWidth,
        height: Math.min(panel.scrollHeight + 2, innerHeight * 0.65, 500),
      },
      { width: innerWidth, height: innerHeight },
    );
    Object.assign(panel.style, {
      left: box.x - bounds.x + "px",
      top: box.y - bounds.y + "px",
      bottom: "auto",
      right: "auto",
      maxHeight: box.height + "px",
    });
  };
  const drag = makeMangaDockDraggable(host, grip, layoutPanel);
  const mount = () => {
    if (!session && !(document.fullscreenElement && pageCount)) {
      host.remove();
      return;
    }
    const parent =
      document.fullscreenElement ?? document.body ?? document.documentElement;
    if (host.parentElement !== parent) parent.append(host);
    host.showPopover?.();
    drag.layout();
    visibility();
  };
  const stateText = () =>
    readingState.enabled
      ? t(language(), "manga.autoCompact")
      : "译 " +
        (items.length
          ? items.filter((item) => item.phase === "ready").length +
            "/" +
            items.length
          : "");
  const refresh = () => {
    const lang = language(),
      ready = items.filter((item) => item.phase === "ready").length,
      errors = items.filter((item) => item.phase === "error");
    const counts = summarizeTranslations(
      items.flatMap((item) => item.translations),
    );
    grip.setAttribute("aria-label", t(lang, "manga.dragToolbar"));
    grip.title = t(lang, "manga.dragToolbarHint");
    trigger.textContent = t(lang, "manga.title");
    trigger.setAttribute("aria-label", t(lang, "manga.pick"));
    dock.classList.toggle("compact", !expanded);
    compact.hidden = expanded;
    compact.textContent = stateText();
    compact.dataset.mode = errors.length
      ? "error"
      : readingState.enabled
        ? "auto"
        : "manual";
    compact.setAttribute("aria-label", t(lang, "manga.expandControls"));
    compact.title = t(
      lang,
      readingState.enabled ? "manga.autoActiveCompact" : "manga.expandControls",
    );
    collapse.setAttribute("aria-label", t(lang, "manga.collapseControls"));
    collapse.title = t(lang, "manga.collapseControls");
    reading.textContent = t(
      lang,
      readingState.enabled ? "manga.autoOn" : "manga.autoSettings",
    );
    reading.title = t(lang, "manga.autoSettings");
    trigger.hidden = session;
    dock.hidden = !session;
    if (!session) panel.hidden = true;
    const currentLabel =
      pageCount === 0 || canTranslate
        ? errors.length
          ? "manga.retryPage"
          : pageCount === 2
            ? "manga.translateCurrentSpread"
            : "manga.translateCurrentPage"
        : items.some((item) => item.phase === "working")
          ? "manga.translatingShort"
          : "manga.doneShort";
    translate.textContent = t(lang, currentLabel);
    translate.disabled = pageCount > 0 && !canTranslate;
    translate.title = t(lang, "manga.visibleOnlyHint");
    pick.textContent = t(lang, "manga.selectImageShort");
    pick.title = t(lang, "manga.pick");
    original.textContent = t(lang, "manga.original");
    original.disabled = !items.length;
    original.setAttribute("aria-pressed", String(showingOriginal));
    clear.setAttribute("aria-label", t(lang, "manga.restoreAll"));
    clear.title = t(lang, "manga.restoreAll");
    summary.textContent = errors.length
      ? t(lang, "manga.readerErrors", { count: errors.length })
      : items.length
        ? t(lang, "manga.readerProgress", { ready, total: items.length })
        : t(lang, "manga.currentPageIdle");
    summary.classList.toggle("error", errors.length > 0);
    summary.setAttribute("aria-label", t(lang, "manga.readerDetails"));
    summary.title = t(lang, "manga.readerDetails");
    results.textContent = t(lang, "manga.allTranslations");
    results.setAttribute("aria-label", t(lang, "manga.allTranslations"));
    results.title = t(lang, "manga.translationCounts", counts);
    results.disabled = !items.some((item) => item.translations.length);
    const nextError = errors.map((item) => item.id + item.status).join("|");
    if (expanded && nextError && nextError !== errorSignature) {
      panel.hidden = false;
      panelMode = "progress";
    }
    errorSignature = nextError;
    panel.classList.toggle("translations", panelMode === "translations");
    panel.classList.toggle("reading", panelMode === "reading");
    hint.hidden = panelMode === "reading";
    const titleKey =
      panelMode === "reading"
        ? "manga.autoSettings"
        : panelMode === "translations"
          ? "manga.allTranslations"
          : "manga.readerDetails";
    heading.textContent = t(lang, titleKey);
    panel.setAttribute("aria-label", t(lang, titleKey));
    hint.textContent = t(
      lang,
      panelMode === "translations"
        ? "manga.returnedOnlyHint"
        : "manga.markerHint",
    );
    const nextSignature =
      JSON.stringify(
        items.map(
          ({
            id,
            status,
            phase,
            markers,
            needsSetup,
            translationsRevision,
          }) => ({
            id,
            status,
            phase,
            markers,
            needsSetup,
            translationsRevision,
          }),
        ),
      ) +
      lang +
      panelMode +
      JSON.stringify(readingState);
    if (signature !== nextSignature) {
      signature = nextSignature;
      if (panelMode === "reading") {
        readingPanel.update(lang, readingState);
        if (readingPanel.element.parentNode !== rows)
          rows.replaceChildren(readingPanel.element);
      } else {
        rows.replaceChildren();
        items.forEach((item, index) => {
          const row = document.createElement("div"),
            text = document.createElement("p");
          row.className = "row" + (item.phase === "error" ? " error" : "");
          text.textContent =
            t(lang, "manga.readerPage", { page: index + 1 }) +
            " · " +
            item.status;
          row.append(text);
          const count = document.createElement("p");
          count.className = "result-counts";
          count.textContent = t(
            lang,
            "manga.translationCounts",
            summarizeTranslations(item.translations),
          );
          if (item.translations.length) row.append(count);
          if (panelMode === "translations") {
            appendMangaTranslations(row, item.translations, lang);
            rows.append(row);
            return;
          }
          const button = (label: string, action: () => void) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = t(lang, label);
            b.onclick = action;
            row.append(b);
          };
          if (item.needsSetup)
            button("manga.openSettings", () => {
              void chrome.runtime
                .sendMessage({
                  type: "OPEN_OPTIONS_PAGE",
                  payload: { section: "manga" },
                })
                .catch(() => {});
            });
          button("manga.retry", item.retry);
          button("manga.restore", item.restore);
          rows.append(row);
        });
      }
    }
    syncExpanded();
    mount();
  };
  const outside = (event: Event) => {
    if (!event.composedPath().includes(host)) {
      panel.hidden = true;
      syncExpanded();
    }
  };
  const stopControls = isolateMangaControls(host, root, () => {
    if (!panel.hidden) {
      panel.hidden = true;
      syncExpanded();
      return true;
    }
    if (expanded) {
      collapseDock();
      return true;
    }
    return false;
  });
  let raiseFrame = 0;
  const raise = () => {
    if (!host.isConnected || picking) return;
    const focused = root.activeElement;
    host.hidePopover?.();
    host.showPopover?.();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  };
  const fullscreenChanged = () => {
    expanded = false;
    panel.hidden = true;
    refresh();
    // Page overlays rejoin the top layer later in this event. Put the shared
    // controls above them after every overlay has moved, not on every scroll.
    cancelAnimationFrame(raiseFrame);
    raiseFrame = requestAnimationFrame(() => {
      raiseFrame = 0;
      raise();
    });
  };
  document.addEventListener("fullscreenchange", fullscreenChanged);
  document.addEventListener(MANGA_CARD_OPEN_EVENT, raise);
  window.addEventListener("pointerdown", outside, true);
  return {
    update(
      next: ReaderItem[],
      pages: number,
      active: boolean,
      pending: boolean,
    ) {
      items = next;
      pageCount = pages;
      session = active;
      canTranslate = pending;
      refresh();
    },
    refresh,
    reflectOriginal(value: boolean) {
      showingOriginal = value;
      original.setAttribute("aria-pressed", String(value));
    },
    setReading(value: MangaReadingUi) {
      readingState = value;
      refresh();
    },
    setPicking(value: boolean) {
      picking = value;
      visibility();
    },
    capture(active: boolean) {
      captures = Math.max(0, captures + (active ? 1 : -1));
      visibility();
    },
    raise,
    dispose() {
      clearTimeout(collapseTimer);
      stopControls();
      drag.dispose();
      document.removeEventListener("fullscreenchange", fullscreenChanged);
      document.removeEventListener(MANGA_CARD_OPEN_EVENT, raise);
      cancelAnimationFrame(raiseFrame);
      window.removeEventListener("pointerdown", outside, true);
      host.remove();
    },
  };
}
