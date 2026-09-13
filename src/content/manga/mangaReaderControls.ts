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
    reading: (enabled: boolean, prefetch: boolean, depth?: number) => void;
  },
) {
  const host = document.createElement("div"),
    root = host.attachShadow({ mode: "open" });
  host.className = "ast-manga-reader";
  host.setAttribute("popover", "manual");
  const style = document.createElement("style");
  style.textContent = `
:host{all:initial;position:fixed;inset:auto auto 16px 50%;transform:translateX(-50%);margin:0;padding:0;border:0;background:transparent;width:max-content;max-width:calc(100vw - 24px);overflow:visible;z-index:2147483645;font:13.5px "Segoe UI","Microsoft YaHei",sans-serif;color:#f3f1fb;--ast-manga-scale:1.2}
*{box-sizing:border-box}[hidden]{display:none!important}button{font:inherit;border:0;cursor:pointer;color:inherit;white-space:nowrap;transition:background .15s,transform .1s,box-shadow .15s}button:focus-visible{outline:2px solid #a78bfa;outline-offset:2px}button:disabled{opacity:.45;cursor:default}button:active:not(:disabled){transform:scale(.97)}
.dock,.panel,.toast,.trigger{zoom:var(--ast-manga-scale, 1)}
.grip{cursor:grab!important;touch-action:none;user-select:none;-webkit-user-select:none;flex:none;font-size:20px;line-height:1;padding:8px 8px!important;color:#c4b8e5;border-radius:10px}.grip:hover{color:#fff;background:#ffffff18}.grip:active,.grip.dragging{cursor:grabbing!important}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:5px}.dock.compact .actions{display:none}
.compact-button{min-width:54px;color:#f5f3ff;font-size:13px;font-weight:600;padding:7px 12px;border-radius:14px;transition:background .15s,color .15s;display:inline-flex;align-items:center;gap:6px;background:#ffffff14;touch-action:none;user-select:none;-webkit-user-select:none}
.compact-button:hover{background:#ffffff26;color:#fff}
.compact-button:active,.compact-button.dragging{cursor:grabbing!important}
.compact-button[data-mode=auto]{color:#86efac;background:rgba(34,197,94,0.16);border:1px solid rgba(34,197,94,0.35)}
.compact-button[data-mode=working]{color:#c4b5fd;background:rgba(139,92,246,0.2);border:1px solid rgba(139,92,246,0.38)}
.compact-button[data-mode=error]{color:#fca5a5;background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.38)}
.compact-button:focus-visible{outline:2px solid #a78bfa}
@keyframes ast-dock-pulse{0%,100%{box-shadow:0 4px 20px #7161dc55,0 0 0 1px #8c78ecaa}50%{box-shadow:0 6px 26px #9887f5aa,0 0 0 2px #b0a3f8ee}}
.dock.compact[data-status=working]{animation:ast-dock-pulse 2s ease-in-out infinite;border-color:#8c78ecaa}
.toast{position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);background:#181624f5;color:#f5f3ff;font-size:12.5px;padding:8px 16px;border-radius:22px;white-space:nowrap;pointer-events:none;border:1px solid #7c6fd688;box-shadow:0 6px 24px #00000066;backdrop-filter:blur(12px);transition:opacity .3s,transform .3s;opacity:1;z-index:2147483646}
.toast.fade-out{opacity:0;transform:translateX(-50%) translateY(6px)}
.reading-switch{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;min-height:42px;padding:7px 0;color:#302b3a;border-radius:6px;font-size:14px}.reading-switch:hover{background:#f3f0fa}.reading-switch:focus-visible{outline-color:#8978bd}.switch-track{display:block;width:34px;height:20px;flex:none;border-radius:12px;background:#d5cedf;padding:3px;transition:background .12s}.switch-track::after{content:"";display:block;width:14px;height:14px;border-radius:50%;background:white;box-shadow:0 1px 3px #0002;transition:transform .12s}.reading-switch[aria-checked=true] .switch-track{background:#7161ce}.reading-switch[aria-checked=true] .switch-track::after{transform:translateX(14px)}.reading-switch:disabled{opacity:.5;cursor:default}.reading-status{font-size:12px;line-height:1.5;color:#7b7189;margin-top:6px;min-height:18px}.reading-status.error{color:#a55c32}.reading-failure{font-size:12px;line-height:1.5;color:#8c6f67;white-space:normal;overflow-wrap:anywhere;margin:5px 0 8px}.reading-recover{display:block;text-align:left;color:#6f54a2!important;background:#f1edf8!important;font-size:12px;border:1px solid #e6e0f0!important;padding:6px 10px!important;border-radius:8px;margin:4px 0 8px}.reading-quota{font-size:11px;color:#9a91a6;line-height:1.5;margin:7px 0 0}
.reading-depth-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0 8px;border-bottom:1px dashed #e8e3f2;margin-bottom:6px}
.depth-label{font-size:12px;color:#635b75;font-weight:600}
.depth-buttons{display:flex;gap:4px}
.depth-btn{font-size:11.5px;padding:4px 8px;border-radius:6px;border:1px solid #ddd7ea;background:#fff;color:#5a4e76;transition:all .15s;cursor:pointer}
.depth-btn:hover{border-color:#8b5cf6;color:#7c3aed;background:#f8f6ff}
.depth-btn.active{background:#7161ce;color:#fff;border-color:#7161ce;font-weight:600}
.panel.reading{width:350px;background:rgba(20,18,33,0.96);color:#f3f1fb;border:1px solid rgba(255,255,255,0.16);border-radius:20px;box-shadow:0 16px 48px rgba(0,0,0,0.6),0 0 0 1px rgba(255,255,255,0.08);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);padding:14px 16px;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.2) transparent}
.panel.reading::-webkit-scrollbar{width:5px}
.panel.reading::-webkit-scrollbar-track{background:transparent}
.panel.reading::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.2);border-radius:10px}
.panel.reading::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.35)}
.panel.reading header{display:none}
.reading-dialog-container{display:flex;flex-direction:column;gap:10px}
.reading-dialog-header{display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.1)}
.reading-dialog-title{font-size:13.5px;font-weight:700;color:#ede9fe;letter-spacing:0.2px}
.reading-header-actions{display:flex;align-items:center;gap:6px}
.reading-scale-group{display:inline-flex;align-items:center;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:2px;gap:2px}
.reading-scale-group .scale-btn{font-size:11px;font-weight:600;padding:3px 6px;color:#c4b8e5;border-radius:8px;line-height:1}
.reading-scale-group .scale-btn:hover{background:rgba(255,255,255,0.15);color:#fff}
.reading-scale-group .scale-display{font-size:11px;font-weight:600;padding:3px 5px;color:#a78bfa;border-radius:6px;line-height:1;min-width:38px;text-align:center}
.reading-scale-group .scale-display:hover{background:rgba(255,255,255,0.12);color:#c4b5fd}
.reading-dialog-close{font-size:18px;line-height:1;padding:4px 7px;color:#9ca3af;border-radius:8px}
.reading-dialog-close:hover{color:#fff;background:rgba(239,68,68,0.2)}
.reading-card-section{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:10px 12px}
.panel.reading .reading-switch{color:#e2e8f0;padding:5px 0;min-height:36px;font-size:13px;font-weight:500}
.panel.reading .reading-switch:hover{background:rgba(255,255,255,0.05)}
.panel.reading .reading-depth-row{border-bottom:1px dashed rgba(255,255,255,0.1);padding:5px 0 7px}
.panel.reading .depth-label{color:#cbd5e1}
.panel.reading .depth-btn{background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.14);color:#cbd5e1}
.panel.reading .depth-btn:hover{background:rgba(139,92,246,0.25);color:#fff;border-color:#8b5cf6}
.panel.reading .depth-btn.active{background:#7c3aed;color:#fff;border-color:#8b5cf6}
.panel.reading .reading-status{color:#a5b4fc}
.panel.reading .reading-status.error{color:#fca5a5}
.panel.reading .reading-failure{color:#fca5a5}
.panel.reading .reading-quota{color:#94a3b8}
.reading-tools-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
.reading-tool-btn{font-size:12px;font-weight:500;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.07);color:#e2e8f0;border:1px solid rgba(255,255,255,0.1);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:all .15s}
.reading-tool-btn:hover{background:rgba(255,255,255,0.14);color:#fff;border-color:rgba(255,255,255,0.2)}
.reading-tool-btn.active{background:rgba(124,58,237,0.35);color:#c4b5fd;border-color:rgba(139,92,246,0.5)}
.reading-footer-row{display:flex;gap:6px}
.reading-footer-btn{flex:1;font-size:12px;font-weight:500;padding:7px 10px;border-radius:10px;background:rgba(255,255,255,0.06);color:#cbd5e1;border:1px solid rgba(255,255,255,0.1);text-align:center;transition:all .15s}
.reading-footer-btn:hover{background:rgba(255,255,255,0.12);color:#fff}
.scale-toggle{font-size:11.5px;font-weight:600;padding:7px 9px;color:#c4b8e5;border-radius:12px}
.scale-toggle:hover{background:rgba(255,255,255,0.16);color:#fff}

.dock{display:flex;flex-wrap:nowrap;align-items:center;gap:6px;padding:6px 10px;background:#141221f2;border:1px solid #ffffff28;border-radius:24px;box-shadow:0 8px 32px #0000004d,0 0 0 1px #ffffff12;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);max-width:calc(100vw - 24px);transition:all .2s ease}
.dock.vertical{flex-direction:column;align-items:stretch;padding:10px 7px;width:auto;min-width:52px;max-width:145px;border-radius:22px}
.dock.vertical .actions{flex-direction:column;align-items:stretch;gap:6px}
.dock.vertical .summary{text-align:center;max-width:none}
button{background:transparent;padding:7px 11px;border-radius:12px}button:hover{background:#ffffff1c}
.primary{background:linear-gradient(135deg,#7c3aed 0%,#6366f1 100%);color:#fff;font-weight:600;box-shadow:0 2px 10px rgba(124,58,237,0.35)}
.primary:hover{background:linear-gradient(135deg,#8b5cf6 0%,#818cf8 100%);box-shadow:0 4px 14px rgba(124,58,237,0.5)}
.original[aria-pressed=true]{background:#352c5df5;color:#ddd6fe;border:1px solid #7c6fd688}
.all-results{color:#ddd6fe}
.all-results[aria-expanded=true]{background:#ffffff24}
.reading-settings{color:#ddd6fe}
.reading-settings[aria-expanded=true]{background:#ffffff24}
.orientation-toggle{font-size:14px;padding:8px 9px;color:#c4b8e5}
.orientation-toggle:hover{color:#fff;background:#ffffff1c}
.summary{max-width:280px;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:12.5px;color:#d8d2ea;font-weight:500;padding:5px 8px;border-radius:10px;cursor:pointer;white-space:nowrap}
.summary:hover{background:rgba(255,255,255,0.08);color:#fff}
.summary.error{color:#fca5a5}
.clear{font-size:18px;line-height:1;padding:8px 10px;color:#c4b8e5}
.clear:hover{color:#fff;background:rgba(239,68,68,0.25)}
.collapse{font-size:12px;font-weight:600;padding:6px 12px;color:#d8d2ea;background:rgba(255,255,255,0.08);border-radius:14px;border:1px solid rgba(255,255,255,0.12);display:inline-flex;align-items:center;gap:4px;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
.trigger{background:linear-gradient(135deg,#7c3aed 0%,#6366f1 100%);color:#fff;border-radius:24px;padding:9px 18px;box-shadow:0 6px 22px rgba(124,58,237,0.4),0 0 0 1px rgba(255,255,255,0.2);font-weight:600;font-size:13px;display:inline-flex;align-items:center;gap:6px;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);transition:transform 0.15s,box-shadow 0.15s}
.trigger:hover{background:linear-gradient(135deg,#8b5cf6 0%,#818cf8 100%);transform:scale(1.05);box-shadow:0 8px 28px rgba(124,58,237,0.55)}
.trigger:active{cursor:grabbing}
.trigger.dragging{cursor:grabbing!important;transform:scale(1.03)!important;box-shadow:0 10px 30px rgba(124,58,237,0.6)!important;transition:none!important}
.panel{position:absolute;right:0;bottom:58px;width:340px;max-width:calc(100vw - 24px);max-height:min(65vh,480px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(120,110,150,0.3) transparent;color:#292533;background:#faf9ff;border:1px solid #e5e1f1;border-radius:18px;box-shadow:0 12px 38px #17132938;padding:14px;box-sizing:border-box}
.panel::-webkit-scrollbar{width:5px}
.panel::-webkit-scrollbar-track{background:transparent}
.panel::-webkit-scrollbar-thumb{background:rgba(120,110,150,0.3);border-radius:10px}
.panel::-webkit-scrollbar-thumb:hover{background:rgba(120,110,150,0.5)}
.translation-result{border:1px solid #e6e1ee;border-radius:10px;padding:10px;margin:8px 0;background:white}.result-heading{display:flex;gap:6px;align-items:center;margin-bottom:5px}.result-badge{font-size:11px;line-height:1.5;color:#6751a3;background:#f2eefc;border-radius:5px;padding:2px 5px}.translation-result[data-translation-state=uncertain] .result-badge{color:#825915;background:#fff4df}.translation-result[data-translation-state=untranslated] .result-badge{color:#72657b;background:#efecf2}.row .result-reason{font-size:11px;color:#84748f;margin-bottom:8px}.result-translation{font-size:14px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.row .result-source{font-size:12px;color:#8c8293;border-top:1px solid #f0edf4;margin-top:9px;padding-top:7px}.row .result-counts{font-size:11px;color:#84788f}.panel.translations{width:390px}.panel.translations header{margin-bottom:8px}
.panel header{font-size:13px;font-weight:600;margin-bottom:8px}.row{border-top:1px solid #e9e6f2;padding:10px 0}.row:first-child{border-top:0}.row p{font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 5px;color:#736b82}.row.error p{color:#8d5315}.row button{color:#66519a;background:#f0edf8;font-size:12px;padding:5px 8px;margin-right:4px}.hint{font-size:11px;color:#9690a3;line-height:1.5;margin:8px 0 0}
@media(max-width:620px){.summary{max-width:140px}.dock{gap:3px;padding:4px 6px}button{padding:6px 8px}}
`;
  const dock = document.createElement("div");
  dock.className = "dock";
  dock.setAttribute("role", "toolbar");
  dock.setAttribute("aria-label", t(language(), "manga.title"));
  const actionGroup = document.createElement("div");
  actionGroup.className = "actions";
  const compact = document.createElement("button"),
    collapse = document.createElement("button"),
    reading = document.createElement("button"),
    scaleToggle = document.createElement("button"),
    orientationToggle = document.createElement("button");
  compact.className = "compact-button";
  collapse.className = "collapse";
  reading.className = "reading-settings";
  scaleToggle.className = "scale-toggle";
  orientationToggle.className = "orientation-toggle";
  for (const button of [
    compact,
    collapse,
    reading,
    scaleToggle,
    orientationToggle,
  ])
    button.type = "button";
  collapse.textContent = "−";
  orientationToggle.textContent = "⇋";
  scaleToggle.textContent = "100%";
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

  const BASE_SCALE_FACTOR = 1.2;
  let userScale = 1.0;
  let visualScale = 1.2;
  const SCALE_KEY = "astra_manga_scale";
  let drag: ReturnType<typeof makeMangaDockDraggable>;
  const applyScale = (scale: number, persist = true) => {
    const clamped = Math.max(0.7, Math.min(1.5, Math.round(scale * 100) / 100));
    userScale = clamped;
    visualScale = Math.round(clamped * BASE_SCALE_FACTOR * 100) / 100;
    host.style.setProperty("--ast-manga-scale", String(visualScale));
    scaleToggle.textContent = Math.round(clamped * 100) + "%";
    readingPanel.reflectScale(clamped);
    if (persist) {
      void chrome.storage.local.set({ [SCALE_KEY]: clamped }).catch(() => {});
    }
    drag?.layout();
    layoutPanel();
  };
  scaleToggle.onclick = () => {
    const nextScales = [1.0, 1.15, 1.3, 0.85];
    const currentIndex = nextScales.findIndex((s) => Math.abs(s - userScale) < 0.05);
    const next = nextScales[(currentIndex + 1) % nextScales.length];
    applyScale(next);
  };
  void chrome.storage.local
    .get(SCALE_KEY)
    .then((saved) => {
      const s = Number(saved[SCALE_KEY]);
      if (Number.isFinite(s) && s >= 0.7 && s <= 1.5) {
        applyScale(Math.abs(s - 1.2) < 0.01 ? 1.0 : s, false);
      } else {
        applyScale(1.0, false);
      }
    })
    .catch(() => {
      applyScale(1.0, false);
    });

  let isVertical = false;
  const toggleDockOrientation = () => {
    isVertical = !isVertical;
    dock.classList.toggle("vertical", isVertical);
    orientationToggle.textContent = isVertical ? "⇅" : "⇋";
    orientationToggle.setAttribute(
      "aria-label",
      t(language(), "manga.dockOrientationToggle"),
    );
    orientationToggle.title = t(language(), "manga.dockOrientationToggle");
    void chrome.storage.local
      .set({
        astra_manga_dock_orientation: isVertical ? "vertical" : "horizontal",
      })
      .catch(() => {});
    drag?.layout();
    layoutPanel();
  };
  orientationToggle.onclick = toggleDockOrientation;

  const readingPanel = createMangaReadingPanel({
    change: (enabled, prefetch) => actions.reading(enabled, prefetch),
    recover: () => {
      actions.translate();
      if (!readingState.enabled) actions.reading(true, false);
    },
    onPrefetchDepthChange: (depth) => {
      actions.reading(readingState.enabled, true, depth);
      layoutPanel();
    },
    getScale: () => userScale,
    setScale: (s) => {
      applyScale(s);
    },
    toggleOriginal: () => {
      showingOriginal = !showingOriginal;
      actions.original(showingOriginal);
      original.setAttribute("aria-pressed", String(showingOriginal));
      readingPanel.reflectOriginal(showingOriginal);
    },
    isOriginal: () => showingOriginal,
    pick: () => {
      actions.pick();
    },
    retranslate: () => {
      actions.translate();
    },
    showTranslations: () => {
      panelMode = "translations";
      refresh();
    },
    toggleOrientation: () => {
      toggleDockOrientation();
    },
    isVertical: () => isVertical,
    collapseToCapsule: () => {
      collapseDock();
    },
    close: () => {
      panel.hidden = true;
      syncExpanded();
    },
  });
  actionGroup.append(
    translate,
    original,
    summary,
    reading,
    collapse,
    clear,
  );
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.hidden = true;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const showToast = (text: string) => {
    clearTimeout(toastTimer);
    toast.textContent = text;
    toast.classList.remove("fade-out");
    toast.hidden = false;
    toastTimer = setTimeout(() => {
      toast.classList.add("fade-out");
      setTimeout(() => {
        toast.hidden = true;
      }, 350);
    }, 3800);
  };
  dock.append(grip, compact, actionGroup);
  root.append(style, toast, trigger, dock, panel);
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
  trigger.onclick = actions.translate;
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
    readingPanel.reflectOriginal(showingOriginal);
  };
  let autoCollapseTimer: ReturnType<typeof setTimeout> | undefined;
  let isHovered = false;

  const scheduleAutoCollapse = (delayMs = 3500) => {
    clearTimeout(autoCollapseTimer);
    if (!readingState.enabled || !expanded || !panel.hidden || isHovered || showingOriginal) return;
    const hasError = items.some((item) => item.phase === "error");
    if (hasError) return;
    const isWorking = items.some((item) => item.phase === "working");
    if (isWorking) return;

    autoCollapseTimer = setTimeout(() => {
      if (
        panel.hidden &&
        readingState.enabled &&
        !isHovered &&
        !showingOriginal &&
        !root.activeElement?.matches(":focus-visible")
      ) {
        collapseDock();
      }
    }, delayMs);
  };

  const collapseDock = () => {
    clearTimeout(autoCollapseTimer);
    clearTimeout(collapseTimer);
    expanded = false;
    panel.hidden = true;
    refresh();
  };
  compact.onclick = () => {
    expanded = true;
    refresh();
    if (readingState.enabled) {
      scheduleAutoCollapse(4000);
    }
  };
  collapse.onclick = collapseDock;
  void chrome.storage.local
    .get("astra_manga_dock_orientation")
    .then((saved) => {
      if (saved.astra_manga_dock_orientation === "vertical") {
        isVertical = true;
        dock.classList.add("vertical");
        orientationToggle.textContent = "⇅";
        drag?.layout();
        layoutPanel();
      }
    })
    .catch(() => {});
  dock.addEventListener("pointerenter", () => {
    isHovered = true;
    clearTimeout(autoCollapseTimer);
    clearTimeout(collapseTimer);
  });
  dock.addEventListener("pointerleave", () => {
    isHovered = false;
    clearTimeout(collapseTimer);
    if (readingState.enabled) {
      scheduleAutoCollapse(3000);
    } else {
      collapseTimer = setTimeout(() => {
        if (panel.hidden && !root.activeElement?.matches(":focus-visible"))
          collapseDock();
      }, 6000);
    }
  });
  const onUserScroll = () => {
    if (expanded && readingState.enabled && panel.hidden && !isHovered) {
      scheduleAutoCollapse(1200);
    }
  };
  window.addEventListener("scroll", onUserScroll, { passive: true });
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
    const isReading = panelMode === "reading";
    const targetWidth =
      panelMode === "translations"
        ? 390
        : isReading
          ? 350
          : 340;
    panel.style.width = Math.min(targetWidth, innerWidth - 24) + "px";
    panel.style.maxHeight = "none";
    const naturalHeight = panel.scrollHeight;
    const naturalWidth = panel.offsetWidth;
    const maxScreenHeight = Math.min(
      innerHeight * 0.85,
      isReading ? 640 : 520,
    );
    const box = panelAtDock(
      bounds,
      {
        width: Math.min(naturalWidth * visualScale, innerWidth - 24),
        height: Math.min(naturalHeight * visualScale + 12, maxScreenHeight),
      },
      { width: innerWidth, height: innerHeight },
    );
    Object.assign(panel.style, {
      left: ((box.x - bounds.x) / visualScale) + "px",
      top: ((box.y - bounds.y) / visualScale) + "px",
      bottom: "auto",
      right: "auto",
      maxHeight: (box.height / visualScale + 4) + "px",
    });
  };
  drag = makeMangaDockDraggable(host, grip, layoutPanel, [trigger, compact]);
  const mount = () => {
    if (!session && !pageCount && !document.fullscreenElement) {
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
  const stateText = () => {
    const lang = language();
    const working = items.filter((item) => item.phase === "working").length;
    const ready = items.filter((item) => item.phase === "ready").length;
    const errors = items.filter((item) => item.phase === "error").length;
    if (errors > 0) return t(lang, "manga.statusError");
    if (working > 0)
      return t(lang, "manga.statusTranslating", {
        progress: (ready + 1) + "/" + (items.length || 1),
      });
    if (readingState.enabled) {
      if (readingState.prefetch && (readingState.aheadCount ?? 0) > 0) {
        const readyAhead = readingState.readyCount ?? 0;
        const totalAhead = readingState.aheadCount!;
        return `⚡ 自动 · ${readyAhead}/${totalAhead}P`;
      }
      return t(lang, "manga.autoCompact");
    }
    return "译 " + (items.length ? ready + "/" + items.length : "");
  };
  const refresh = () => {
    const lang = language(),
      ready = items.filter((item) => item.phase === "ready").length,
      working = items.some((item) => item.phase === "working"),
      errors = items.filter((item) => item.phase === "error");
    const counts = summarizeTranslations(
      items.flatMap((item) => item.translations),
    );
    dock.dataset.status = working ? "working" : errors.length ? "error" : "idle";
    grip.setAttribute("aria-label", t(lang, "manga.dragToolbar"));
    grip.title = t(lang, "manga.dragToolbarHint");
    trigger.textContent = "📖 " + t(lang, "manga.title");
    trigger.setAttribute(
      "aria-label",
      t(lang, "manga.translateVisible") + " · " + t(lang, "manga.dragToolbar"),
    );
    trigger.title =
      t(lang, "manga.translateVisible") + " · " + t(lang, "manga.dragToolbar");
    dock.classList.toggle("compact", !expanded);
    compact.hidden = expanded;
    compact.textContent = stateText();
    compact.dataset.mode = errors.length
      ? "error"
      : working
        ? "working"
        : readingState.enabled
          ? "auto"
          : "manual";
    compact.setAttribute("aria-label", t(lang, "manga.expandControls"));
    compact.title =
      t(lang, "manga.pillTooltip") + " · " + t(lang, "manga.dragToolbar");
    collapse.textContent = t(lang, "manga.collapseShort");
    collapse.setAttribute("aria-label", t(lang, "manga.collapseControls"));
    collapse.title = t(lang, "manga.collapseControls");
    orientationToggle.setAttribute("aria-label", t(lang, "manga.dockOrientationToggle"));
    orientationToggle.title = t(lang, "manga.dockOrientationToggle");
    reading.textContent = t(
      lang,
      readingState.enabled
        ? "manga.readingSettingsBtnActive"
        : "manga.readingSettingsBtn",
    );
    reading.title = t(lang, "manga.readingSettingsTitle");
    scaleToggle.title = t(lang, "manga.uiScale");
    scaleToggle.setAttribute("aria-label", t(lang, "manga.uiScale"));
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
    let summaryText = errors.length
      ? t(lang, "manga.readerErrors", { count: errors.length })
      : items.length
        ? t(lang, "manga.readerProgress", { ready, total: items.length })
        : t(lang, "manga.currentPageIdle");
    if (!errors.length && readingState.enabled && readingState.prefetch) {
      if ((readingState.aheadCount ?? 0) > 0) {
        const ahead = readingState.aheadCount!;
        const readyAhead = readingState.readyCount ?? 0;
        if (readyAhead >= ahead) {
          summaryText += t(lang, "manga.dockPrefetchReady", { ready: ahead });
        } else {
          summaryText += t(lang, "manga.dockPrefetchWorking", {
            ready: readyAhead,
            total: ahead,
          });
        }
      } else if (readingState.prefetchedCount) {
        summaryText += t(lang, "manga.dockPrefetchReady", {
          ready: readingState.prefetchedCount,
        });
      }
    }
    summary.textContent = summaryText;
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
    heading.hidden = panelMode === "reading";
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
    if (readingState.enabled && expanded && panel.hidden) {
      scheduleAutoCollapse(3500);
    }
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
      const wasActive = session;
      items = next;
      pageCount = pages;
      session = active;
      canTranslate = pending;
      if (!wasActive && active) {
        if (!readingState.enabled) {
          expanded = true;
        }
        showToast(t(language(), "manga.toastReady"));
      }
      refresh();
    },
    refresh,
    reflectOriginal(value: boolean) {
      showingOriginal = value;
      original.setAttribute("aria-pressed", String(value));
      readingPanel.reflectOriginal(value);
    },
    setReading(value: MangaReadingUi) {
      const wasEnabled = readingState.enabled;
      readingState = value;
      if (!wasEnabled && value.enabled) {
        scheduleAutoCollapse(2500);
      }
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
      clearTimeout(autoCollapseTimer);
      clearTimeout(toastTimer);
      window.removeEventListener("scroll", onUserScroll);
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
