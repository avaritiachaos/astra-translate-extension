// ============================================================
// Astra Translate – Selection Bubble (Content Script)
// ============================================================

import { escapeHtml } from "../shared/utils";
import { t, type UiLanguage } from "../shared/i18n";
import {
  closeChatPanel,
  isChatPanelEmbeddedIn,
  openChatPanel,
  openChatPanelInHost,
} from "./chatPanel";

// Constants
const BUBBLE_PREFIX = "ast";
const MAX_SOURCE_DISPLAY = 300;
const CONTEXT_CHARS = 80;

// State
let selectionBtn: HTMLButtonElement | null = null;
let selectionBtnHovered = false;
let savedSelectionText = "";
let savedContextBefore = "";
let savedContextAfter = "";
let savedFullLineText = "";
let bubble: HTMLElement | null = null;
let bubbleCleanup: (() => void) | null = null;
let isPinned = false;
let isTranslating = false;
let cachedLang: UiLanguage = "zh-CN";
let cachedPopupScale = 1.0;
let cachedSelectionTargetLang = "";

/** Fetch uiLanguage from settings (cached). */
async function getLang(): Promise<UiLanguage> {
  try {
    const s = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (s?.uiLanguage) cachedLang = s.uiLanguage;
    if (s?.selectionTargetLang) cachedSelectionTargetLang = s.selectionTargetLang;
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
const ASK_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
const REFRESH_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>`;
const SETTINGS_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`;

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
    .${BUBBLE_PREFIX}-bubble--chat {
      display: flex;
      flex-direction: column;
      width: min(380px, calc(100vw - 16px));
      height: min(520px, calc(100vh - 16px));
      min-width: 0;
      min-height: 0;
      max-width: calc(100vw - 16px);
      max-height: calc(100vh - 16px);
      box-sizing: border-box;
    }
    .${BUBBLE_PREFIX}-bubble--chat > .ast-cp-embedded {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
    }
    @media (max-width: 420px), (max-height: 360px) {
      .${BUBBLE_PREFIX}-bubble--chat {
        width: calc(100vw - 16px);
        height: calc(100vh - 16px);
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
      align-items: center;
      gap: 4px;
    }
    /* Primary call-to-action: a filled, labelled button so "ask AI" reads as
       an action, not one more grey glyph lost among the window controls. */
    .${BUBBLE_PREFIX}-ask-cta {
      display: flex;
      align-items: center;
      gap: 4px;
      height: 24px;
      padding: 0 9px;
      margin-right: 2px;
      border: none;
      border-radius: 12px;
      background: #6366f1;
      color: #ffffff;
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      transition: background 120ms ease-out, transform 120ms ease-out;
    }
    .${BUBBLE_PREFIX}-ask-cta:hover { background: #4f46e5; }
    .${BUBBLE_PREFIX}-ask-cta:active { transform: scale(0.96); }
    .${BUBBLE_PREFIX}-ask-cta svg { width: 12px; height: 12px; }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-ask-cta { background: #6366f1; }
      .${BUBBLE_PREFIX}-ask-cta:hover { background: #818cf8; }
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
    .${BUBBLE_PREFIX}-progress-scroll {
      padding: 10px 14px;
      cursor: default;
      pointer-events: none;
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
      align-items: center;
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
    /* ---- Resize Handle ---- */
    .${BUBBLE_PREFIX}-resize-handle {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 18px;
      height: 18px;
      cursor: nwse-resize;
      z-index: 10;
      opacity: 0;
      transition: opacity 150ms ease-out;
    }
    .${BUBBLE_PREFIX}-popup:hover .${BUBBLE_PREFIX}-resize-handle,
    .${BUBBLE_PREFIX}-bubble:hover .${BUBBLE_PREFIX}-resize-handle {
      opacity: 1;
    }
    .${BUBBLE_PREFIX}-resize-handle::before {
      content: "";
      position: absolute;
      bottom: 3px;
      right: 3px;
      width: 10px;
      height: 10px;
      border-right: 2px solid #9ca3af;
      border-bottom: 2px solid #9ca3af;
      border-radius: 0 0 2px 0;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-resize-handle::before {
        border-color: #6b7280;
      }
    }
    .${BUBBLE_PREFIX}-resize-handle:hover::before {
      border-color: #6366f1;
    }
    /* ---- Floating Ball ---- */
    .ast-ball-container {
      position: fixed;
      bottom: 30px;
      right: 30px;
      z-index: 2147483644;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1 0%, #818cf8 100%);
      box-shadow: 0 4px 16px rgba(99, 102, 241, 0.35), 0 0 0 2px rgba(255,255,255,0.2);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      -webkit-user-select: none;
      transition: box-shadow 200ms ease-out, width 200ms ease-out, height 200ms ease-out;
      animation: ast-ball-float 3s ease-in-out infinite;
    }
    .ast-ball-container:hover {
      box-shadow: 0 6px 24px rgba(99, 102, 241, 0.5), 0 0 0 3px rgba(255,255,255,0.3);
      animation-play-state: paused;
    }
    .ast-ball-container:active {
      transform: scale(0.95);
    }
    .ast-ball-icon {
      pointer-events: none;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.2));
      transition: width 200ms ease-out, height 200ms ease-out;
    }
    .ast-ball-pulse {
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      border: 2px solid rgba(99, 102, 241, 0.3);
      animation: ast-ball-pulse 2s ease-out infinite;
      pointer-events: none;
    }
    @keyframes ast-ball-float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-6px); }
    }
    @keyframes ast-ball-pulse {
      0% { transform: scale(1); opacity: 0.6; }
      100% { transform: scale(1.5); opacity: 0; }
    }
    @media (prefers-color-scheme: dark) {
      .ast-ball-container {
        background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
        box-shadow: 0 4px 16px rgba(79, 70, 229, 0.4), 0 0 0 2px rgba(255,255,255,0.1);
      }
      .ast-ball-container:hover {
        box-shadow: 0 6px 24px rgba(79, 70, 229, 0.6), 0 0 0 3px rgba(255,255,255,0.15);
      }
    }
    /* ---- Floating Ball Settings Panel ---- */
    .ast-ball-settings {
      position: fixed;
      z-index: 2147483643;
      width: 200px;
      background: #ffffff;
      color: #1a1a2e;
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.14);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      overflow: hidden;
      animation: ast-ball-panel-in 150ms ease-out;
    }
    @keyframes ast-ball-panel-in {
      from { opacity: 0; transform: translateX(8px) scale(0.96); }
      to { opacity: 1; transform: translateX(0) scale(1); }
    }
    @media (prefers-color-scheme: dark) {
      .ast-ball-settings {
        background: #1a1a2e;
        color: #e5e7eb;
        border-color: #2d2d44;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      }
    }
    .ast-ball-settings-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid #e5e7eb;
      background: #eef2ff;
    }
    @media (prefers-color-scheme: dark) {
      .ast-ball-settings-header {
        background: #1e1b4b;
        border-bottom-color: #2d2d44;
      }
    }
    .ast-ball-settings-title {
      font-size: 12px;
      font-weight: 600;
      color: #6366f1;
    }
    @media (prefers-color-scheme: dark) {
      .ast-ball-settings-title { color: #818cf8; }
    }
    .ast-ball-settings-close {
      width: 22px;
      height: 22px;
      border: none;
      background: transparent;
      color: #6b7280;
      font-size: 16px;
      cursor: pointer;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 120ms, color 120ms;
    }
    .ast-ball-settings-close:hover {
      background: #e5e7eb;
      color: #1a1a2e;
    }
    @media (prefers-color-scheme: dark) {
      .ast-ball-settings-close { color: #9ca3af; }
      .ast-ball-settings-close:hover { background: #2d2d44; color: #e5e7eb; }
    }
    .ast-ball-settings-body {
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .ast-ball-settings-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .ast-ball-settings-label {
      font-size: 11px;
      font-weight: 500;
      color: #6b7280;
    }
    @media (prefers-color-scheme: dark) {
      .ast-ball-settings-label { color: #9ca3af; }
    }
    .ast-ball-slider-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ast-ball-slider {
      flex: 1;
      height: 4px;
      -webkit-appearance: none;
      appearance: none;
      background: #e5e7eb;
      border-radius: 2px;
      outline: none;
    }
    .ast-ball-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #6366f1;
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(99, 102, 241, 0.3);
    }
    @media (prefers-color-scheme: dark) {
      .ast-ball-slider { background: #2d2d44; }
      .ast-ball-slider::-webkit-slider-thumb { background: #818cf8; }
    }
    .ast-ball-slider-value {
      font-size: 11px;
      color: #6b7280;
      min-width: 32px;
      text-align: right;
    }
    @media (prefers-color-scheme: dark) {
      .ast-ball-slider-value { color: #9ca3af; }
    }
    .ast-ball-settings-translate {
      width: 100%;
      padding: 7px 0;
      border: none;
      border-radius: 8px;
      background: #6366f1;
      color: #ffffff;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 120ms;
    }
    .ast-ball-settings-translate:hover {
      background: #4f46e5;
    }
    .ast-ball-settings-chat {
      width: 100%;
      padding: 7px 0;
      border: 1px solid #6366f1;
      border-radius: 8px;
      background: transparent;
      color: #6366f1;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 120ms, color 120ms;
    }
    .ast-ball-settings-chat:hover {
      background: #eef2ff;
    }
    @media (prefers-color-scheme: dark) {
      .ast-ball-settings-chat { border-color: #818cf8; color: #818cf8; }
      .ast-ball-settings-chat:hover { background: #1e1b4b; }
    }
    .ast-ball-settings-hide {
      width: 100%;
      padding: 6px 0;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: transparent;
      color: #6b7280;
      font-size: 11px;
      cursor: pointer;
      transition: background 120ms, color 120ms;
    }
    .ast-ball-settings-hide:hover {
      background: #f3f4f6;
      color: #1a1a2e;
    }
    @media (prefers-color-scheme: dark) {
      .ast-ball-settings-hide {
        border-color: #2d2d44;
        color: #9ca3af;
      }
      .ast-ball-settings-hide:hover {
        background: #2d2d44;
        color: #e5e7eb;
      }
    }
    /* ---- Dictionary Card (compact) ---- */
    .${BUBBLE_PREFIX}-dict-card {
      max-width: 420px;
      max-height: 380px;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 0;
      font-size: 13px;
      line-height: 1.45;
      scrollbar-width: thin;
      scrollbar-color: rgba(0,0,0,0.15) transparent;
    }
    .${BUBBLE_PREFIX}-dict-card::-webkit-scrollbar { width: 4px; height: 4px; }
    .${BUBBLE_PREFIX}-dict-card::-webkit-scrollbar-track { background: transparent; }
    .${BUBBLE_PREFIX}-dict-card::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 2px; }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-dict-card { scrollbar-color: rgba(255,255,255,0.15) transparent; }
      .${BUBBLE_PREFIX}-dict-card::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); }
    }
    .${BUBBLE_PREFIX}-dict-head {
      padding: 12px 16px 0;
    }
    .${BUBBLE_PREFIX}-dict-word {
      font-size: 18px;
      font-weight: 700;
      color: #1a1a2e;
      line-height: 1.3;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-dict-word { color: #e5e7eb; }
    }
    .${BUBBLE_PREFIX}-dict-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 3px;
    }
    .${BUBBLE_PREFIX}-pos-pill {
      display: inline-block;
      font-size: 12px;
      padding: 1px 8px;
      border-radius: 999px;
      background: rgba(99,102,241,0.08);
      color: #6366f1;
      font-weight: 500;
      line-height: 1.6;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-pos-pill { background: rgba(129,140,248,0.15); color: #818cf8; }
    }
    .${BUBBLE_PREFIX}-phonetic {
      font-size: 12px;
      color: #9ca3af;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-phonetic { color: #6b7280; }
    }
    .${BUBBLE_PREFIX}-dict-main-translation {
      padding: 8px 16px 6px;
      font-size: 18px;
      font-weight: 600;
      color: #1a1a2e;
      line-height: 1.4;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-dict-main-translation { color: #e5e7eb; }
    }
    .${BUBBLE_PREFIX}-dict-section {
      margin: 10px 16px 14px;
    }
    .${BUBBLE_PREFIX}-dict-section:first-of-type {
      margin-top: 6px;
    }
    .${BUBBLE_PREFIX}-dict-section-title {
      font-size: 12px;
      font-weight: 600;
      color: #6b7280;
      margin-bottom: 6px;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-dict-section-title { color: #9ca3af; }
    }
    .${BUBBLE_PREFIX}-dict-context-box {
      font-size: 13px;
      color: #374151;
      background: rgba(99,102,241,0.06);
      border-radius: 10px;
      padding: 8px 10px;
      line-height: 1.5;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-dict-context-box { color: #d1d5db; background: rgba(129,140,248,0.1); }
    }
    .${BUBBLE_PREFIX}-meaning-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .${BUBBLE_PREFIX}-meaning-chip {
      display: inline-block;
      padding: 4px 8px;
      font-size: 12px;
      border-radius: 6px;
      background: #f3f4f6;
      color: #374151;
      line-height: 1.4;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-meaning-chip { background: #2d2d44; color: #d1d5db; }
    }
    .${BUBBLE_PREFIX}-example-list > div {
      font-size: 13px;
      color: #6b7280;
      line-height: 1.5;
      margin-bottom: 4px;
    }
    .${BUBBLE_PREFIX}-example-list > div:last-child {
      margin-bottom: 0;
    }
    .${BUBBLE_PREFIX}-example-list strong {
      color: #374151;
      font-weight: 600;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-example-list > div { color: #9ca3af; }
      .${BUBBLE_PREFIX}-example-list strong { color: #d1d5db; }
    }
    .${BUBBLE_PREFIX}-dict-notrans {
      font-size: 12px;
      color: #9ca3af;
      font-style: italic;
      padding: 8px 16px 12px;
    }
    .${BUBBLE_PREFIX}-dict-name-hint {
      margin: 8px 16px 0;
      font-size: 12px;
      color: #6b7280;
      background: rgba(99,102,241,0.06);
      border-radius: 10px;
      padding: 8px 10px;
      line-height: 1.5;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-dict-name-hint { color: #9ca3af; background: rgba(129,140,248,0.1); }
    }
    .${BUBBLE_PREFIX}-dict-nt-hint {
      margin: 6px 16px 12px;
      font-size: 13px;
      color: #6b7280;
      line-height: 1.5;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-dict-nt-hint { color: #9ca3af; }
    }
    .${BUBBLE_PREFIX}-dict-footer {
      display: flex;
      justify-content: flex-end;
      gap: 4px;
      padding: 6px 16px 10px;
      border-top: 1px solid #f3f4f6;
      margin-top: 4px;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-dict-footer { border-top-color: #2d2d44; }
    }
    .${BUBBLE_PREFIX}-dict-footer-btn {
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      cursor: pointer;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #9ca3af;
      transition: background 120ms, color 120ms;
    }
    .${BUBBLE_PREFIX}-dict-footer-btn:hover {
      background: #f3f4f6;
      color: #6366f1;
    }
    @media (prefers-color-scheme: dark) {
      .${BUBBLE_PREFIX}-dict-footer-btn { color: #6b7280; }
      .${BUBBLE_PREFIX}-dict-footer-btn:hover { background: #2d2d44; color: #818cf8; }
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
  if (bubble && isChatPanelEmbeddedIn(bubble)) closeChatPanel();
  bubbleCleanup?.();
  bubbleCleanup = null;
  bubble?.remove();
  bubble = null;
}

function forceRemoveBubble(): void {
  isPinned = false;
  if (bubble && isChatPanelEmbeddedIn(bubble)) closeChatPanel();
  bubbleCleanup?.();
  bubbleCleanup = null;
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

/**
 * Capture surrounding context from the selection.
 * Reads the text node or parent element's textContent, then extracts
 * the characters immediately before and after the selected text.
 * Skips input/textarea/password/contenteditable elements.
 */
function captureSelectionContext(range: Range): { contextBefore: string; contextAfter: string; fullLineText: string } {
  const EMPTY = { contextBefore: "", contextAfter: "", fullLineText: "" };

  try {
    const { anchorNode } = window.getSelection() || {};
    if (!anchorNode) return EMPTY;

    // Skip editable fields
    const parentEl = anchorNode.parentElement;
    if (parentEl) {
      const tag = parentEl.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return EMPTY;
      if (parentEl.isContentEditable) return EMPTY;
    }

    // Get the full text from the text node or parent element
    let fullText = "";
    if (anchorNode.nodeType === Node.TEXT_NODE) {
      fullText = anchorNode.textContent || "";
    } else if (parentEl) {
      fullText = parentEl.textContent || "";
    }

    if (!fullText) return EMPTY;

    const selectedText = range.toString();
    const selStart = fullText.indexOf(selectedText);
    if (selStart < 0) return EMPTY;

    const selEnd = selStart + selectedText.length;
    const contextBefore = fullText.substring(Math.max(0, selStart - CONTEXT_CHARS), selStart);
    const contextAfter = fullText.substring(selEnd, selEnd + CONTEXT_CHARS);

    // fullLineText: the full text content (capped at 300 chars for safety)
    const fullLineText = fullText.length > 300 ? fullText.substring(0, 300) : fullText;

    return { contextBefore, contextAfter, fullLineText };
  } catch {
    return EMPTY;
  }
}

export function showSelectionBtn(range: Range): void {
  removeSelectionBtn();
  injectThemeVars();

  // Save the selected text and context NOW — the selection may be cleared before
  // the user clicks the button (e.g. by site event handlers on mousedown).
  savedSelectionText = range.toString().trim();
  const ctx = captureSelectionContext(range);
  savedContextBefore = ctx.contextBefore;
  savedContextAfter = ctx.contextAfter;
  savedFullLineText = ctx.fullLineText;

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

  // Apply scale
  if (cachedPopupScale !== 1) {
    el.style.transform = `scale(${cachedPopupScale})`;
    el.style.transformOrigin = "top left";
  }

  const showSource = sourceText.length > MAX_SOURCE_DISPLAY;

  el.innerHTML = `
    <div class="${BUBBLE_PREFIX}-bubble-header">
      <span class="${BUBBLE_PREFIX}-title">${t(cachedLang, "bubble.title")}</span>
      <div class="${BUBBLE_PREFIX}-bubble-actions">
        <button class="${BUBBLE_PREFIX}-ask-cta ${BUBBLE_PREFIX}-ask-btn" title="${t(cachedLang, "bubble.askAI")}">${ASK_ICON}<span>${t(cachedLang, "bubble.askAIShort")}</span></button>
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
    <div class="${BUBBLE_PREFIX}-resize-handle" title="${t(cachedLang, "bubble.resize")}"></div>
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
    const transEl = el.querySelector(`.${BUBBLE_PREFIX}-translation`)
      || el.querySelector(`.${BUBBLE_PREFIX}-dict-main-translation`)
      || el.querySelector(`.${BUBBLE_PREFIX}-dict-word`);
    if (transEl) {
      navigator.clipboard.writeText(transEl.textContent || "");
      (copyBtn as HTMLElement).style.color = "#10b981";
      setTimeout(() => {
        (copyBtn as HTMLElement).style.color = "";
      }, 1000);
    }
  });

  const askBtn = el.querySelector(`.${BUBBLE_PREFIX}-ask-btn`);
  askBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const trimmed = sourceText.trim();
    if (!trimmed) return;
    void openChatPanelInHost(trimmed, {
      host: el,
      onBack: () => {
        // The original bubble children and listeners are restored by the chat
        // mount. Keep the bubble reference so outside-click handling resumes.
        bubble = el;
      },
      onClose: () => {
        bubbleCleanup?.();
        bubbleCleanup = null;
        if (bubble === el) bubble = null;
        el.remove();
      },
    });
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

  // Resize handle
  const resizeHandle = el.querySelector(`.${BUBBLE_PREFIX}-resize-handle`) as HTMLElement | null;
  let isResizing = false;
  let resizeStartScale = 1;
  let resizeStartDist = 1;
  let resizeOriginX = x;
  let resizeOriginY = y;
  let rafId = 0;
  let pendingScale = 1;

  const applyResize = () => {
    rafId = 0;
    cachedPopupScale = Math.round(pendingScale * 10) / 10;
    cachedPopupScale = Math.max(0.5, Math.min(2.0, cachedPopupScale));
    el.style.transform = `scale(${cachedPopupScale})`;
    el.style.transformOrigin = "top left";
  };

  const onResizeMove = (e: MouseEvent) => {
    if (!isResizing) return;
    const curDist = Math.hypot(
      e.clientX + window.scrollX - resizeOriginX,
      e.clientY + window.scrollY - resizeOriginY
    );
    pendingScale = resizeStartScale * (curDist / resizeStartDist);
    if (!rafId) {
      rafId = requestAnimationFrame(applyResize);
    }
  };

  const onResizeEnd = () => {
    if (!isResizing) return;
    isResizing = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    chrome.runtime.sendMessage({
      type: "SAVE_POPUP_SCALE",
      payload: { scale: cachedPopupScale },
    }).catch(() => {});
  };

  resizeHandle?.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    resizeStartScale = cachedPopupScale;
    resizeOriginX = x;
    resizeOriginY = y;
    resizeStartDist = Math.hypot(
      e.clientX + window.scrollX - resizeOriginX,
      e.clientY + window.scrollY - resizeOriginY
    );
    if (resizeStartDist < 5) resizeStartDist = 5;
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", onResizeMove);
  document.addEventListener("mouseup", onResizeEnd);

  const cleanupBubbleResize = () => {
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeEnd);
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    isResizing = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  bubbleCleanup = cleanupBubbleResize;

  document.body.appendChild(el);
  bubble = el;
}

/** Render a compact dictionary card from a DictionaryResult JSON. */
function renderDictionaryCard(
  result: { selectedText: string; translation: string; partOfSpeech: string; pronunciation?: string; meanings: string[]; contextMeaning: string; examples: { source: string; target: string }[]; isTranslatable: boolean; isNameOrIdentifier?: boolean; note?: string },
  _resolvedLang: string
): string {
  const P = BUBBLE_PREFIX;
  let html = `<div class="${P}-dict-card">`;

  // Head: word + meta (pos pill + phonetic)
  html += `<div class="${P}-dict-head">`;
  html += `<div class="${P}-dict-word">${escapeHtml(result.selectedText)}</div>`;
  if (result.partOfSpeech || result.pronunciation) {
    html += `<div class="${P}-dict-meta">`;
    if (result.partOfSpeech) {
      html += `<span class="${P}-pos-pill">${escapeHtml(result.partOfSpeech)}</span>`;
    }
    if (result.pronunciation) {
      html += `<span class="${P}-phonetic">${escapeHtml(result.pronunciation)}</span>`;
    }
    html += `</div>`;
  }
  html += `</div>`;

  // Name / identifier card: keep the word unchanged, hint that it's a name,
  // and explain any meaning / origin the model could find.
  if (result.isNameOrIdentifier) {
    html += `<div class="${P}-dict-name-hint">${t(cachedLang, "bubble.nameHint")}</div>`;

    if (result.meanings && result.meanings.length > 0) {
      html += `<section class="${P}-dict-section">`;
      html += `<div class="${P}-dict-section-title">${t(cachedLang, "bubble.possibleMeanings")}</div>`;
      html += `<div class="${P}-meaning-chips">`;
      for (const m of result.meanings) {
        html += `<span class="${P}-meaning-chip">${escapeHtml(m)}</span>`;
      }
      html += `</div></section>`;
    }

    const explanation = (result.note && result.note.trim())
      || (result.contextMeaning && result.contextMeaning.trim())
      || t(cachedLang, "bubble.noReliableMeaning");
    html += `<section class="${P}-dict-section">`;
    html += `<div class="${P}-dict-section-title">${t(cachedLang, "bubble.explanation")}</div>`;
    html += `<div class="${P}-dict-context-box">${escapeHtml(explanation)}</div>`;
    html += `</section>`;

    html += `<div class="${P}-dict-footer">`;
    html += `<button class="${P}-dict-footer-btn ${P}-dict-copy-btn" title="${t(cachedLang, "bubble.copyTranslation")}">${COPY_ICON}</button>`;
    html += `<button class="${P}-dict-footer-btn ${P}-dict-retranslate-btn" title="${t(cachedLang, "bubble.retranslate")}">${REFRESH_ICON}</button>`;
    html += `<button class="${P}-dict-footer-btn ${P}-dict-settings-btn" title="${t(cachedLang, "bubble.openSettings")}">${SETTINGS_ICON}</button>`;
    html += `</div></div>`;
    return html;
  }

  if (!result.isTranslatable) {
    html += `<div class="${P}-dict-notrans">${t(cachedLang, "bubble.notTranslatable")}</div>`;
    html += `<div class="${P}-dict-footer">`;
    html += `<button class="${P}-dict-footer-btn ${P}-dict-copy-btn" title="${t(cachedLang, "bubble.copyTranslation")}">${COPY_ICON}</button>`;
    html += `<button class="${P}-dict-footer-btn ${P}-dict-settings-btn" title="${t(cachedLang, "bubble.openSettings")}">${SETTINGS_ICON}</button>`;
    html += `</div></div>`;
    return html;
  }

  // Main translation
  html += `<div class="${P}-dict-main-translation">${escapeHtml(result.translation)}</div>`;

  // Context section
  if (result.contextMeaning) {
    html += `<section class="${P}-dict-section ${P}-dict-context-section">`;
    html += `<div class="${P}-dict-section-title">${t(cachedLang, "bubble.currentContext")}</div>`;
    html += `<div class="${P}-dict-context-box">${escapeHtml(result.contextMeaning)}</div>`;
    html += `</section>`;
  }

  // Meanings as chips
  if (result.meanings && result.meanings.length > 0) {
    html += `<section class="${P}-dict-section">`;
    html += `<div class="${P}-dict-section-title">${t(cachedLang, "bubble.commonMeanings")}</div>`;
    html += `<div class="${P}-meaning-chips">`;
    for (const m of result.meanings) {
      html += `<span class="${P}-meaning-chip">${escapeHtml(m)}</span>`;
    }
    html += `</div></section>`;
  }

  // Examples
  if (result.examples && result.examples.length > 0) {
    html += `<section class="${P}-dict-section">`;
    html += `<div class="${P}-dict-section-title">${t(cachedLang, "bubble.commonCollocations")}</div>`;
    html += `<div class="${P}-example-list">`;
    for (const ex of result.examples) {
      html += `<div><strong>${escapeHtml(ex.source)}</strong>：${escapeHtml(ex.target)}</div>`;
    }
    html += `</div></section>`;
  }

  // Footer
  html += `<div class="${P}-dict-footer">`;
  html += `<button class="${P}-dict-footer-btn ${P}-dict-copy-btn" title="${t(cachedLang, "bubble.copyTranslation")}">${COPY_ICON}</button>`;
  html += `<button class="${P}-dict-footer-btn ${P}-dict-retranslate-btn" title="${t(cachedLang, "bubble.retranslate")}">${REFRESH_ICON}</button>`;
  html += `<button class="${P}-dict-footer-btn ${P}-dict-settings-btn" title="${t(cachedLang, "bubble.openSettings")}">${SETTINGS_ICON}</button>`;
  html += `</div>`;

  html += `</div>`;
  return html;
}

/** Render a compact card for hard-non-translatable content (URL, path, code…). */
function renderNonTranslatableCard(kind: string, text: string): string {
  const P = BUBBLE_PREFIX;
  const hintKey: Record<string, string> = {
    url: "bubble.hardUrl",
    email: "bubble.hardEmail",
    path: "bubble.hardPath",
    code: "bubble.hardCode",
    hash: "bubble.hardHash",
    generic: "bubble.hardGeneric",
  };
  const hint = t(cachedLang, hintKey[kind] || "bubble.hardGeneric");

  let html = `<div class="${P}-dict-card">`;
  html += `<div class="${P}-dict-head">`;
  html += `<div class="${P}-dict-word" style="font-size:15px;font-weight:600;word-break:break-all;">${escapeHtml(text)}</div>`;
  html += `</div>`;
  html += `<div class="${P}-dict-nt-hint">${hint}</div>`;
  html += `<div class="${P}-dict-footer">`;
  html += `<button class="${P}-dict-footer-btn ${P}-dict-copy-btn" title="${t(cachedLang, "bubble.copyTranslation")}">${COPY_ICON}</button>`;
  html += `<button class="${P}-dict-footer-btn ${P}-dict-settings-btn" title="${t(cachedLang, "bubble.openSettings")}">${SETTINGS_ICON}</button>`;
  html += `</div></div>`;
  return html;
}

/** Attach click listeners to dictionary card footer buttons. */
function attachDictFooterListeners(container: Element, retranslateFn?: () => void): void {
  const copyBtn = container.querySelector(`.${BUBBLE_PREFIX}-dict-copy-btn`);
  copyBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const translationEl = container.querySelector(`.${BUBBLE_PREFIX}-dict-main-translation`)
      || container.querySelector(`.${BUBBLE_PREFIX}-dict-word`);
    if (translationEl) {
      navigator.clipboard.writeText(translationEl.textContent || "");
      (copyBtn as HTMLElement).style.color = "#10b981";
      setTimeout(() => { (copyBtn as HTMLElement).style.color = ""; }, 1000);
    }
  });

  const retranslateBtn = container.querySelector(`.${BUBBLE_PREFIX}-dict-retranslate-btn`);
  retranslateBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isTranslating) return;
    container.innerHTML = `<div class="${BUBBLE_PREFIX}-loading"><div class="${BUBBLE_PREFIX}-spinner"></div><span>${t(cachedLang, "bubble.translating")}</span></div>`;
    if (retranslateFn) {
      retranslateFn();
    } else {
      requestTranslation(savedSelectionText);
    }
  });

  const settingsBtn = container.querySelector(`.${BUBBLE_PREFIX}-dict-settings-btn`);
  settingsBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" });
  });
}

async function requestTranslation(text: string): Promise<void> {
  if (isTranslating) return;
  isTranslating = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRANSLATE_TEXT",
      payload: {
        text,
        ...(cachedSelectionTargetLang ? { targetLang: cachedSelectionTargetLang } : {}),
        mode: "selection",
        contextBefore: savedContextBefore,
        contextAfter: savedContextAfter,
        fullLineText: savedFullLineText,
      },
    });

    if (!bubble) return;
    const loadingEl = bubble.querySelector(`.${BUBBLE_PREFIX}-loading`);
    if (!loadingEl) return;

    if (response?.success) {
      if (response.nonTranslatable) {
        loadingEl.innerHTML = renderNonTranslatableCard(response.nonTranslatable.kind, text);
        attachDictFooterListeners(loadingEl);
      } else if (response.dictionaryResult) {
        loadingEl.innerHTML = renderDictionaryCard(response.dictionaryResult, response.resolvedLang || "");
        attachDictFooterListeners(loadingEl);
      } else {
        const trans = response.translation || "";
        const resolvedLang = response.resolvedLang || "";
        const langLabel = resolvedLang ? `<div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">${escapeHtml(t(cachedLang, "bubble.translatedTo", { lang: resolvedLang }))}</div>` : "";
        const hint = trans.trim() === text.trim() ? `<div style="font-size:11px;color:#9ca3af;margin-top:4px;">${t(cachedLang, "bubble.mayBeIdentifier")}</div>` : "";
        loadingEl.innerHTML = `${langLabel}<div class="${BUBBLE_PREFIX}-translation">${escapeHtml(trans)}</div>${hint}`;
      }
    } else {
      loadingEl.innerHTML = `<div class="${BUBBLE_PREFIX}-error"><span>⚠</span><span>${escapeHtml(response?.error || t(cachedLang, "bubble.translationFailed"))}</span></div>`;
    }
  } catch {
    if (!bubble) return;
    const loadingEl = bubble.querySelector(`.${BUBBLE_PREFIX}-loading`);
    if (loadingEl) {
      // No runtime id ⇒ the extension was reloaded/updated and this page
      // still runs the old content script — only a refresh reconnects it.
      const reasonKey = chrome.runtime?.id ? "bubble.connectFail" : "bubble.staleContext";
      loadingEl.innerHTML = `<div class="${BUBBLE_PREFIX}-error"><span>⚠</span><span>${t(cachedLang, reasonKey)}</span></div>`;
    }
  } finally {
    isTranslating = false;
  }
}

/**
 * Open the in-page chat panel with the selection attached, anchored beside the
 * host popup so the conversation appears where the user is already looking.
 * Chat used to be staged into session storage and handed to
 * chrome.action.openPopup(), which doesn't exist before Chrome 127.
 */
function askAiAboutSelection(text: string, host: HTMLElement): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const rect = host.getBoundingClientRect();
  void openChatPanel(trimmed, {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  });
}

/** Show translation bubble directly with given text (for keyboard shortcut). */
export async function showTranslationBubble(text: string): Promise<void> {
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
  await getLang();
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
export async function showDraggablePopup(text: string, x: number, y: number): Promise<void> {
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
        <button class="${BUBBLE_PREFIX}-ask-cta ${BUBBLE_PREFIX}-popup-ask-btn" title="${t(cachedLang, "bubble.askAI")}">${ASK_ICON}<span>${t(cachedLang, "bubble.askAIShort")}</span></button>
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
    <div class="${BUBBLE_PREFIX}-resize-handle" title="${t(cachedLang, "bubble.resize")}"></div>
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

  // Apply scale
  if (cachedPopupScale !== 1) {
    el.style.transform = `scale(${cachedPopupScale})`;
    el.style.transformOrigin = "top left";
  }

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

  // ---- Resize handling ----
  const resizeHandle = el.querySelector(`.${BUBBLE_PREFIX}-resize-handle`) as HTMLElement | null;
  let isResizing = false;
  let resizeStartScale = 1;
  let resizeStartDist = 1;
  // The anchor point is the popup's top-left corner (transform-origin: top left)
  // which is at (styleLeft, styleTop) in page coords.
  let resizeOriginX = px;
  let resizeOriginY = py;
  let rafId = 0;
  let pendingScale = 1;

  const applyResize = () => {
    rafId = 0;
    cachedPopupScale = Math.round(pendingScale * 10) / 10;
    cachedPopupScale = Math.max(0.5, Math.min(2.0, cachedPopupScale));
    el.style.transform = `scale(${cachedPopupScale})`;
    el.style.transformOrigin = "top left";
  };

  const onResizeMove = (e: MouseEvent) => {
    if (!isResizing) return;
    const curDist = Math.hypot(
      e.clientX + window.scrollX - resizeOriginX,
      e.clientY + window.scrollY - resizeOriginY
    );
    pendingScale = resizeStartScale * (curDist / resizeStartDist);
    if (!rafId) {
      rafId = requestAnimationFrame(applyResize);
    }
  };

  const onResizeEnd = () => {
    if (!isResizing) return;
    isResizing = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    chrome.runtime.sendMessage({
      type: "SAVE_POPUP_SCALE",
      payload: { scale: cachedPopupScale },
    }).catch(() => {});
  };

  resizeHandle?.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    resizeStartScale = cachedPopupScale;
    resizeOriginX = px;
    resizeOriginY = py;
    resizeStartDist = Math.hypot(
      e.clientX + window.scrollX - resizeOriginX,
      e.clientY + window.scrollY - resizeOriginY
    );
    // Prevent division by zero if mouse is exactly at the origin
    if (resizeStartDist < 5) resizeStartDist = 5;
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", onResizeMove);
  document.addEventListener("mouseup", onResizeEnd);

  // ---- Cleanup helper (removes all listeners) ----
  const cleanup = () => {
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeEnd);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("mousedown", onOutsideClick);
  };

  // ---- Event handlers ----
  const popupAskBtn = el.querySelector(`.${BUBBLE_PREFIX}-popup-ask-btn`);
  popupAskBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const src = el.querySelector(`.${BUBBLE_PREFIX}-popup-src`) as HTMLTextAreaElement | null;
    askAiAboutSelection(src?.value || "", el);
  });

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

  // Ensure settings are cached before translating
  await getLang();
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
      payload: {
        text,
        ...(cachedSelectionTargetLang ? { targetLang: cachedSelectionTargetLang } : {}),
        mode: "selection",
        contextBefore: savedContextBefore,
        contextAfter: savedContextAfter,
        fullLineText: savedFullLineText,
      },
    });

    if (!dragPopup) return;
    const resultEl = dragPopup.querySelector(`.${BUBBLE_PREFIX}-popup-result`);
    if (!resultEl) return;

    if (response?.success) {
      if (response.nonTranslatable) {
        resultEl.innerHTML = renderNonTranslatableCard(response.nonTranslatable.kind, text);
        attachDictFooterListeners(resultEl);
      } else if (response.dictionaryResult) {
        resultEl.innerHTML = renderDictionaryCard(response.dictionaryResult, response.resolvedLang || "");
        const srcTextArea = dragPopup?.querySelector(`.${BUBBLE_PREFIX}-popup-src`) as HTMLTextAreaElement | null;
        attachDictFooterListeners(resultEl, srcTextArea ? () => requestTranslationForPopup(srcTextArea.value) : undefined);
      } else {
        const trans = response.translation || "";
        const resolvedLang = response.resolvedLang || "";
        const langLabel = resolvedLang ? `<div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">${escapeHtml(t(cachedLang, "bubble.translatedTo", { lang: resolvedLang }))}</div>` : "";
        const hint = trans.trim() === text.trim() ? `<div style="font-size:11px;color:#9ca3af;margin-top:4px;">${t(cachedLang, "bubble.mayBeIdentifier")}</div>` : "";
        resultEl.innerHTML = `${langLabel}<div>${escapeHtml(trans)}</div>${hint}`;
      }
    } else {
      resultEl.innerHTML = `<div class="${BUBBLE_PREFIX}-popup-error"><span>⚠</span><span>${escapeHtml(response?.error || t(cachedLang, "bubble.translationFailed"))}</span></div>`;
    }
  } catch {
    if (!dragPopup) return;
    const resultEl = dragPopup.querySelector(`.${BUBBLE_PREFIX}-popup-result`);
    if (resultEl) {
      // No runtime id ⇒ stale content script after an extension update.
      const reasonKey = chrome.runtime?.id ? "bubble.connectFail" : "bubble.staleContext";
      resultEl.innerHTML = `<div class="${BUBBLE_PREFIX}-popup-error"><span>⚠</span><span>${t(cachedLang, reasonKey)}</span></div>`;
    }
  } finally {
    isTranslating = false;
  }
}

/** Check if the draggable popup is currently open. */
export function isDragPopupOpen(): boolean {
  return dragPopup !== null;
}

export async function translateCurrentSelection(): Promise<void> {
  const sel = window.getSelection();
  const text = sel?.toString().trim();
  if (!text || !isTranslatable(text)) return;

  const range = sel?.getRangeAt(0);
  const rect = range?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) return;

  showBubble(rect, text);
  await getLang();
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

/** Set the popup/bubble scale factor. */
export function setPopupScale(scale: number): void {
  cachedPopupScale = scale;
}
