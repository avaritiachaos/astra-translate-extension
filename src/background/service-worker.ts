// ============================================================
// Astra Translate – Background Service Worker
// ============================================================

import { handleMessage } from "./messageRouter";

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

// Listen for messages from popup, options, and content scripts
chrome.runtime.onMessage.addListener(
  (msg, sender, sendResponse) => {
    handleMessage(msg, sender)
      .then((result) => sendResponse(result))
      .catch((err) => {
        console.error("[Astra] Message handler error:", err);
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return true;
  }
);

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
