// ============================================================
// Astra Translate – In-page chat panel (Content Script)
// ============================================================
// Chat lives in the page instead of the toolbar popup. The old flow staged the
// selection in session storage and called chrome.action.openPopup(), which
// does not exist before Chrome 127 — users were told to go click the toolbar
// icon, and even on success they were pulled away from what they were reading.
//
// The panel talks to the same service-worker chat state as the popup (session
// storage + CHAT_STREAM_PORT), so a conversation started here continues in the
// popup and vice versa.
//
// Plain DOM, no React: the content script is built as an IIFE bundle
// (vite.content.config.ts). Model output is rendered through the shared
// whitelist markdown tokenizer into real elements — never innerHTML.

import { parseChatMarkdown } from "../shared/chatMarkdown";
import {
  CHAT_EFFORT_SESSION_KEY,
  CHAT_STORAGE_KEY,
  CHAT_STREAM_PORT,
  CHAT_WEB_SEARCH_SESSION_KEY,
  type ChatAttachment,
  type ChatState,
  type ChatStreamEvent,
  type ChatStreamPhase,
  type ChatTurn,
} from "../shared/types";
import {
  CHAT_EFFORTS,
  DEFAULT_CHAT_EFFORT,
  normalizeChatEffort,
  type ChatEffort,
} from "../shared/chatEffort";
import { extractPageContext, type ExtractedPageContext } from "../shared/pageExtract";
import { t, type UiLanguage } from "../shared/i18n";

const P = "ast";

/** Icons kept inline — the content script has no bundler-side asset step. */
const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const ICON_BACK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>`;
const ICON_SETTINGS = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`;
const ICON_COPY = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
const ICON_REGEN = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>`;

// ---- Panel state (one panel per page) ----

let panel: HTMLElement | null = null;
let lang: UiLanguage = "zh-CN";
let autoAttachEnabled = true;
let webSearchAvailable = false;

/** Live UI state, reset with the panel. */
let turns: ChatTurn[] = [];
let pending = false;
let streamText = "";
let phase: ChatStreamPhase | null = null;
let errorText = "";
let attachment: ChatAttachment | null = null;
/** One-shot page supplement for a selected-text question; never persisted. */
let supplementPage = false;
let effort: ChatEffort = DEFAULT_CHAT_EFFORT;
let webSearchOn = false;
let streamSeq = 0;
let refreshEffortMenu: (() => void) | null = null;

interface ChatRetryDraft {
  text: string;
  attachment: ChatAttachment | null;
  /** Re-enable the one-shot page supplement when the user retries. */
  pageSupplement: boolean;
}

/** Listeners/handles that must be torn down when the panel closes. */
let cleanupFns: Array<() => void> = [];

interface HiddenChild {
  element: HTMLElement;
  display: string;
}

interface EmbeddedMount {
  host: HTMLElement;
  root: HTMLElement | null;
  hiddenChildren: HiddenChild[];
  originalStyle: string | null;
  originalClassName: string;
  onBack: () => void;
  onClose: () => void;
}

let embeddedMount: EmbeddedMount | null = null;

export function isChatPanelOpen(): boolean {
  return panel !== null;
}

export function isChatPanelEmbeddedIn(host: HTMLElement): boolean {
  return embeddedMount?.host === host;
}

function injectStyles(): void {
  if (document.getElementById(`${P}-chat-panel-style`)) return;
  const style = document.createElement("style");
  style.id = `${P}-chat-panel-style`;
  style.textContent = `
    .${P}-cp {
      position: fixed;
      z-index: 2147483646;
      display: flex;
      flex-direction: column;
      width: 380px;
      height: 520px;
      min-width: 300px;
      min-height: 320px;
      background: #ffffff;
      color: #1a1a2e;
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.5;
      overflow: hidden;
      animation: ${P}-cp-in 160ms ease-out;
    }
    .${P}-cp-embedded {
      position: relative;
      inset: auto;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      border: none;
      border-radius: 0;
      box-shadow: none;
      animation: none;
    }
    .${P}-cp-embedded .${P}-cp-resize { display: none; }
    @keyframes ${P}-cp-in {
      from { opacity: 0; transform: translateY(8px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @media (prefers-color-scheme: dark) {
      .${P}-cp {
        background: #1a1a2e;
        color: #e5e7eb;
        border-color: #2d2d44;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
      }
    }
    .${P}-cp-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: #eef2ff;
      border-bottom: 1px solid #e5e7eb;
      cursor: move;
      user-select: none;
      flex-shrink: 0;
    }
    @media (prefers-color-scheme: dark) {
      .${P}-cp-header { background: #1e1b4b; border-bottom-color: #2d2d44; }
    }
    .${P}-cp-title {
      flex: 1;
      font-size: 12px;
      font-weight: 600;
      color: #6366f1;
      letter-spacing: 0.02em;
    }
    @media (prefers-color-scheme: dark) {
      .${P}-cp-title { color: #818cf8; }
    }
    .${P}-cp-hbtn {
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      color: #6b7280;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 120ms, color 120ms;
      flex-shrink: 0;
    }
    .${P}-cp-hbtn:hover { background: #e5e7eb; color: #1a1a2e; }
    @media (prefers-color-scheme: dark) {
      .${P}-cp-hbtn { color: #9ca3af; }
      .${P}-cp-hbtn:hover { background: #2d2d44; color: #e5e7eb; }
    }
    .${P}-cp-list {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px 12px;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-width: thin;
    }
    .${P}-cp-list::-webkit-scrollbar { width: 5px; }
    .${P}-cp-list::-webkit-scrollbar-track { background: transparent; }
    .${P}-cp-list::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 3px; }
    @media (prefers-color-scheme: dark) {
      .${P}-cp-list::-webkit-scrollbar-thumb { background: #2d2d44; }
    }
    .${P}-cp-empty {
      margin: auto;
      padding: 20px 16px;
      color: #9ca3af;
      font-size: 12px;
      font-style: italic;
      text-align: center;
      line-height: 1.6;
    }
    .${P}-cp-bubble {
      position: relative;
      max-width: 88%;
      padding: 8px 11px;
      border-radius: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      user-select: text;
    }
    .${P}-cp-bubble--user {
      align-self: flex-end;
      background: #6366f1;
      color: #fff;
      border-bottom-right-radius: 4px;
    }
    .${P}-cp-bubble--assistant {
      align-self: flex-start;
      background: #f7f7fa;
      border: 1px solid #e5e7eb;
      border-bottom-left-radius: 4px;
    }
    @media (prefers-color-scheme: dark) {
      .${P}-cp-bubble--assistant { background: #0f0f1a; border-color: #2d2d44; }
    }
    .${P}-cp-bubble--error {
      align-self: flex-start;
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: #ef4444;
      border-bottom-left-radius: 4px;
    }
    .${P}-cp-bubble--thinking {
      display: flex;
      align-items: center;
      gap: 7px;
      color: #6b7280;
    }
    .${P}-cp-chip {
      margin-bottom: 4px;
      font-size: 10px;
      opacity: 0.85;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .${P}-cp-acts {
      display: flex;
      gap: 4px;
      margin-top: 6px;
      opacity: 0;
      transition: opacity 120ms ease-out;
    }
    .${P}-cp-bubble--assistant:hover .${P}-cp-acts { opacity: 1; }
    .${P}-cp-act {
      display: flex;
      align-items: center;
      gap: 3px;
      padding: 2px 7px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      background: #ffffff;
      color: #6b7280;
      font-family: inherit;
      font-size: 10px;
      cursor: pointer;
      transition: color 120ms, border-color 120ms;
    }
    .${P}-cp-act:hover { color: #6366f1; border-color: #6366f1; }
    @media (prefers-color-scheme: dark) {
      .${P}-cp-act { background: #1a1a2e; border-color: #2d2d44; color: #9ca3af; }
      .${P}-cp-act:hover { color: #818cf8; border-color: #818cf8; }
    }
    .${P}-cp-spin {
      width: 13px;
      height: 13px;
      border: 2px solid #e5e7eb;
      border-top-color: #6366f1;
      border-radius: 50%;
      animation: ${P}-cp-spin 600ms linear infinite;
      flex-shrink: 0;
    }
    @keyframes ${P}-cp-spin { to { transform: rotate(360deg); } }
    .${P}-cp-caret {
      display: inline-block;
      width: 2px;
      height: 13px;
      margin-left: 2px;
      vertical-align: text-bottom;
      background: #6366f1;
      animation: ${P}-cp-blink 900ms steps(1) infinite;
    }
    @keyframes ${P}-cp-blink { 50% { opacity: 0; } }
    .${P}-cp-sources {
      margin-top: 8px;
      padding-top: 7px;
      border-top: 1px solid #e5e7eb;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    @media (prefers-color-scheme: dark) {
      .${P}-cp-sources { border-top-color: #2d2d44; }
    }
    .${P}-cp-source {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 100%;
      padding: 3px 6px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      background: #eef2ff;
      color: #6366f1;
      font-size: 10px;
      text-decoration: none;
      overflow: hidden;
    }
    .${P}-cp-source span:last-child {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @media (prefers-color-scheme: dark) {
      .${P}-cp-source { background: #1e1b4b; border-color: #2d2d44; color: #818cf8; }
    }
    .${P}-cp-note {
      margin-top: 8px;
      padding: 6px 7px;
      border: 1px solid #e5e7eb;
      border-radius: 7px;
      color: #6b7280;
      font-size: 10px;
      line-height: 1.4;
    }
    @media (prefers-color-scheme: dark) {
      .${P}-cp-note { border-color: #2d2d44; color: #9ca3af; }
    }
    .${P}-cp-foot {
      flex-shrink: 0;
      padding: 8px 12px 10px;
      border-top: 1px solid #e5e7eb;
    }
    @media (prefers-color-scheme: dark) {
      .${P}-cp-foot { border-top-color: #2d2d44; }
    }
    .${P}-cp-err {
      margin-bottom: 6px;
      padding: 6px 8px;
      border-radius: 8px;
      background: rgba(239, 68, 68, 0.08);
      color: #ef4444;
      font-size: 11px;
    }
    .${P}-cp-attach {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
      padding: 5px 9px;
      border: 1px dashed #e5e7eb;
      border-radius: 8px;
      color: #6b7280;
      font-size: 11px;
    }
    @media (prefers-color-scheme: dark) {
      .${P}-cp-attach { border-color: #2d2d44; color: #9ca3af; }
    }
    .${P}-cp-attach-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .${P}-cp-attach-x {
      border: none;
      background: transparent;
      color: #6b7280;
      font-size: 12px;
      cursor: pointer;
      padding: 0 2px;
      flex-shrink: 0;
    }
    .${P}-cp-attach-x:hover { color: #ef4444; }
    .${P}-cp-input {
      width: 100%;
      min-height: 38px;
      max-height: 110px;
      padding: 8px 10px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #ffffff;
      color: #1a1a2e;
      font-family: inherit;
      font-size: 13px;
      line-height: 1.5;
      resize: none;
      outline: none;
      overflow-y: auto;
      box-sizing: border-box;
      transition: border-color 120ms;
    }
    .${P}-cp-input:focus { border-color: #6366f1; }
    @media (prefers-color-scheme: dark) {
      .${P}-cp-input { background: #0f0f1a; color: #e5e7eb; border-color: #2d2d44; }
    }
    .${P}-cp-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 7px;
    }
    .${P}-cp-send {
      height: 28px;
      padding: 0 16px;
      border: none;
      border-radius: 8px;
      background: #6366f1;
      color: #fff;
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      transition: background 120ms;
    }
    .${P}-cp-send:hover { background: #4f46e5; }
    .${P}-cp-send:disabled { opacity: 0.5; cursor: not-allowed; }
    /* Pills and icon buttons share one 28px height so the row reads as a
       single band rather than a pile of differently-shaped controls. */
    .${P}-cp-toggle {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 28px;
      padding: 0 10px;
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      background: transparent;
      color: #6b7280;
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      transition: color 120ms, border-color 120ms, background 120ms;
    }
    .${P}-cp-toggle:hover { border-color: #6366f1; color: #6366f1; }
    .${P}-cp-toggle--on, .${P}-cp-toggle--on:hover {
      border-color: #6366f1;
      background: #eef2ff;
      color: #6366f1;
    }
    .${P}-cp-toggle--locked { opacity: 0.45; }
    @media (prefers-color-scheme: dark) {
      .${P}-cp-toggle { border-color: #2d2d44; color: #9ca3af; }
      .${P}-cp-toggle--on, .${P}-cp-toggle--on:hover {
        background: #1e1b4b; border-color: #818cf8; color: #818cf8;
      }
    }
    .${P}-cp-effort-wrap { position: relative; flex-shrink: 0; }
    .${P}-cp-effort {
      min-width: 82px;
      justify-content: space-between;
      padding: 0 8px 0 10px;
    }
    .${P}-cp-effort-chevron {
      display: block;
      flex: 0 0 12px;
      width: 12px;
      height: 8px;
      margin-left: 7px;
      color: currentColor;
      transform: translateY(1px);
      transform-origin: center;
      transition: transform 120ms;
    }
    .${P}-cp-effort--open .${P}-cp-effort-chevron {
      transform: translateY(1px) rotate(180deg);
    }
    .${P}-cp-effort-menu {
      position: absolute;
      right: 0;
      bottom: calc(100% + 8px);
      z-index: 20;
      min-width: 106px;
      padding: 5px;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
      animation: ${P}-effort-menu-in 120ms ease-out;
    }
    @keyframes ${P}-effort-menu-in {
      from { opacity: 0; transform: translateY(4px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .${P}-cp-effort-option {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      height: 28px;
      padding: 0 8px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: #1a1a2e;
      font-family: inherit;
      font-size: 11px;
      text-align: left;
      cursor: pointer;
    }
    .${P}-cp-effort-option:hover,
    .${P}-cp-effort-option--selected {
      background: #eef2ff;
      color: #6366f1;
    }
    .${P}-cp-effort-check { font-size: 13px; font-weight: 700; }
    @media (prefers-color-scheme: dark) {
      .${P}-cp-effort-menu { border-color: #2d2d44; background: #1a1a2e; }
      .${P}-cp-effort-option { color: #e5e7eb; }
      .${P}-cp-effort-option:hover,
      .${P}-cp-effort-option--selected { background: #1e1b4b; color: #818cf8; }
    }
    .${P}-cp-iconbtn {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: #6b7280;
      font-family: inherit;
      font-size: 13px;
      line-height: 1;
      cursor: pointer;
      transition: background 120ms, border-color 120ms;
    }
    .${P}-cp-iconbtn:hover { border-color: #e5e7eb; background: #f7f7fa; }
    @media (prefers-color-scheme: dark) {
      .${P}-cp-iconbtn { color: #9ca3af; }
      .${P}-cp-iconbtn:hover { border-color: #2d2d44; background: #0f0f1a; }
    }
    .${P}-cp-rowend { display: flex; align-items: center; gap: 4px; margin-left: auto; }
    .${P}-cp-pre {
      margin: 4px 0;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(127, 127, 127, 0.12);
      overflow-x: auto;
      font-size: 12px;
      line-height: 1.45;
    }
    .${P}-cp-pre code {
      font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace;
      white-space: pre;
    }
    .${P}-cp-code {
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(127, 127, 127, 0.14);
      font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace;
      font-size: 12px;
    }
    .${P}-cp-resize {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
      opacity: 0;
      transition: opacity 150ms;
    }
    .${P}-cp:hover .${P}-cp-resize { opacity: 1; }
    .${P}-cp-resize::before {
      content: "";
      position: absolute;
      right: 3px;
      bottom: 3px;
      width: 9px;
      height: 9px;
      border-right: 2px solid #9ca3af;
      border-bottom: 2px solid #9ca3af;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Render whitelist markdown into real DOM nodes. Mirrors the popup's
 * ChatRichText: model output only ever becomes text content, never markup.
 */
function renderMarkdown(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const block of parseChatMarkdown(text)) {
    if (block.type === "codeblock") {
      const pre = document.createElement("pre");
      pre.className = `${P}-cp-pre`;
      const code = document.createElement("code");
      code.textContent = block.content;
      pre.appendChild(code);
      frag.appendChild(pre);
      continue;
    }
    const span = document.createElement("span");
    for (const s of block.spans) {
      if (s.type === "code") {
        const el = document.createElement("code");
        el.className = `${P}-cp-code`;
        el.textContent = s.content;
        span.appendChild(el);
      } else if (s.type === "bold") {
        const el = document.createElement("strong");
        el.textContent = s.content;
        span.appendChild(el);
      } else {
        span.appendChild(document.createTextNode(s.content));
      }
    }
    frag.appendChild(span);
  }
  return frag;
}

function button(
  cls: string,
  label: string,
  title: string,
  onClick: () => void
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = cls;
  btn.title = title;
  btn.innerHTML = label;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

/** Custom reasoning menu; native selects ignore the panel's visual language. */
function createEffortMenu(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = `${P}-cp-effort-wrap`;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = `${P}-cp-toggle ${P}-cp-effort ${P}-cp-effort-trigger`;
  trigger.title = t(lang, "chat.effortHint");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const triggerLabel = document.createElement("span");
  const triggerChevron = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg"
  );
  triggerChevron.classList.add(`${P}-cp-effort-chevron`);
  triggerChevron.setAttribute("viewBox", "0 0 12 8");
  triggerChevron.setAttribute("aria-hidden", "true");
  triggerChevron.setAttribute("focusable", "false");
  const chevronPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  );
  chevronPath.setAttribute("d", "M1.5 2 6 6 10.5 2");
  chevronPath.setAttribute("fill", "none");
  chevronPath.setAttribute("stroke", "currentColor");
  chevronPath.setAttribute("stroke-width", "1.8");
  chevronPath.setAttribute("stroke-linecap", "round");
  chevronPath.setAttribute("stroke-linejoin", "round");
  triggerChevron.append(chevronPath);
  trigger.append(triggerLabel, triggerChevron);

  const menu = document.createElement("div");
  menu.className = `${P}-cp-effort-menu`;
  menu.setAttribute("role", "listbox");
  menu.style.display = "none";

  const options: HTMLButtonElement[] = [];
  const renderMenu = () => {
    triggerLabel.textContent = effort;
    trigger.setAttribute("aria-expanded", String(menu.style.display !== "none"));
    options.forEach((option) => {
      const selected = option.dataset.effort === effort;
      option.setAttribute("aria-selected", String(selected));
      option.classList.toggle(`${P}-cp-effort-option--selected`, selected);
      const check = option.querySelector(`.${P}-cp-effort-check`);
      if (check) check.textContent = selected ? "✓" : "";
    });
  };
  refreshEffortMenu = renderMenu;
  const setOpen = (open: boolean) => {
    menu.style.display = open ? "block" : "none";
    trigger.classList.toggle(`${P}-cp-effort--open`, open);
    renderMenu();
  };

  CHAT_EFFORTS.forEach((level) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = `${P}-cp-effort-option`;
    option.dataset.effort = level;
    option.setAttribute("role", "option");

    const label = document.createElement("span");
    label.textContent = level;
    const check = document.createElement("span");
    check.className = `${P}-cp-effort-check`;
    option.append(label, check);
    option.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      effort = level;
      chrome.storage.session
        ?.set({ [CHAT_EFFORT_SESSION_KEY]: effort })
        .catch(() => {});
      setOpen(false);
      renderFooter();
    });
    options.push(option);
    menu.appendChild(option);
  });

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(menu.style.display === "none");
  });

  const onOutside = (event: MouseEvent) => {
    if (!wrap.contains(event.target as Node)) setOpen(false);
  };
  document.addEventListener("mousedown", onOutside);
  cleanupFns.push(() => document.removeEventListener("mousedown", onOutside));

  wrap.append(trigger, menu);
  renderMenu();
  return wrap;
}

/** Redraw the message list from current state. */
function renderList(): void {
  if (!panel) return;
  const list = panel.querySelector(`.${P}-cp-list`) as HTMLElement | null;
  if (!list) return;

  const stuckToBottom =
    list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.textContent = "";

  if (turns.length === 0 && !pending && !streamText) {
    const empty = document.createElement("div");
    empty.className = `${P}-cp-empty`;
    empty.textContent = t(lang, "chat.empty");
    list.appendChild(empty);
  }

  // Only the newest assistant reply is regenerable — matches the service's
  // slicing, which always re-answers the last question.
  let lastAssistant = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === "assistant") {
      lastAssistant = i;
      break;
    }
  }

  turns.forEach((turn, i) => {
    const bubble = document.createElement("div");
    bubble.className =
      turn.role === "user"
        ? `${P}-cp-bubble ${P}-cp-bubble--user`
        : turn.error
          ? `${P}-cp-bubble ${P}-cp-bubble--error`
          : `${P}-cp-bubble ${P}-cp-bubble--assistant`;

    if (turn.webSearch) {
      const chip = document.createElement("div");
      chip.className = `${P}-cp-chip`;
      chip.textContent = `🌐 ${t(lang, "chat.webSearchUsed")}`;
      bubble.appendChild(chip);
    }
    if (turn.attachment || turn.pageContextUsed) {
      if (turn.attachment) {
      const chip = document.createElement("div");
      chip.className = `${P}-cp-chip`;
      chip.title = turn.attachment.title || turn.attachment.url;
      chip.textContent = `📎 ${
        turn.attachment.selected
          ? t(lang, "chat.attachSelection")
          : turn.attachment.title || t(lang, "chat.attachPage")
      }`;
      bubble.appendChild(chip);
      }
      if (turn.pageContextUsed) {
        const supplementChip = document.createElement("div");
        supplementChip.className = `${P}-cp-chip`;
        supplementChip.textContent = `＋ ${t(lang, "chat.pageContextUsed")}`;
        bubble.appendChild(supplementChip);
      }
    }

    if (turn.role === "assistant" && !turn.error) {
      bubble.appendChild(renderMarkdown(turn.content));

      if (turn.ungroundedSearchFallback) {
        const note = document.createElement("div");
        note.className = `${P}-cp-note`;
        note.textContent = t(lang, "chat.searchNoResultsFallback");
        bubble.appendChild(note);
      }

      if (turn.sources && turn.sources.length > 0) {
        const box = document.createElement("div");
        box.className = `${P}-cp-sources`;
        turn.sources.forEach((source, n) => {
          const a = document.createElement("a");
          a.className = `${P}-cp-source`;
          a.href = source.url;
          a.target = "_blank";
          a.rel = "noreferrer noopener";
          a.title = source.snippet || source.url;
          const idx = document.createElement("span");
          idx.textContent = String(n + 1);
          const label = document.createElement("span");
          label.textContent = source.title;
          a.append(idx, label);
          box.appendChild(a);
        });
        bubble.appendChild(box);
      }
    } else {
      bubble.appendChild(document.createTextNode(turn.content));
    }

    // Copy / regenerate on the newest assistant reply (errors included, so a
    // failed answer can be retried in place).
    if (turn.role === "assistant" && i === lastAssistant && !pending) {
      const acts = document.createElement("div");
      acts.className = `${P}-cp-acts`;
      acts.appendChild(
        button(
          `${P}-cp-act`,
          `${ICON_COPY}<span>${t(lang, "popup.copy")}</span>`,
          t(lang, "popup.copy"),
          () => {
            void navigator.clipboard.writeText(turn.content).catch(() => {});
          }
        )
      );
      acts.appendChild(
        button(
          `${P}-cp-act`,
          `${ICON_REGEN}<span>${t(lang, "chat.regenerate")}</span>`,
          t(lang, "chat.regenerate"),
          () => void regenerate()
        )
      );
      bubble.appendChild(acts);
    }

    list.appendChild(bubble);
  });

  if (streamText) {
    const bubble = document.createElement("div");
    bubble.className = `${P}-cp-bubble ${P}-cp-bubble--assistant`;
    bubble.appendChild(renderMarkdown(streamText));
    const caret = document.createElement("span");
    caret.className = `${P}-cp-caret`;
    bubble.appendChild(caret);
    list.appendChild(bubble);
  } else if (pending) {
    const bubble = document.createElement("div");
    bubble.className = `${P}-cp-bubble ${P}-cp-bubble--assistant ${P}-cp-bubble--thinking`;
    const spin = document.createElement("div");
    spin.className = `${P}-cp-spin`;
    const label = document.createElement("span");
    label.textContent =
      phase === "searching" ? t(lang, "chat.searching") : t(lang, "chat.thinking");
    bubble.append(spin, label);
    list.appendChild(bubble);
  }

  if (stuckToBottom) list.scrollTop = list.scrollHeight;
}

/** Redraw the composer area (error, attachment chip, button states). */
function renderFooter(): void {
  if (!panel) return;

  const errBox = panel.querySelector(`.${P}-cp-err`) as HTMLElement | null;
  if (errBox) {
    errBox.textContent = errorText ? `⚠ ${errorText}` : "";
    errBox.style.display = errorText ? "block" : "none";
  }

  const chip = panel.querySelector(`.${P}-cp-attach`) as HTMLElement | null;
  const chipLabel = panel.querySelector(
    `.${P}-cp-attach-label`
  ) as HTMLElement | null;
  if (chip && chipLabel) {
    chip.style.display = attachment ? "flex" : "none";
    if (attachment) {
      chip.title = attachment.title || attachment.url;
      chipLabel.textContent = `📎 ${t(lang, "chat.attachChip", {
        label: attachment.selected
          ? t(lang, "chat.attachSelection")
          : attachment.title || t(lang, "chat.attachPage"),
        n: attachment.text.length,
      })}`;
    } else {
      supplementPage = false;
    }
  }

  const attachBtn = panel.querySelector(`.${P}-cp-rowend`) as HTMLElement | null;
  if (attachBtn) attachBtn.style.display = attachment ? "none" : "flex";

  const supplement = panel.querySelector(
    `.${P}-cp-supplement`
  ) as HTMLButtonElement | null;
  if (supplement) {
    const available = !!attachment?.selected;
    supplement.style.display = available ? "inline-flex" : "none";
    supplement.className = [
      `${P}-cp-toggle`,
      `${P}-cp-supplement`,
      supplementPage ? `${P}-cp-toggle--on` : "",
    ]
      .filter(Boolean)
      .join(" ");
    supplement.setAttribute("aria-pressed", String(supplementPage));
    supplement.title = t(
      lang,
      supplementPage ? "chat.pageContextOn" : "chat.pageContextOff"
    );
  }

  const input = panel.querySelector(`.${P}-cp-input`) as HTMLTextAreaElement | null;
  const send = panel.querySelector(`.${P}-cp-send`) as HTMLButtonElement | null;
  if (send) {
    send.disabled = pending || !(input?.value.trim());
    send.textContent = pending ? t(lang, "chat.thinking") : t(lang, "chat.send");
  }

  const web = panel.querySelector(`.${P}-cp-web-toggle`) as HTMLElement | null;
  if (web) {
    web.className = [
      `${P}-cp-toggle`,
      webSearchOn ? `${P}-cp-toggle--on` : "",
      webSearchAvailable ? "" : `${P}-cp-toggle--locked`,
    ]
      .filter(Boolean)
      .join(" ");
    web.title = t(
      lang,
      webSearchOn
        ? "chat.webSearchOn"
        : webSearchAvailable
          ? "chat.webSearchOff"
          : "chat.webSearchNeedSetup"
    );
  }
}

function render(): void {
  renderList();
  renderFooter();
}

// ---- Requests ----

/** Refresh from the service worker's authoritative state. */
async function refreshState(): Promise<void> {
  try {
    const res = await chrome.runtime.sendMessage({ type: "GET_CHAT_STATE" });
    if (res?.success) {
      turns = res.turns ?? [];
      pending = !!res.pending;
    }
  } catch {
    // Service worker unavailable — keep whatever we have.
  }
}

/**
 * Open a stream port for one exchange. Returns false when the port can't be
 * opened so the caller can fall back to the one-shot message path.
 */
function restoreRetryDraft(draft: ChatRetryDraft, message: string): void {
  const input = panel?.querySelector(`.${P}-cp-input`) as HTMLTextAreaElement | null;
  if (input) {
    input.value = draft.text;
    autoGrow(input);
  }
  attachment = draft.attachment;
  supplementPage = draft.pageSupplement && !!draft.attachment?.selected;
  errorText = message;
  render();
  input?.focus();
}

function sendViaStream(
  payload: Record<string, unknown>,
  retry?: ChatRetryDraft
): boolean {
  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connect({ name: CHAT_STREAM_PORT });
  } catch {
    return false;
  }
  const requestId = `panel-${Date.now().toString(36)}-${++streamSeq}`;
  let finished = false;

  port.onMessage.addListener((event: ChatStreamEvent) => {
    if (event.requestId && event.requestId !== requestId) return;

    if (event.type === "phase") {
      phase = event.phase;
      renderList();
      return;
    }
    if (event.type === "delta") {
      phase = "answering";
      streamText += event.text;
      renderList();
      return;
    }

    // done — sync the persisted turn in before dropping the live bubble, so
    // the reply never flickers out of view between the two states.
    finished = true;
    void refreshState()
      .then(() => {
        phase = null;
        streamText = "";
        if (
          !event.success &&
          !event.appended &&
          event.errorCode !== "CHAT_CANCELLED"
        ) {
          if (retry) {
            restoreRetryDraft(retry, event.error || t(lang, "chat.failed"));
          } else if (event.error) {
            errorText = event.error;
          }
        }
        if (!retry || event.success || event.appended || event.errorCode === "CHAT_CANCELLED") {
          render();
        }
      })
      .finally(() => {
        try {
          port.disconnect();
        } catch {
          // ignore
        }
      });
  });

  port.onDisconnect.addListener(() => {
    // Service worker died mid-stream. The next start resets the stuck pending
    // flag; just resync.
    if (finished) return;
    finished = true;
    phase = null;
    streamText = "";
    void refreshState().then(render);
  });

  try {
    port.postMessage({
      type: "CHAT_STREAM",
      payload: { ...payload, requestId },
    });
  } catch {
    try {
      port.disconnect();
    } catch {
      // ignore
    }
    return false;
  }
  return true;
}

async function send(): Promise<void> {
  const input = panel?.querySelector(`.${P}-cp-input`) as HTMLTextAreaElement | null;
  const text = input?.value.trim() || "";
  if (!text || pending) return;

  const attach = attachment;
  let pageContext: ExtractedPageContext | null = null;
  if (supplementPage && attachment?.selected) {
    try {
      const page = extractPageContext({ includeSelection: false });
      if (page.text.trim()) {
        pageContext = page;
      } else {
        errorText = t(lang, "chat.attachFailed");
        renderFooter();
        return;
      }
    } catch {
      errorText = t(lang, "chat.attachFailed");
      renderFooter();
      return;
    }
  }
  supplementPage = false;
  errorText = "";
  attachment = null;
  streamText = "";
  pending = true;
  phase = webSearchOn ? "searching" : "answering";
  if (input) {
    input.value = "";
    autoGrow(input);
  }

  // Optimistic user bubble: storage confirms it a moment later.
  const optimistic: ChatTurn = { role: "user", content: text, ts: Date.now() };
  if (attach) optimistic.attachment = attach;
  if (pageContext) optimistic.pageContextUsed = true;
  if (webSearchOn) optimistic.webSearch = true;
  turns = [...turns, optimistic];
  render();

  const payload: Record<string, unknown> = {
    text,
    webSearch: webSearchOn,
    effort,
  };
  if (attach) payload.attachment = attach;
  if (pageContext) payload.pageContext = pageContext;

  const retry: ChatRetryDraft = {
    text,
    attachment: attach,
    pageSupplement: !!pageContext,
  };

  if (sendViaStream(payload, retry)) return;

  // Fallback: one-shot message when the port could not be opened.
  let retryError = "";
  try {
    const res = await chrome.runtime.sendMessage({
      type: "CHAT_MESSAGE",
      payload,
    });
    if (res && !res.success && !res.appended) {
      retryError = res.error || t(lang, "chat.failed");
    }
  } catch {
    retryError = t(lang, "popup.connectFail");
  }
  await refreshState();
  pending = false;
  phase = null;
  if (retryError) {
    restoreRetryDraft(retry, retryError);
  } else {
    render();
  }
}

async function regenerate(): Promise<void> {
  if (pending) return;
  errorText = "";
  streamText = "";
  pending = true;
  phase = "answering";
  render();

  if (sendViaStream({ text: "", regenerate: true, effort })) return;

  try {
    const res = await chrome.runtime.sendMessage({
      type: "REGENERATE_CHAT",
      payload: { effort },
    });
    if (res && !res.success && !res.appended) {
      errorText = res.error || t(lang, "chat.failed");
    }
  } catch {
    errorText = t(lang, "popup.connectFail");
  }
  await refreshState();
  pending = false;
  phase = null;
  render();
}

function clearChat(): void {
  errorText = "";
  streamText = "";
  phase = null;
  attachment = null;
  supplementPage = false;
  chrome.runtime
    .sendMessage({ type: "CLEAR_CHAT" })
    .then(() => refreshState())
    .then(render)
    .catch(() => {});
}

function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight + 2, 110)}px`;
}

// ---- Panel lifecycle ----

function resetTransientState(): void {
  streamText = "";
  phase = null;
  errorText = "";
  refreshEffortMenu = null;
}

function detachPanel(): void {
  for (const fn of cleanupFns) fn();
  cleanupFns = [];
  panel?.remove();
  panel = null;
  resetTransientState();
}

function restoreEmbeddedMount(mount: EmbeddedMount): void {
  mount.root?.remove();
  for (const child of mount.hiddenChildren) {
    child.element.style.display = child.display;
  }
  if (mount.originalStyle === null) mount.host.removeAttribute("style");
  else mount.host.setAttribute("style", mount.originalStyle);
  mount.host.className = mount.originalClassName;
}

function leaveEmbeddedChat(restore: boolean): void {
  const mount = embeddedMount;
  if (!mount) return;
  embeddedMount = null;
  detachPanel();
  if (restore) {
    restoreEmbeddedMount(mount);
    mount.onBack();
  } else {
    restoreEmbeddedMount(mount);
    mount.onClose();
  }
}

export function returnFromEmbeddedChat(): void {
  leaveEmbeddedChat(true);
}

export function closeChatPanel(): void {
  if (embeddedMount) {
    leaveEmbeddedChat(false);
    return;
  }
  detachPanel();
}

/**
 * Open the in-page chat panel. `selectionText` (from the selection bubble)
 * becomes the attachment; otherwise the page's readable content is attached
 * automatically when the user has that setting on. `anchor` is a viewport rect
 * to open beside — normally the selection, so the panel lands where the user
 * is already looking instead of in a far corner.
 */
export async function openChatPanel(
  selectionText?: string,
  anchor?: AnchorRect
): Promise<void> {
  // A request from another entry point replaces an embedded view rather than
  // trying to position that view as if it were a fixed panel.
  if (embeddedMount) leaveEmbeddedChat(false);

  // Already open: re-seed the selection and move back beside it.
  if (panel) {
    if (selectionText?.trim()) {
      attachment = {
        title: document.title || "",
        url: location.href,
        selected: true,
        text: selectionText.trim().slice(0, 4000),
      };
      supplementPage = false;
      renderFooter();
    }
    if (anchor) positionPanel(panel, anchor);
    focusInput();
    return;
  }

  injectStyles();
  await prepareChatPanel(selectionText);
  await refreshState();
  buildPanel(anchor);
  render();
  focusInput();
}

export interface EmbeddedChatOptions {
  host: HTMLElement;
  onBack: () => void;
  onClose: () => void;
}

/**
 * Mount the chat view inside an existing translation bubble. The host's
 * children are kept intact and restored when the user returns to translation.
 */
export async function openChatPanelInHost(
  selectionText: string | undefined,
  options: EmbeddedChatOptions
): Promise<void> {
  if (embeddedMount?.host === options.host && panel) {
    if (selectionText?.trim()) {
      attachment = {
        title: document.title || "",
        url: location.href,
        selected: true,
        text: selectionText.trim().slice(0, 4000),
      };
      supplementPage = false;
      renderFooter();
    }
    focusInput();
    return;
  }

  if (embeddedMount) leaveEmbeddedChat(false);
  else if (panel) closeChatPanel();

  injectStyles();
  await prepareChatPanel(selectionText);

  const mount: EmbeddedMount = {
    host: options.host,
    root: null,
    hiddenChildren: Array.from(options.host.children).map((element) => ({
      element: element as HTMLElement,
      display: (element as HTMLElement).style.display,
    })),
    originalStyle: options.host.getAttribute("style"),
    originalClassName: options.host.className,
    onBack: options.onBack,
    onClose: options.onClose,
  };
  embeddedMount = mount;
  for (const child of mount.hiddenChildren) child.element.style.display = "none";
  options.host.classList.add(`${P}-bubble--chat`);

  await refreshState();
  mount.root = buildPanel(undefined, true);
  render();
  focusInput();
}

/** Focus the composer. Split out so TS doesn't narrow `panel` to null from
 * the early-return check at the top of openChatPanel. */
function focusInput(): void {
  const input = panel?.querySelector(`.${P}-cp-input`);
  if (input instanceof HTMLTextAreaElement) input.focus();
}

async function prepareChatPanel(selectionText?: string): Promise<void> {
  // Settings drive the UI language, the auto-attach default and whether the
  // web toggle is unlocked.
  try {
    const settings = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (settings) {
      lang = settings.uiLanguage || lang;
      autoAttachEnabled = settings.chatAutoAttachPage !== false;
      webSearchAvailable = !!settings.chatWebSearchEnabled;
    }
  } catch {
    // Defaults are fine.
  }

  // Per-session toggles, shared with the popup.
  try {
    const session = await chrome.storage.session?.get([
      CHAT_WEB_SEARCH_SESSION_KEY,
      CHAT_EFFORT_SESSION_KEY,
    ]);
    webSearchOn = webSearchAvailable && session?.[CHAT_WEB_SEARCH_SESSION_KEY] === true;
    effort = normalizeChatEffort(session?.[CHAT_EFFORT_SESSION_KEY]);
  } catch {
    // Defaults are fine.
  }

  if (selectionText?.trim()) {
    attachment = {
      title: document.title || "",
      url: location.href,
      selected: true,
      text: selectionText.trim().slice(0, 4000),
    };
    supplementPage = false;
  } else if (autoAttachEnabled) {
    try {
      const ctx = extractPageContext();
      if (ctx.text.trim()) attachment = ctx;
    } catch {
      // Unreadable page — chat still works without context.
    }
  }
}

function buildPanel(anchor?: AnchorRect, embedded = false): HTMLElement {
  const el = document.createElement("div");
  el.className = `${P}-cp${embedded ? ` ${P}-cp-embedded` : ""}`;

  // ---- header ----
  const header = document.createElement("div");
  header.className = `${P}-cp-header`;
  if (embedded) {
    header.appendChild(
      button(`${P}-cp-hbtn ${P}-cp-back`, ICON_BACK, t(lang, "chat.backToTranslation"), returnFromEmbeddedChat)
    );
  }
  const title = document.createElement("span");
  title.className = `${P}-cp-title`;
  title.textContent = t(lang, "chat.panelTitle");
  header.appendChild(title);
  header.appendChild(
    button(`${P}-cp-hbtn`, ICON_TRASH, t(lang, "chat.clear"), clearChat)
  );
  header.appendChild(
    button(`${P}-cp-hbtn`, ICON_SETTINGS, t(lang, "popup.openSettings"), () => {
      chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" }).catch(() => {});
    })
  );
  header.appendChild(
    button(`${P}-cp-hbtn`, ICON_CLOSE, t(lang, "bubble.close"), closeChatPanel)
  );
  el.appendChild(header);

  // ---- message list ----
  const list = document.createElement("div");
  list.className = `${P}-cp-list`;
  el.appendChild(list);

  // ---- footer / composer ----
  const foot = document.createElement("div");
  foot.className = `${P}-cp-foot`;

  const err = document.createElement("div");
  err.className = `${P}-cp-err`;
  err.style.display = "none";
  foot.appendChild(err);

  const chip = document.createElement("div");
  chip.className = `${P}-cp-attach`;
  chip.style.display = "none";
  const chipLabel = document.createElement("span");
  chipLabel.className = `${P}-cp-attach-label`;
  const chipX = button(`${P}-cp-attach-x`, "✕", t(lang, "chat.attachRemove"), () => {
    attachment = null;
    supplementPage = false;
    renderFooter();
  });
  chip.append(chipLabel, chipX);
  foot.appendChild(chip);

  const input = document.createElement("textarea");
  input.className = `${P}-cp-input`;
  input.rows = 1;
  input.maxLength = 8000;
  input.placeholder = t(lang, "chat.placeholder");
  input.addEventListener("input", () => {
    autoGrow(input);
    renderFooter();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeChatPanel();
      return;
    }
    // Enter sends; Shift+Enter inserts a newline. Skip while composing with an
    // IME — that Enter commits the composition.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    }
    // The panel is a text surface; never let the page act on these keys.
    e.stopPropagation();
  });
  foot.appendChild(input);

  const row = document.createElement("div");
  row.className = `${P}-cp-row`;

  const sendBtn = button(`${P}-cp-send`, t(lang, "chat.send"), t(lang, "chat.send"), () =>
    void send()
  );
  row.appendChild(sendBtn);

  const web = button(
    `${P}-cp-toggle ${P}-cp-web-toggle`,
    `🌐 ${t(lang, "chat.webSearch")}`,
    t(lang, "chat.webSearchOff"),
    () => {
      if (!webSearchAvailable) {
        errorText = t(lang, "chat.webSearchNeedSetup");
        renderFooter();
        return;
      }
      webSearchOn = !webSearchOn;
      chrome.storage.session
        ?.set({ [CHAT_WEB_SEARCH_SESSION_KEY]: webSearchOn })
        .catch(() => {});
      renderFooter();
    }
  );
  row.appendChild(web);

  const supplement = button(
    `${P}-cp-toggle ${P}-cp-supplement`,
    `＋ ${t(lang, "chat.pageContext")}`,
    t(lang, "chat.pageContextOff"),
    () => {
      if (!attachment?.selected) return;
      supplementPage = !supplementPage;
      renderFooter();
    }
  );
  supplement.setAttribute("aria-pressed", "false");
  row.appendChild(supplement);

  row.appendChild(createEffortMenu());

  const attachBtn = button(
    `${P}-cp-iconbtn`,
    "📎",
    t(lang, "chat.attach"),
    () => {
      try {
        const ctx = extractPageContext();
        if (!ctx.text.trim()) throw new Error("empty");
        attachment = ctx;
        errorText = "";
      } catch {
        errorText = t(lang, "chat.attachFailed");
      }
      renderFooter();
      input.focus();
    }
  );

  const end = document.createElement("div");
  end.className = `${P}-cp-rowend`;
  end.appendChild(attachBtn);
  row.appendChild(end);

  foot.appendChild(row);
  el.appendChild(foot);

  const resize = document.createElement("div");
  resize.className = `${P}-cp-resize`;
  resize.title = t(lang, "bubble.resize");
  el.appendChild(resize);

  if (!embedded) {
    el.style.width = `${PANEL_W}px`;
    el.style.height = `${PANEL_H}px`;
    positionPanel(el, anchor);
  }

  const target = embeddedMount?.host;
  (target || document.body).appendChild(el);
  panel = el;

  attachDragAndResize(el, header, resize, !embedded);
  return el;
}

const PANEL_W = 380;
const PANEL_H = 520;

/** A viewport-relative rect to open the panel beside. */
export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Place the panel next to the anchor: right of it if there is room, else left,
 * else pinned to whichever side fits. Vertically centred on the anchor and
 * clamped to the viewport. Without an anchor (e.g. the floating ball), fall
 * back to the bottom-right corner, clear of the ball itself.
 */
function positionPanel(el: HTMLElement, anchor?: AnchorRect): void {
  const w = el.offsetWidth || PANEL_W;
  const h = el.offsetHeight || PANEL_H;
  const margin = 12;
  const maxLeft = Math.max(margin, window.innerWidth - w - margin);
  const maxTop = Math.max(margin, window.innerHeight - h - margin);

  if (!anchor) {
    el.style.left = `${maxLeft}px`;
    el.style.top = `${Math.max(margin, window.innerHeight - h - 90)}px`;
    return;
  }

  const gap = 10;
  const roomRight = window.innerWidth - anchor.right;
  const roomLeft = anchor.left;

  let left: number;
  if (roomRight >= w + gap + margin) {
    left = anchor.right + gap;
  } else if (roomLeft >= w + gap + margin) {
    left = anchor.left - w - gap;
  } else {
    // Neither side fits: sit on the roomier one and let clamping handle it.
    left = roomRight >= roomLeft ? anchor.right + gap : anchor.left - w - gap;
  }

  // Vertically centre on the anchor so the conversation reads at eye level.
  const top = anchor.top + (anchor.bottom - anchor.top) / 2 - h / 2;

  el.style.left = `${Math.min(Math.max(margin, left), maxLeft)}px`;
  el.style.top = `${Math.min(Math.max(margin, top), maxTop)}px`;
}

/** Header drags the panel; the corner grip resizes it. Viewport-clamped. */
function attachDragAndResize(
  el: HTMLElement,
  header: HTMLElement,
  grip: HTMLElement,
  interactive = true
): void {
  let dragging = false;
  let dragDx = 0;
  let dragDy = 0;
  let resizing = false;
  let startW = 0;
  let startH = 0;
  let startX = 0;
  let startY = 0;

  const onMouseMove = (e: MouseEvent) => {
    if (dragging) {
      const x = Math.min(
        Math.max(0, e.clientX - dragDx),
        Math.max(0, window.innerWidth - el.offsetWidth)
      );
      const y = Math.min(
        Math.max(0, e.clientY - dragDy),
        Math.max(0, window.innerHeight - 40)
      );
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      return;
    }
    if (resizing) {
      el.style.width = `${Math.max(300, startW + (e.clientX - startX))}px`;
      el.style.height = `${Math.max(320, startH + (e.clientY - startY))}px`;
    }
  };

  const onMouseUp = () => {
    if (!dragging && !resizing) return;
    dragging = false;
    resizing = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  header.addEventListener("mousedown", (e) => {
    if (!interactive) return;
    if ((e.target as HTMLElement).closest(`.${P}-cp-hbtn`)) return;
    dragging = true;
    const rect = el.getBoundingClientRect();
    dragDx = e.clientX - rect.left;
    dragDy = e.clientY - rect.top;
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  grip.addEventListener("mousedown", (e) => {
    if (!interactive) return;
    resizing = true;
    const rect = el.getBoundingClientRect();
    startW = rect.width;
    startH = rect.height;
    startX = e.clientX;
    startY = e.clientY;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "nwse-resize";
    e.preventDefault();
    e.stopPropagation();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && panel) closeChatPanel();
  };

  // The service worker owns the conversation; follow its writes so the popup
  // and this panel never disagree about what was said.
  const onStorage = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ) => {
    if (area !== "session") return;
    let shouldRender = false;
    const chatChange = changes[CHAT_STORAGE_KEY];
    if (chatChange) {
      const next = chatChange.newValue as ChatState | undefined;
      turns = next?.turns ?? [];
      pending = !!next?.pending;
      shouldRender = true;
    }
    const effortChange = changes[CHAT_EFFORT_SESSION_KEY];
    if (effortChange) {
      effort = normalizeChatEffort(effortChange.newValue);
      refreshEffortMenu?.();
      shouldRender = true;
    }
    const webSearchChange = changes[CHAT_WEB_SEARCH_SESSION_KEY];
    if (webSearchChange) {
      webSearchOn = webSearchAvailable && webSearchChange.newValue === true;
      shouldRender = true;
    }
    if (shouldRender) render();
  };

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("keydown", onKey);
  chrome.storage.onChanged.addListener(onStorage);

  cleanupFns.push(() => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    document.removeEventListener("keydown", onKey);
    chrome.storage.onChanged.removeListener(onStorage);
  });
}
