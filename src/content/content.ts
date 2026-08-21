// ============================================================
// Astra Translate – Content Script Entry
// ============================================================

// Note: CSS is loaded via manifest content_scripts.css, not imported here
// because IIFE builds don't support CSS imports at runtime.
import {
  showSelectionBtn,
  translateCurrentSelection,
  showTranslationBubble,
  showDraggablePopup,
  isDragPopupOpen,
  isSelectionBtnHovered,
  isTranslatable,
  initBubbleClose,
  prefetchLang,
  setPopupScale,
} from "./selectionBubble";
import { PageTranslator } from "./pageTranslator";
import { openChatPanel } from "./chatPanel";
import { ensureFloatingBallMounted, initFloatingBall, updateFloatingBall } from "./floatingBall";
import { LiveSubtitleHud } from "./liveSubtitleHud";
import type { UiLanguage } from "../shared/i18n";

let liveHud: LiveSubtitleHud | null = null;

function getOrCreateLiveHud(): LiveSubtitleHud {
  if (!liveHud) {
    liveHud = new LiveSubtitleHud();
  }
  return liveHud;
}

let pageTranslator: PageTranslator | null = null;
let pageTranslatorPageKey = currentPageKey();
let monitorTimer: number | null = null;

function isExtensionContextAlive(): boolean {
  try {
    return Boolean(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function currentPageKey(): string {
  return `${window.location.origin}${window.location.pathname}${window.location.search}`;
}

function monitorPageState(): void {
  if (!isExtensionContextAlive()) {
    if (monitorTimer !== null) {
      clearInterval(monitorTimer);
      monitorTimer = null;
    }
    return;
  }

  ensureFloatingBallMounted();

  const pageKey = currentPageKey();
  if (pageKey === pageTranslatorPageKey) return;

  pageTranslatorPageKey = pageKey;
  if (pageTranslator) {
    pageTranslator.abort();
    pageTranslator = null;
  }
}

// ---- Selection handling ----

let lastSelectionText = "";
let lastMouseX = 0;
let lastMouseY = 0;
let justShowedBtn = false;

document.addEventListener("mouseup", (e) => {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).className?.includes?.("ast-")) return;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;

  setTimeout(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();

    if (text && text.length >= 1 && isTranslatable(text) && text !== lastSelectionText) {
      // Skip if inside input/textarea/password/contenteditable
      const anchor = sel?.anchorNode;
      if (anchor) {
        const el = anchor instanceof HTMLElement ? anchor : anchor.parentElement;
        if (el) {
          const tag = el.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
          if (el.isContentEditable) return;
          if ((el as HTMLInputElement).type === "password") return;
        }
      }
      lastSelectionText = text;
      justShowedBtn = true;
      showSelectionBtn(sel!.getRangeAt(0));
    } else if (!text) {
      lastSelectionText = "";
    }
  }, 80);
});

// Also listen to selectionchange for keyboard selection
document.addEventListener("selectionchange", () => {
  setTimeout(() => {
    // Don't remove the button immediately after it was just shown —
    // the browser may fire selectionchange during the mouseup sequence.
    if (justShowedBtn) {
      justShowedBtn = false;
      return;
    }
    // Don't remove while the user is hovering over the button —
    // some sites clear the selection on mouse events, which would
    // make the button vanish right as the user tries to click it.
    if (isSelectionBtnHovered()) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || !isTranslatable(text)) {
      const btn = document.querySelector(".ast-selection-btn");
      if (btn) btn.remove();
      lastSelectionText = "";
    }
  }, 200);
});

// ---- Alt+T shortcut ----

document.addEventListener("keydown", (e) => {
  if (e.altKey && e.key === "t") {
    e.preventDefault();
    translateCurrentSelection();
  }
});

// ---- Message handling ----

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case "TRANSLATE_SELECTION": {
      if (msg.payload?.text) {
        showTranslationBubble(msg.payload.text);
      } else {
        translateCurrentSelection();
      }
      sendResponse({ success: true });
      break;
    }

    case "CONTEXT_TRANSLATE_SELECTION": {
      const text = msg.text || msg.payload?.text;
      if (text) {
        // Use stored mouse position directly — the selection may have been
        // cleared by the browser between the right-click and the context
        // menu click, so we can't rely on window.getSelection().
        const x = lastMouseX || window.innerWidth / 2;
        const y = lastMouseY || window.innerHeight / 3;
        showDraggablePopup(text, x, y);
      }
      sendResponse({ success: true });
      break;
    }

    case "PAGE_TRANSLATE_START": {
      startPageTranslation();
      sendResponse({ success: true });
      break;
    }

    case "PAGE_TRANSLATE_RESTORE": {
      pageTranslator?.restore();
      pageTranslator = null;
      sendResponse({ success: true });
      break;
    }

    case "PAGE_TRANSLATE_STATUS": {
      sendResponse({
        active: pageTranslator !== null,
      });
      break;
    }

    case "OPEN_CHAT_PANEL": {
      // The popup handed chat off to this page — no more toolbar round trip.
      void openChatPanel(msg.payload?.text);
      sendResponse({ success: true });
      break;
    }

    case "LIVE_SUBTITLE_START_HUD": {
      const hud = getOrCreateLiveHud();
      hud.show(msg.payload);
      sendResponse({ success: true });
      break;
    }

    case "LIVE_SUBTITLE_STOP_HUD": {
      if (liveHud) {
        liveHud.hide();
      }
      sendResponse({ success: true });
      break;
    }

    case "LIVE_SUBTITLE_DATA": {
      const hud = getOrCreateLiveHud();
      hud.updateSubtitle(
        msg.payload?.text,
        msg.payload?.original,
        msg.payload?.fullTranslation,
        msg.payload?.fullOriginal,
        msg.payload?.isFinal
      );
      sendResponse({ success: true });
      break;
    }

    case "LIVE_TRANSLATE_STATUS": {
      const hud = getOrCreateLiveHud();
      hud.updateStatus(
        msg.payload?.status,
        msg.payload?.message,
        msg.payload?.level
      );
      sendResponse({ success: true });
      break;
    }
  }

  return true;
});

async function startPageTranslation(): Promise<void> {
  const startPageKey = currentPageKey();

  if (pageTranslator) {
    pageTranslator.restore();
    pageTranslator = null;
  }

  let targetLang = "Simplified Chinese";
  let batchSize = 6000;
  let concurrency = 4;
  let enableRealtime = true;
  let translateWholePage = false;
  let translatePageChrome = false;
  let translateUiControls = false;
  let enableStreaming = true;
  let enableSiteLexicon = true;
  let lang: UiLanguage = "zh-CN";

  try {
    const settings = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (settings) {
      targetLang = settings.pageTargetLang || settings.defaultTargetLang || targetLang;
      batchSize = settings.batchSize || batchSize;
      concurrency = settings.concurrency || concurrency;
      enableRealtime = settings.enableRealtimePageTranslate ?? enableRealtime;
      translateWholePage = settings.translateWholePage ?? translateWholePage;
      translatePageChrome = settings.translatePageChrome ?? translatePageChrome;
      translateUiControls = settings.translateUiControls ?? translateUiControls;
      enableStreaming = settings.enableStreamingPageTranslate ?? enableStreaming;
      enableSiteLexicon = settings.enableSiteLexicon ?? enableSiteLexicon;
      lang = settings.uiLanguage || lang;
    }
  } catch {
    // Use defaults
  }

  if (startPageKey !== currentPageKey()) return;

  pageTranslatorPageKey = startPageKey;
  pageTranslator = new PageTranslator({
    targetLang,
    batchSize,
    concurrency,
    enableRealtime,
    translateWholePage,
    translatePageChrome,
    translateUiControls,
    enableStreaming,
    enableSiteLexicon,
    lang,
    onStatus: (status) => {
      chrome.runtime.sendMessage({
        type: "PAGE_TRANSLATE_STATUS",
        payload: status,
      }).catch(() => {});
    },
  });

  await pageTranslator.start();
}

// ---- Initialize ----

prefetchLang();
initBubbleClose();
monitorTimer = window.setInterval(monitorPageState, 500);

// Initialize floating ball
if (isExtensionContextAlive()) {
  chrome.runtime
    .sendMessage({ type: "GET_SETTINGS" })
    .then((settings) => {
      if (settings && isExtensionContextAlive()) {
        initFloatingBall({
          enabled: settings.enableFloatingBall ?? true,
          opacity: settings.floatingBallOpacity ?? 0.8,
          size: settings.floatingBallSize ?? 48,
          lang: settings.uiLanguage || "zh-CN",
          onTranslatePage: () => startPageTranslation(),
        });
        setPopupScale(settings.popupScale ?? 1.0);
      }
    })
    .catch(() => {});
}

