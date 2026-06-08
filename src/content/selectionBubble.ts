// ============================================================
// Astra Translate – Selection Bubble (Content Script)
// ============================================================

import { escapeHtml } from "../shared/utils";
import { t, type UiLanguage } from "../shared/i18n";

// Constants
const BUBBLE_PREFIX = "ast";
const MAX_SOURCE_DISPLAY = 300;

// State
let selectionBtn: HTMLButtonElement | null = null;
let selectionBtnHovered = false;
let savedSelectionText = "";
let bubble: HTMLElement | null = null;
let isPinned = false;
let isTranslating = false;
let cachedLang: UiLanguage = "zh-CN";

/** Fetch uiLanguage from settings (cached). */
async function getLang(): Promise<UiLanguage> {
  try {
    const s = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (s?.uiLanguage) cachedLang = s.uiLanguage;
  } catch {
    // fallback
  }
  return cachedLang;
}

// SVG icons (inline)
const TRANSLATE_ICON_IMG = `<img src="${chrome.runtime.getURL("icons/icon48.png")}" width="18" height="18" />`;
const COPY_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
const PIN_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 11V4a1 1 0 011-1h4a1 1 0 011 1v7"/><path d="M6 11h12l-1.5 6h-9z"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

export function injectThemeVars(): void {
  if (document.getElementById(`${BUBBLE_PREFIX}-theme-vars`)) return;
  const style = document.createElement("style");
  style.id = `${BUBBLE_PREFIX}-theme-vars`;
  style.textContent = `
    .${BUBBLE_PREFIX}-selection-btn {
      position: absolute;
      z-index: 2147483647;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      background: transparent;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1;
      pointer-events: auto;
      opacity: 1;
      animation: ${BUBBLE_PREFIX}-btn-in 250ms ease-out;
    }
    .${BUBBLE_PREFIX}-selection-btn:hover {
      animation: ${BUBBLE_PREFIX}-btn-float 1.2s ease-in-out infinite;
    }
    .${BUBBLE_PREFIX}-selection-btn img {
      width: 18px;
      height: 18px;
      display: block;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.25));
      transition: filter 200ms ease-out;
    }
    .${BUBBLE_PREFIX}-selection-btn:hover img {
      filter: drop-shadow(0 2px 4px rgba(99, 102, 241, 0.5));
    }
    @keyframes ${BUBBLE_PREFIX}-btn-in {
      from { opacity: 0; transform: scale(0.6); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes ${BUBBLE_PREFIX}-btn-float {
      0%, 100% { transform: translateY(-2px); }
      50% { transform: translateY(-5px); }
    }
    .${BUBBLE_PREFIX}-bubble {
      position: absolute;
      z-index: 2147483646;
      max-width: 420px;
      min-width: 260px;
      background: #ffffff;
      color: #1a1a2e;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.14);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.6;
      overflow: hidden;
      animation: ${BUBBLE_PREFIX}-bubble-in 120ms ease-out;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-bubble {
        background: #1a1a2e;
        color: #e5e7eb;
        border-color: #2d2d44;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      }
    }
    @keyframes ${BUBBLE_PREFIX}-bubble-in {
      from { opacity: 0; transform: translateY(4px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .${BUBBLE_PREFIX}-bubble-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid #e5e7eb;
      background: #eef2ff;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-bubble-header {
        border-bottom-color: #2d2d44;
        background: #1e1b4b;
      }
    }
    .${BUBBLE_PREFIX}-title {
      font-size: 12px;
      font-weight: 600;
      color: #6366f1;
      letter-spacing: 0.02em;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-title { color: #818cf8; }
    }
    .${BUBBLE_PREFIX}-bubble-actions {
      display: flex;
      gap: 4px;
    }
    .${BUBBLE_PREFIX}-btn {
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      cursor: pointer;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #6b7280;
      font-size: 13px;
      transition: background 120ms ease-out, color 120ms ease-out;
    }
    .${BUBBLE_PREFIX}-btn:hover {
      background: #e5e7eb;
      color: #1a1a2e;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-btn { color: #9ca3af; }
      .${BUBBLE_PREFIX}-btn:hover { background: #2d2d44; color: #e5e7eb; }
    }
    .${BUBBLE_PREFIX}-source-section {
      padding: 8px 14px;
      border-bottom: 1px solid #e5e7eb;
      background: #f7f7fa;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-source-section {
        border-bottom-color: #2d2d44;
        background: #0f0f1a;
      }
    }
    .${BUBBLE_PREFIX}-source-toggle {
      font-size: 11px;
      color: #6b7280;
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .${BUBBLE_PREFIX}-source-toggle::before {
      content: "▸";
      transition: transform 120ms ease-out;
      display: inline-block;
    }
    .${BUBBLE_PREFIX}-source-toggle.${BUBBLE_PREFIX}-expanded::before {
      transform: rotate(90deg);
    }
    .${BUBBLE_PREFIX}-source-text {
      margin-top: 6px;
      font-size: 13px;
      color: #6b7280;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 120px;
      overflow-y: auto;
      display: none;
    }
    .${BUBBLE_PREFIX}-source-text.${BUBBLE_PREFIX}-visible {
      display: block;
    }
    .${BUBBLE_PREFIX}-translation {
      padding: 12px 14px;
      white-space: pre-wrap;
      word-break: break-word;
      user-select: text;
      cursor: text;
    }
    .${BUBBLE_PREFIX}-loading {
      padding: 16px 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #6b7280;
      font-size: 13px;
    }
    .${BUBBLE_PREFIX}-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid #e5e7eb;
      border-top-color: #6366f1;
      border-radius: 50%;
      animation: ${BUBBLE_PREFIX}-spin 600ms linear infinite;
      flex-shrink: 0;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-spinner {
        border-color: #2d2d44;
        border-top-color: #818cf8;
      }
    }
    @keyframes ${BUBBLE_PREFIX}-spin {
      to { transform: rotate(360deg); }
    }
    .${BUBBLE_PREFIX}-error {
      padding: 12px 14px;
      color: #ef4444;
      font-size: 13px;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-error { color: #f87171; }
    }
    /* Progress overlay (page translation) */
    .${BUBBLE_PREFIX}-progress {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483645;
      background: #ffffff;
      color: #1a1a2e;
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
      padding: 12px 18px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 10px;
      animation: ${BUBBLE_PREFIX}-bubble-in 120ms ease-out;
      cursor: pointer;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-progress {
        background: #1a1a2e;
        color: #e5e7eb;
        border-color: #2d2d44;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      }
    }
    .${BUBBLE_PREFIX}-progress-bar {
      width: 60px;
      height: 4px;
      background: #e5e7eb;
      border-radius: 2px;
      overflow: hidden;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-progress-bar { background: #2d2d44; }
    }
    .${BUBBLE_PREFIX}-progress-fill {
      height: 100%;
      background: #6366f1;
      border-radius: 2px;
      transition: width 200ms ease-out;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-progress-fill { background: #818cf8; }
    }
    .${BUBBLE_PREFIX}-progress-stop {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 1px solid #e5e7eb;
      background: #fff;
      color: #6b7280;
      font-size: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-left: 4px;
      flex-shrink: 0;
      transition: background 120ms ease-out, color 120ms ease-out;
    }
    .${BUBBLE_PREFIX}-progress-stop:hover {
      background: #fef2f2;
      color: #ef4444;
      border-color: #fecaca;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-progress-stop {
        background: #1a1a2e;
        border-color: #2d2d44;
        color: #9ca3af;
      }
      .${BUBBLE_PREFIX}-progress-stop:hover {
        background: #2d1b1b;
        color: #f87171;
        border-color: #4a2020;
      }
    }
    /* ---- Draggable Popup (context menu / selection button) ---- */
    .${BUBBLE_PREFIX}-popup {
      position: absolute;
      z-index: 2147483646;
      width: 420px;
      max-height: 80vh;
      background: #ffffff;
      color: #1a1a2e;
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: ${BUBBLE_PREFIX}-popup-in 200ms ease-out;
    }
    @keyframes ${BUBBLE_PREFIX}-popup-in {
      from { opacity: 0; transform: translateY(6px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-popup {
        background: #1a1a2e;
        color: #e5e7eb;
        border-color: #2d2d44;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
      }
    }
    .${BUBBLE_PREFIX}-popup-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #eef2ff;
      border-bottom: 1px solid #e5e7eb;
      cursor: move;
      user-select: none;
      flex-shrink: 0;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-popup-header {
        background: #1e1b4b;
        border-bottom-color: #2d2d44;
      }
    }
    .${BUBBLE_PREFIX}-popup-title {
      font-size: 12px;
      font-weight: 600;
      color: #6366f1;
      letter-spacing: 0.02em;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-popup-title { color: #818cf8; }
    }
    .${BUBBLE_PREFIX}-popup-actions {
      display: flex;
      gap: 4px;
    }
    .${BUBBLE_PREFIX}-popup-body {
      flex: 1;
      overflow-y: auto;
      padding: 0;
    }
    .${BUBBLE_PREFIX}-popup-src-label {
      font-size: 11px;
      font-weight: 500;
      color: #6b7280;
      padding: 10px 14px 4px;
    }
    .${BUBBLE_PREFIX}-popup-src {
      width: 100%;
      border: none;
      background: transparent;
      color: #6b7280;
      font-size: 13px;
      line-height: 1.5;
      resize: vertical;
      outline: none;
      padding: 4px 14px 10px;
      min-height: 40px;
      max-height: 160px;
      overflow-y: auto;
      font-family: inherit;
      box-sizing: border-box;
    }
    .${BUBBLE_PREFIX}-popup-src:focus {
      background: rgba(99, 102, 241, 0.03);
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-popup-src { color: #9ca3af; }
      .${BUBBLE_PREFIX}-popup-src:focus { background: rgba(99, 102, 241, 0.06); }
    }
    .${BUBBLE_PREFIX}-popup-result {
      padding: 12px 14px;
      border-top: 1px solid #e5e7eb;
      min-height: 40px;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.6;
      font-size: 14px;
      user-select: text;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-popup-result { border-top-color: #2d2d44; }
    }
    .${BUBBLE_PREFIX}-popup-loading {
      display: flex;
      align-items: center;
      gap: 10px;
      color: #6b7280;
    }
    .${BUBBLE_PREFIX}-popup-error {
      color: #ef4444;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-popup-error { color: #f87171; }
    }
    .${BUBBLE_PREFIX}-popup-actions-bar {
      display: flex;
      justify-content: flex-end;
      padding: 10px 14px;
      border-top: 1px solid #e5e7eb;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-popup-actions-bar { border-top-color: #2d2d44; }
    }
  `;
  document.head.appendChild(style);
}

function removeSelectionBtn(): void {
  selectionBtn?.remove();
  selectionBtn = null;
  selectionBtnHovered = false;
}

function removeBubble(): void {
  if (isPinned) return;
  bubble?.remove();
  bubble = null;
}

function forceRemoveBubble(): void {
  isPinned = false;
  bubble?.remove();
  bubble = null;
}

/** Check if text is worth translating. */
function isTranslatable(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if (/^[\d\s.,:;!?%+\-*/=()[\]{}]+$/.test(trimmed)) return false;
  if (/^[^\w\s]+$/.test(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  return true;
}

export function showSelectionBtn(range: Range): void {
  removeSelectionBtn();
  injectThemeVars();

  // Save the selected text NOW — the selection may be cleared before
  // the user clicks the button (e.g. by site event handlers on mousedown).
  savedSelectionText = range.toString().trim();

  const btn = document.createElement("button");
  btn.className = `${BUBBLE_PREFIX}-selection-btn`;
  btn.innerHTML = TRANSLATE_ICON_IMG;
  btn.title = t(cachedLang, "bubble.translateSelection");

  // Get the position at the END of the selection (not the bounding box,
  // which for multi-line selections gives the rightmost edge of ALL lines).
  const selEndRect = getSelectionEndRect(range);
  const selRect = range.getBoundingClientRect();

  let x: number;
  let y: number;
  if (selEndRect) {
    x = selEndRect.right + window.scrollX + 6;
    y = selEndRect.bottom + window.scrollY - 5;
  } else {
    // Fallback to bounding box
    x = selRect.right + window.scrollX + 6;
    y = selRect.bottom + window.scrollY - 5;
  }

  // Keep within viewport
  if (x + 24 > window.innerWidth + window.scrollX) {
    x = (selEndRect?.left ?? selRect.left) + window.scrollX - 24;
  }
  if (x < window.scrollX + 4) {
    x = window.scrollX + 4;
  }
  if (y + 24 > window.innerHeight + window.scrollY) {
    y = selRect.top + window.scrollY - 24;
  }
  if (y < window.scrollY + 4) {
    y = window.scrollY + 4;
  }

  btn.style.left = `${x}px`;
  btn.style.top = `${y}px`;

  // Hover protection — track hover state so selectionchange doesn't
  // remove the button while the user is interacting with it.
  btn.addEventListener("mouseenter", () => { selectionBtnHovered = true; });
  btn.addEventListener("mouseleave", () => { selectionBtnHovered = false; });

  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Use saved text — the live selection may have been cleared.
    const text = savedSelectionText || window.getSelection()?.toString().trim() || "";
    removeSelectionBtn();
    if (text) {
      showDraggablePopup(text, x, y);
    }
  });

  document.body.appendChild(btn);
  selectionBtn = btn;

  // Auto-remove after 6 seconds if not clicked
  setTimeout(() => {
    if (selectionBtn === btn) removeSelectionBtn();
  }, 6000);
}

/** Whether the selection button is currently being hovered. */
export function isSelectionBtnHovered(): boolean {
  return selectionBtnHovered;
}

/**
 * Get the bounding rect of the END point of a Range.
 * For multi-line selections, this is at the end of the last line —
 * unlike getBoundingClientRect() which returns the bounding box of ALL lines.
 */
function getSelectionEndRect(range: Range): DOMRect | null {
  try {
    const endRange = document.createRange();
    endRange.setStart(range.endContainer, range.endOffset);
    endRange.setEnd(range.endContainer, range.endOffset);
    const rect = endRange.getBoundingClientRect();
    // A collapsed range at a line break may have zero dimensions.
    // In that case, try one character before.
    if (rect.width === 0 && rect.height === 0 && range.endOffset > 0) {
      const fallback = document.createRange();
      fallback.setStart(range.endContainer, range.endOffset - 1);
      fallback.setEnd(range.endContainer, range.endOffset);
      const fRect = fallback.getBoundingClientRect();
      if (fRect.width > 0 && fRect.height > 0) {
        return new DOMRect(fRect.right, fRect.top, 0, fRect.height);
      }
    }
    if (rect.height > 0) return rect;
  } catch {
    // Range may be in a detached node
  }
  return null;
}

function showBubble(anchorRect: DOMRect, sourceText: string): void {
  forceRemoveBubble();
  injectThemeVars();

  const el = document.createElement("div");
  el.className = `${BUBBLE_PREFIX}-bubble`;

  // Position: prefer right-above, fallback below/left
  let x = anchorRect.right + window.scrollX + 8;
  let y = anchorRect.top + window.scrollY - 8;

  if (x + 420 > window.innerWidth + window.scrollX) {
    x = anchorRect.left + window.scrollX - 428;
  }
  if (x < window.scrollX + 8) {
    x = window.scrollX + 8;
  }
  if (y < window.scrollY + 8) {
    y = anchorRect.bottom + window.scrollY + 8;
  }
  // Prevent going below viewport
  if (y + 200 > window.innerHeight + window.scrollY) {
    y = Math.max(window.scrollY + 8, anchorRect.top + window.scrollY - 200);
  }

  el.style.left = `${x}px`;
  el.style.top = `${y}px`;

  const showSource = sourceText.length > MAX_SOURCE_DISPLAY;

  el.innerHTML = `
    <div class="${BUBBLE_PREFIX}-bubble-header">
      <span class="${BUBBLE_PREFIX}-title">${t(cachedLang, "bubble.title")}</span>
      <div class="${BUBBLE_PREFIX}-bubble-actions">
        <button class="${BUBBLE_PREFIX}-btn ${BUBBLE_PREFIX}-pin-btn" title="${t(cachedLang, "bubble.pin")}">${PIN_ICON}</button>
        <button class="${BUBBLE_PREFIX}-btn ${BUBBLE_PREFIX}-copy-btn" title="${t(cachedLang, "bubble.copyTranslation")}">${COPY_ICON}</button>
        <button class="${BUBBLE_PREFIX}-btn ${BUBBLE_PREFIX}-close-btn" title="${t(cachedLang, "bubble.close")}">${CLOSE_ICON}</button>
      </div>
    </div>
    ${showSource ? `
    <div class="${BUBBLE_PREFIX}-source-section">
      <div class="${BUBBLE_PREFIX}-source-toggle">${t(cachedLang, "bubble.source")}</div>
      <div class="${BUBBLE_PREFIX}-source-text">${escapeHtml(sourceText)}</div>
    </div>` : ""}
    <div class="${BUBBLE_PREFIX}-loading">
      <div class="${BUBBLE_PREFIX}-spinner"></div>
      <span>${t(cachedLang, "bubble.translating")}</span>
    </div>
  `;

  // Event handlers
  const closeBtn = el.querySelector(`.${BUBBLE_PREFIX}-close-btn`);
  closeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    forceRemoveBubble();
  });

  const pinBtn = el.querySelector(`.${BUBBLE_PREFIX}-pin-btn`);
  pinBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    isPinned = !isPinned;
    (pinBtn as HTMLElement).style.color = isPinned ? "#6366f1" : "";
    (pinBtn as HTMLElement).title = isPinned
      ? t(cachedLang, "bubble.unpin")
      : t(cachedLang, "bubble.pin");
  });

  const copyBtn = el.querySelector(`.${BUBBLE_PREFIX}-copy-btn`);
  copyBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const transEl = el.querySelector(`.${BUBBLE_PREFIX}-translation`);
    if (transEl) {
      navigator.clipboard.writeText(transEl.textContent || "");
      (copyBtn as HTMLElement).style.color = "#10b981";
      setTimeout(() => {
        (copyBtn as HTMLElement).style.color = "";
      }, 1000);
    }
  });

  // Source toggle
  const sourceToggle = el.querySelector(`.${BUBBLE_PREFIX}-source-toggle`);
  const sourceTextEl = el.querySelector(`.${BUBBLE_PREFIX}-source-text`);
  if (sourceToggle && sourceTextEl) {
    sourceToggle.addEventListener("click", () => {
      sourceToggle.classList.toggle(`${BUBBLE_PREFIX}-expanded`);
      sourceTextEl.classList.toggle(`${BUBBLE_PREFIX}-visible`);
    });
  }

  document.body.appendChild(el);
  bubble = el;
}

async function requestTranslation(text: string): Promise<void> {
  if (isTranslating) return;
  isTranslating = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRANSLATE_TEXT",
      payload: { text },
    });

    if (!bubble) return;
    const loadingEl = bubble.querySelector(`.${BUBBLE_PREFIX}-loading`);
    if (!loadingEl) return;

    if (response?.success) {
      loadingEl.innerHTML = `<div class="${BUBBLE_PREFIX}-translation">${escapeHtml(response.translation || "")}</div>`;
    } else {
      loadingEl.innerHTML = `<div class="${BUBBLE_PREFIX}-error"><span>⚠</span><span>${escapeHtml(response?.error || t(cachedLang, "bubble.translationFailed"))}</span></div>`;
    }
  } catch {
    if (!bubble) return;
    const loadingEl = bubble.querySelector(`.${BUBBLE_PREFIX}-loading`);
    if (loadingEl) {
      loadingEl.innerHTML = `<div class="${BUBBLE_PREFIX}-error"><span>⚠</span><span>${t(cachedLang, "bubble.connectFail")}</span></div>`;
    }
  } finally {
    isTranslating = false;
  }
}

/** Show translation bubble directly with given text (for keyboard shortcut). */
export function showTranslationBubble(text: string): void {
  if (!text || !isTranslatable(text)) return;

  // Try to get current selection rect, otherwise use viewport center
  const sel = window.getSelection();
  let rect: DOMRect | null = null;
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const r = range.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      rect = r;
    }
  }
  if (!rect) {
    rect = new DOMRect(
      window.innerWidth / 2 - 100,
      window.innerHeight / 3,
      200,
      20
    );
  }

  removeSelectionBtn();
  showBubble(rect, text);
  requestTranslation(text);
}

/**
 * Show translation bubble at a specific position (for context menu).
 * The browser may clear the selection after right-click, so we use the
 * provided coordinates directly instead of relying on window.getSelection().
 */
export function showTranslationBubbleAtPos(text: string, x: number, y: number): void {
  if (!text || !isTranslatable(text)) return;

  const rect = new DOMRect(x - 50, y - 10, 100, 20);
  removeSelectionBtn();
  showBubble(rect, text);
  requestTranslation(text);
}

// ---- Draggable Translation Popup ----

let dragPopup: HTMLElement | null = null;

function removeDragPopup(): void {
  dragPopup?.remove();
  dragPopup = null;
}

/**
 * Show a full-featured draggable translation popup.
 * Used by both the context menu and the selection button.
 */
export function showDraggablePopup(text: string, x: number, y: number): void {
  removeDragPopup();
  removeBubble();
  removeSelectionBtn();
  injectThemeVars();

  const el = document.createElement("div");
  el.className = `${BUBBLE_PREFIX}-popup`;

  el.innerHTML = `
    <div class="${BUBBLE_PREFIX}-popup-header">
      <span class="${BUBBLE_PREFIX}-popup-title">${t(cachedLang, "bubble.title")}</span>
      <div class="${BUBBLE_PREFIX}-popup-actions">
        <button class="${BUBBLE_PREFIX}-btn ${BUBBLE_PREFIX}-popup-copy-btn" title="${t(cachedLang, "bubble.copyTranslation")}">${COPY_ICON}</button>
        <button class="${BUBBLE_PREFIX}-btn ${BUBBLE_PREFIX}-popup-close-btn" title="${t(cachedLang, "bubble.close")}">${CLOSE_ICON}</button>
      </div>
    </div>
    <div class="${BUBBLE_PREFIX}-popup-body">
      <div class="${BUBBLE_PREFIX}-popup-src-label">${t(cachedLang, "bubble.source")}</div>
      <textarea class="${BUBBLE_PREFIX}-popup-src" placeholder="${t(cachedLang, "popup.placeholder")}"></textarea>
      <div class="${BUBBLE_PREFIX}-popup-result">
        <div class="${BUBBLE_PREFIX}-popup-loading">
          <div class="${BUBBLE_PREFIX}-spinner"></div>
          <span>${t(cachedLang, "bubble.translating")}</span>
        </div>
      </div>
    </div>
    <div class="${BUBBLE_PREFIX}-popup-actions-bar">
      <button class="${BUBBLE_PREFIX}-btn ${BUBBLE_PREFIX}-popup-retranslate" style="width:auto;padding:0 10px;font-size:12px;color:#6366f1;">
        ${t(cachedLang, "popup.translate")}
      </button>
      <button class="${BUBBLE_PREFIX}-btn" style="width:auto;padding:0 10px;font-size:12px;color:#6b7280;">
        ${t(cachedLang, "popup.openSettings")}
      </button>
    </div>
  `;

  // Position: keep within viewport
  let px = x + window.scrollX + 10;
  let py = y + window.scrollY - 20;
  if (px + 430 > window.innerWidth + window.scrollX) {
    px = window.innerWidth + window.scrollX - 440;
  }
  if (px < window.scrollX + 10) {
    px = window.scrollX + 10;
  }
  if (py < window.scrollY + 10) {
    py = window.scrollY + 10;
  }
  if (py + 300 > window.innerHeight + window.scrollY) {
    py = Math.max(window.scrollY + 10, window.innerHeight + window.scrollY - 310);
  }

  el.style.left = `${px}px`;
  el.style.top = `${py}px`;

  // ---- Drag handling (with proper cleanup) ----
  const header = el.querySelector(`.${BUBBLE_PREFIX}-popup-header`) as HTMLElement;
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  const onDragMove = (e: MouseEvent) => {
    if (!isDragging) return;
    let nx = e.clientX - dragOffsetX + window.scrollX;
    let ny = e.clientY - dragOffsetY + window.scrollY;
    nx = Math.max(window.scrollX, Math.min(nx, window.scrollX + window.innerWidth - el.offsetWidth));
    ny = Math.max(window.scrollY, Math.min(ny, window.scrollY + window.innerHeight - 40));
    el.style.left = `${nx}px`;
    el.style.top = `${ny}px`;
  };

  const onDragEnd = () => { isDragging = false; };

  header.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest(`.${BUBBLE_PREFIX}-btn`)) return;
    isDragging = true;
    const rect = el.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup", onDragEnd);

  // ---- Cleanup helper (removes all listeners) ----
  const cleanup = () => {
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("mousedown", onOutsideClick);
  };

  // ---- Event handlers ----
  const closeBtn = el.querySelector(`.${BUBBLE_PREFIX}-popup-close-btn`);
  closeBtn?.addEventListener("click", (e) => { e.stopPropagation(); cleanup(); removeDragPopup(); });

  const copyBtn = el.querySelector(`.${BUBBLE_PREFIX}-popup-copy-btn`);
  copyBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const resultEl = el.querySelector(`.${BUBBLE_PREFIX}-popup-result`);
    if (resultEl) {
      navigator.clipboard.writeText(resultEl.textContent || "");
      (copyBtn as HTMLElement).style.color = "#10b981";
      setTimeout(() => { (copyBtn as HTMLElement).style.color = ""; }, 1000);
    }
  });

  // Re-translate button (translates current source text)
  const retranslateBtn = el.querySelector(`.${BUBBLE_PREFIX}-popup-retranslate`);
  retranslateBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const srcEl = el.querySelector(`.${BUBBLE_PREFIX}-popup-src`) as HTMLTextAreaElement;
    const currentText = srcEl?.value?.trim();
    if (currentText) {
      const resultArea = el.querySelector(`.${BUBBLE_PREFIX}-popup-result`);
      if (resultArea) {
        resultArea.innerHTML = `<div class="${BUBBLE_PREFIX}-popup-loading"><div class="${BUBBLE_PREFIX}-spinner"></div><span>${t(cachedLang, "bubble.translating")}</span></div>`;
      }
      requestTranslationForPopup(currentText);
    }
  });

  // Settings button
  const actionBtns = el.querySelectorAll(`.${BUBBLE_PREFIX}-popup-actions-bar .${BUBBLE_PREFIX}-btn`);
  const settingsBtn = actionBtns[actionBtns.length - 1] as HTMLElement;
  settingsBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" });
  });

  // Source text (editable)
  const srcEl = el.querySelector(`.${BUBBLE_PREFIX}-popup-src`) as HTMLTextAreaElement;
  if (srcEl) srcEl.value = text;

  document.body.appendChild(el);
  dragPopup = el;

  // Translate
  requestTranslationForPopup(text);

  // Auto-remove after 60 seconds
  const autoRemoveTimer = setTimeout(() => { if (dragPopup === el) { cleanup(); removeDragPopup(); } }, 60000);

  // Escape to close
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { clearTimeout(autoRemoveTimer); cleanup(); removeDragPopup(); }
  };
  document.addEventListener("keydown", onKey);

  // Click outside to close
  const onOutsideClick = (e: MouseEvent) => {
    if (!dragPopup) return;
    if (dragPopup.contains(e.target as Node)) return;
    clearTimeout(autoRemoveTimer);
    cleanup();
    removeDragPopup();
  };
  // Delay adding the outside-click handler so the opening click doesn't trigger it
  setTimeout(() => document.addEventListener("mousedown", onOutsideClick), 50);
}

/** Translation request specifically for the draggable popup. */
async function requestTranslationForPopup(text: string): Promise<void> {
  if (isTranslating) return;
  isTranslating = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRANSLATE_TEXT",
      payload: { text },
    });

    if (!dragPopup) return;
    const resultEl = dragPopup.querySelector(`.${BUBBLE_PREFIX}-popup-result`);
    if (!resultEl) return;

    if (response?.success) {
      resultEl.innerHTML = escapeHtml(response.translation || "");
    } else {
      resultEl.innerHTML = `<div class="${BUBBLE_PREFIX}-popup-error"><span>⚠</span><span>${escapeHtml(response?.error || t(cachedLang, "bubble.translationFailed"))}</span></div>`;
    }
  } catch {
    if (!dragPopup) return;
    const resultEl = dragPopup.querySelector(`.${BUBBLE_PREFIX}-popup-result`);
    if (resultEl) {
      resultEl.innerHTML = `<div class="${BUBBLE_PREFIX}-popup-error"><span>⚠</span><span>${t(cachedLang, "bubble.connectFail")}</span></div>`;
    }
  } finally {
    isTranslating = false;
  }
}

/** Check if the draggable popup is currently open. */
export function isDragPopupOpen(): boolean {
  return dragPopup !== null;
}

export function translateCurrentSelection(): void {
  const sel = window.getSelection();
  const text = sel?.toString().trim();
  if (!text || !isTranslatable(text)) return;

  const range = sel?.getRangeAt(0);
  const rect = range?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) return;

  showBubble(rect, text);
  requestTranslation(text);
}

export function initBubbleClose(): void {
  document.addEventListener("mousedown", (e) => {
    if (!bubble) return;
    if (isPinned) return;
    if (bubble.contains(e.target as Node)) return;
    if (selectionBtn?.contains(e.target as Node)) return;
    removeBubble();
  });
}

/** Pre-fetch language setting on content script load. */
export function prefetchLang(): void {
  getLang();
}
