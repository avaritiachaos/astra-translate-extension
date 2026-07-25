// ============================================================
// Astra Translate – Background Service Worker
// ============================================================

import { handleMessage, handleTranslateBatchStream } from "./messageRouter";
import {
  TRANSLATE_BATCH_STREAM_PORT,
  type TranslateBatchStreamRequest,
} from "../shared/types";

/** Check if a tab URL is accessible for scripting (not chrome://, edge://, about:, etc.). */
function isInjectableUrl(url?: string): boolean {
  if (!url) return false;
  return /^(https?|file):\/\//i.test(url);
}

/**
 * Try to send a message to a tab's content script. If it fails, inject
 * the content script and retry — but only on pages where scripting is
 * allowed (http/https/file). Silently skip inaccessible pages.
 */
async function ensureContentScriptAndSend(
  tabId: number,
  message: object,
  tabUrl?: string,
): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Content script not present — try injecting
    if (!isInjectableUrl(tabUrl)) return; // chrome://, about:, etc. — skip silently
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      await new Promise((r) => setTimeout(r, 200));
      await chrome.tabs.sendMessage(tabId, message);
    } catch {
      // Inject failed (e.g. file:// without file access) — silently skip
    }
  }
}

// ---- MV3 idle keepalive -------------------------------------------------
// Chrome tears the service worker down after ~30s without extension activity.
// A slow provider request (long prefill, backoff sleeps) has no chrome.* calls
// of its own, so we tick a trivial extension API while work is in flight —
// each call resets the idle timer.
let keepaliveUsers = 0;
let keepaliveTimer: ReturnType<typeof setInterval> | undefined;

function acquireKeepalive(): void {
  keepaliveUsers += 1;
  if (!keepaliveTimer) {
    keepaliveTimer = setInterval(() => {
      void chrome.runtime.getPlatformInfo();
    }, 20_000);
  }
}

function releaseKeepalive(): void {
  keepaliveUsers = Math.max(0, keepaliveUsers - 1);
  if (keepaliveUsers === 0 && keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = undefined;
  }
}

// Listen for messages from popup, options, and content scripts
chrome.runtime.onMessage.addListener(
  (msg, sender, sendResponse) => {
    acquireKeepalive();
    handleMessage(msg, sender)
      .then((result) => sendResponse(result))
      .catch((err) => {
        console.error("[Astra] Message handler error:", err);
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(releaseKeepalive);
    return true;
  }
);

// Streaming page-batch translation over a long-lived port.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== TRANSLATE_BATCH_STREAM_PORT) return;

  const abort = new AbortController();
  port.onDisconnect.addListener(() => abort.abort());

  port.onMessage.addListener((msg: TranslateBatchStreamRequest) => {
    if (msg?.type !== "TRANSLATE_BATCH_STREAM") return;
    acquireKeepalive();
    handleTranslateBatchStream(
      msg,
      (event) => {
        try {
          port.postMessage(event);
        } catch {
          // Port closed mid-stream.
        }
      },
      abort.signal
    )
      .catch((err) => {
        try {
          port.postMessage({
            type: "done",
            success: false,
            error: err instanceof Error ? err.message : String(err),
            errorCode: "UNKNOWN",
            items: [],
            requestId:
              typeof msg?.payload?.requestId === "string"
                ? msg.payload.requestId
                : undefined,
          });
        } catch {
          // ignore
        }
      })
      .finally(releaseKeepalive);
  });
});

// Context menu for selection translation
// Remove all first to avoid "duplicate id" errors when the service worker
// restarts and tries to re-create the same menu item.
chrome.contextMenus.removeAll(() => {
  chrome.contextMenus.create({
    id: "ast-translate-selection",
    title: "Translate selection with Astra",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "ast-translate-selection" || !info.selectionText || !tab?.id) {
    return;
  }
  ensureContentScriptAndSend(
    tab.id,
    { type: "CONTEXT_TRANSLATE_SELECTION", text: info.selectionText },
    tab.url,
  );
});

// Keyboard shortcut command
chrome.commands?.onCommand?.addListener((command, tab) => {
  if (command === "translate-selection" && tab?.id) {
    ensureContentScriptAndSend(
      tab.id,
      { type: "TRANSLATE_SELECTION" },
      tab.url,
    );
  }
});
