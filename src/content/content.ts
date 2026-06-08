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
  initBubbleClose,
  prefetchLang,
  setPopupScale,
} from "./selectionBubble";
import { PageTranslator } from "./pageTranslator";
import { initFloatingBall, updateFloatingBall } from "./floatingBall";
import type { UiLanguage } from "../shared/i18n";

let pageTranslator: PageTranslator | null = null;

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

    if (text && text.length > 1 && text !== lastSelectionText) {
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
    if (!text || text.length <= 1) {
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
  }
  return true;
});

async function startPageTranslation(): Promise<void> {
  if (pageTranslator) {
    pageTranslator.restore();
    pageTranslator = null;
  }

  let targetLang = "Simplified Chinese";
  let batchSize = 4000;
  let concurrency = 2;
  let enableRealtime = true;
  let lang: UiLanguage = "zh-CN";

  try {
    const settings = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (settings) {
      targetLang = settings.pageTargetLang || settings.defaultTargetLang || targetLang;
      batchSize = settings.batchSize || batchSize;
      concurrency = settings.concurrency || concurrency;
      enableRealtime = settings.enableRealtimePageTranslate ?? enableRealtime;
      lang = settings.uiLanguage || lang;
    }
  } catch {
    // Use defaults
  }

  pageTranslator = new PageTranslator({
    targetLang,
    batchSize,
    concurrency,
    enableRealtime,
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

// Initialize floating ball
chrome.runtime.sendMessage({ type: "GET_SETTINGS" }).then((settings) => {
  if (settings) {
    initFloatingBall({
      enabled: settings.enableFloatingBall ?? true,
      opacity: settings.floatingBallOpacity ?? 0.8,
      size: settings.floatingBallSize ?? 48,
      lang: settings.uiLanguage || "zh-CN",
      onTranslatePage: () => startPageTranslation(),
    });
    setPopupScale(settings.popupScale ?? 1.0);
  }
});
