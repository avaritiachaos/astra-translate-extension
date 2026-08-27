import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_PROVIDER_PRESETS, SUPPORTED_LANGUAGES } from "../shared/constants";
import { switchProviderSettings } from "../shared/storage";
import { t, type UiLanguage } from "../shared/i18n";
import type {
  AstraSettings,
  ChatAttachment,
  ChatImageAttachment,
  ChatState,
  ChatStreamEvent,
  ChatStreamPhase,
  ChatTurn,
  TranslationHistoryEntry,
  LiveSubtitleHistoryItem,
  LiveTranslateState,
} from "../shared/types";

import {
  CHAT_EFFORT_SESSION_KEY,
  CHAT_STORAGE_KEY,
  CHAT_STREAM_PORT,
  CHAT_WEB_SEARCH_SESSION_KEY,
  POPUP_MODE_STORAGE_KEY,
} from "../shared/types";
import { parseChatMarkdown } from "../shared/chatMarkdown";
import {
  getChatEffortsForProvider,
  normalizeChatEffort,
  DEFAULT_CHAT_EFFORT,
  type ChatEffort,
} from "../shared/chatEffort";
import { extractPageContext } from "../shared/pageExtract";
import {
  processImageFile,
  extractImagesFromDataTransfer,
  MAX_IMAGES_PER_TURN,
} from "../shared/imageUtils";
import { isVisionCapable } from "../shared/modelCapability";
import "./popup.css";

/** Whitelist markdown for assistant replies: fenced code, inline code, bold.
 * Tokens map to React elements — model output can never inject markup. */
function ChatRichText({ text }: { text: string }): React.ReactElement {
  return (
    <>
      {parseChatMarkdown(text).map((block, i) =>
        block.type === "codeblock" ? (
          <pre key={i} className="ast-chat-pre">
            <code>{block.content}</code>
          </pre>
        ) : (
          <span key={i}>
            {block.spans.map((span, j) =>
              span.type === "code" ? (
                <code key={j} className="ast-chat-code">
                  {span.content}
                </code>
              ) : span.type === "bold" ? (
                <strong key={j}>{span.content}</strong>
              ) : (
                <React.Fragment key={j}>{span.content}</React.Fragment>
              )
            )}
          </span>
        )
      )}
    </>
  );
}

interface ChatEffortMenuProps {
  value: ChatEffort;
  providerId?: string;
  lang: UiLanguage;
  onChange: (value: ChatEffort) => void;
}

function ChatEffortMenu({
  value,
  providerId,
  lang,
  onChange,
}: ChatEffortMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const efforts = getChatEffortsForProvider(providerId);
  const selectedIndex = Math.max(0, efforts.indexOf(value));

  const focusOption = useCallback((index: number) => {
    const options = rootRef.current?.querySelectorAll<HTMLButtonElement>(
      ".ast-chat-effort-option"
    );
    options?.[Math.max(0, Math.min(index, options.length - 1))]?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>(
          ".ast-chat-effort-trigger"
        )?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (next: ChatEffort) => {
    onChange(next);
    setOpen(false);
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((current) => !current);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      window.setTimeout(() => {
        focusOption(
          event.key === "ArrowDown" ? selectedIndex : selectedIndex - 1
        );
      }, 0);
    }
  };

  const onOptionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
    level: ChatEffort
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(level);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(index + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(event.key === "Home" ? 0 : efforts.length - 1);
    }
  };

  return (
    <div className="ast-chat-effort-wrap" ref={rootRef}>
      <button
        type="button"
        className={`ast-chat-pill ast-chat-effort ast-chat-effort-trigger ${open ? "ast-chat-effort--open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t(lang, "chat.effortHint")}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        <span>{value}</span>
        <svg
          className="ast-chat-effort-chevron"
          viewBox="0 0 12 8"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M1.5 2 6 6 10.5 2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="ast-chat-effort-menu" role="listbox" aria-label="Reasoning mode">
          {efforts.map((level, index) => (
            <button
              key={level}
              type="button"
              role="option"
              aria-selected={level === value}
              className={`ast-chat-effort-option ${level === value ? "ast-chat-effort-option--selected" : ""}`}
              onClick={() => choose(level)}
              onKeyDown={(event) => onOptionKeyDown(event, index, level)}
            >
              <span>{level}</span>
              {level === value && <span className="ast-chat-effort-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function getModelDisplayLabel(providerId?: string, model?: string): string {
  const norm = (model || "").toLowerCase();
  if (providerId === "google-gemini") {
    if (!model || norm.includes("3.7")) return "Gemini 3.7";
    if (norm.includes("3.5")) return "Gemini 3.5";
    if (norm.includes("2.5")) return "Gemini 2.5";
    if (norm.includes("2.0")) return "Gemini 2.0";
    if (norm.includes("1.5")) return "Gemini 1.5";
    if (norm.includes("gemini")) return "Gemini";
    return model;
  }
  if (providerId === "deepseek") {
    if (!model || norm.includes("v4") || norm.includes("flash")) return "DeepSeek V4";
    if (norm.includes("chat") || norm.includes("v3")) return "DeepSeek V3";
    if (norm.includes("reasoner") || norm.includes("r1")) return "DeepSeek R1";
    return "DeepSeek";
  }
  if (model) {
    if (norm.includes("gpt-4o-mini")) return "GPT-4o mini";
    if (norm.includes("gpt-4o")) return "GPT-4o";
    if (norm.includes("claude-3-5-sonnet") || norm.includes("claude-sonnet-3-5")) return "Sonnet 3.5";
    if (norm.includes("claude-3-7-sonnet") || norm.includes("claude-sonnet-3-7")) return "Sonnet 3.7";
    if (norm.includes("claude")) return "Claude";
    if (norm.includes("qwen")) return "Qwen";
  }
  return model || "Custom";
}

interface ChatModelMenuProps {
  settings: AstraSettings | null;
  lang: UiLanguage;
  onSwitch: (presetId: string) => void;
  onOpenSettings: () => void;
}

function ChatModelMenu({
  settings,
  lang,
  onSwitch,
  onOpenSettings,
}: ChatModelMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const currentProviderId = settings?.providerId || "deepseek";
  const currentModel =
    settings?.model ||
    DEFAULT_PROVIDER_PRESETS.find((p) => p.id === currentProviderId)?.defaultModel ||
    currentProviderId;

  const displayModelLabel = getModelDisplayLabel(currentProviderId, currentModel);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="ast-chat-model-wrap" ref={rootRef}>
      <button
        type="button"
        className={`ast-chat-pill ast-chat-model ${open ? "ast-chat-pill--on" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${t(lang, "chat.switchModel")}: ${currentModel}`}
        onClick={() => setOpen((current) => !current)}
      >
        <svg
          className="ast-chat-model-icon"
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
          aria-hidden="true"
        >
          <path
            d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"
            fill="currentColor"
            fillOpacity="0.18"
          />
        </svg>
        <span className="ast-chat-model-text">{displayModelLabel}</span>
        <svg
          className="ast-chat-effort-chevron"
          style={{ marginLeft: 2 }}
          viewBox="0 0 12 8"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M1.5 2 6 6 10.5 2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          className="ast-chat-model-menu"
          role="listbox"
          aria-label={t(lang, "chat.switchModel")}
        >
          <div className="ast-chat-model-header">{t(lang, "chat.switchModel")}</div>
          {DEFAULT_PROVIDER_PRESETS.map((preset) => {
            const isSelected = preset.id === currentProviderId;
            const savedConfig = settings?.providerConfigs?.[preset.id];
            const activeModel = isSelected
              ? settings?.model
              : savedConfig?.model || preset.defaultModel || "";
            const hasKey = isSelected ? !!settings?.apiKey : !!savedConfig?.apiKey;
            const displaySub = getModelDisplayLabel(preset.id, activeModel);

            const isVision = isVisionCapable(preset.id, activeModel);

            return (
              <button
                key={preset.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`ast-chat-model-option ${
                  isSelected ? "ast-chat-model-option--selected" : ""
                }`}
                onClick={() => {
                  onSwitch(preset.id);
                  setOpen(false);
                }}
              >
                <div className="ast-chat-model-info">
                  <div className="ast-chat-model-name">
                    {preset.name}
                    <span
                      className={`ast-chat-model-cap-badge ast-chat-model-cap-badge--${
                        isVision ? "vision" : "text"
                      }`}
                    >
                      {t(lang, isVision ? "chat.badgeVision" : "chat.badgeText")}
                    </span>
                    {!hasKey && (
                      <span
                        className="ast-chat-model-badge"
                        title={t(lang, "chat.modelNoKey")}
                      >
                        {t(lang, "chat.modelNoKey")}
                      </span>
                    )}
                  </div>
                  {activeModel && <div className="ast-chat-model-sub">{displaySub} · {activeModel}</div>}
                </div>
                {isSelected && <span className="ast-chat-effort-check">✓</span>}
              </button>
            );
          })}
          <div className="ast-chat-model-footer">
            <button
              type="button"
              className="ast-chat-model-manage-btn"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <span>⚙️</span>
              <span>{t(lang, "chat.manageProviders")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type PopupMode = "translate" | "chat" | "live";

export default function Popup() {
  const [settings, setSettings] = useState<AstraSettings | null>(null);
  const [sourceLang, setSourceLang] = useState("Auto");
  const [targetLang, setTargetLang] = useState("Simplified Chinese");
  const [pageTargetLang, setPageTargetLang] = useState("Simplified Chinese");
  const [inputText, setInputText] = useState("");
  const [result, setResult] = useState("");
  const [resolvedLang, setResolvedLang] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pageStatus, setPageStatus] = useState<string>("");
  const [toast, setToast] = useState("");
  const [langSaved, setLangSaved] = useState(false);
  const [pageLangSaved, setPageLangSaved] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<TranslationHistoryEntry[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ---- Live Subtitle mode state ----
  const [liveState, setLiveState] = useState<LiveTranslateState>({
    running: false,
    status: "idle",
    message: "",
  });
  const [liveHistory, setLiveHistory] = useState<LiveSubtitleHistoryItem[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);

  // ---- Chat mode state ----
  const [mode, setMode] = useState<PopupMode>("translate");
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [chatPending, setChatPending] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState("");
  /** Current request stage: search first, then streamed model reply. */
  const [chatPhase, setChatPhase] = useState<ChatStreamPhase | null>(null);
  /** Live text of the reply currently streaming in (typewriter bubble). */
  const [streamText, setStreamText] = useState("");
  /** Per-browser-session opt-in for search-then-answer. */
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  /** Per-browser-session thinking effort, shared with the in-page panel. */
  const [chatEffort, setChatEffort] = useState<ChatEffort>(DEFAULT_CHAT_EFFORT);
  /** Page context staged for the next question (chip above the input). */
  const [chatAttach, setChatAttach] = useState<ChatAttachment | null>(null);
  /** Image attachments staged for the next question. */
  const [chatImages, setChatImages] = useState<ChatImageAttachment[]>([]);
  /** Lightbox zoom preview modal. */
  const [lightboxImage, setLightboxImage] = useState<{ url: string; name?: string } | null>(null);
  const chatListRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamReqRef = useRef(0);


  const lang: UiLanguage = settings?.uiLanguage || "zh-CN";

  const loadTranslationHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_TRANSLATION_HISTORY",
      });
      if (response?.success && Array.isArray(response.items)) {
        setHistoryItems(response.items as TranslationHistoryEntry[]);
      }
    } catch {
      // History is auxiliary UI; keep the last loaded list on read failure.
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Load settings on mount
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }).then((s) => {
      if (s) {
        setSettings(s);
        setTargetLang(s.defaultTargetLang || "Simplified Chinese");
        setPageTargetLang(s.pageTargetLang || "Simplified Chinese");
        setChatEffort((prev) => normalizeChatEffort(prev, s.providerId));
      }
    });
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!historyOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".ast-popup-header-actions, #ast-history-panel")) {
        setHistoryOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setHistoryOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [historyOpen]);

  useEffect(() => {
    if (historyOpen) void loadTranslationHistory();
  }, [historyOpen, loadTranslationHistory]);

  const refreshChatState = useCallback(async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "GET_CHAT_STATE" });
      if (res?.success) {
        setChatTurns(res.turns ?? []);
        setChatPending(!!res.pending);
      }
    } catch {
      // Service worker unavailable — keep whatever we have.
    }
  }, []);

  // Chat mode: restore the last-active tab, load the session conversation,
  // and follow service-worker updates via storage events — the SW owns the
  // state, so an answer that finishes while this popup is closed (or open)
  // lands here through storage, not through a message response.
  useEffect(() => {
    chrome.storage.session
      ?.get([
        POPUP_MODE_STORAGE_KEY,
        CHAT_WEB_SEARCH_SESSION_KEY,
        CHAT_EFFORT_SESSION_KEY,
      ])
      .then((r) => {
        if (r?.[CHAT_WEB_SEARCH_SESSION_KEY] === true) setWebSearchEnabled(true);
        setChatEffort(normalizeChatEffort(r?.[CHAT_EFFORT_SESSION_KEY]));
        if (r?.[POPUP_MODE_STORAGE_KEY] === "chat") setMode("chat");
      })
      .catch(() => {});
    refreshChatState();

    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area !== "session") return;
      const chatChange = changes[CHAT_STORAGE_KEY];
      if (chatChange) {
        const next = chatChange.newValue as ChatState | undefined;
        setChatTurns(next?.turns ?? []);
        setChatPending(!!next?.pending);
      }
      const effortChange = changes[CHAT_EFFORT_SESSION_KEY];
      if (effortChange) {
        setChatEffort(normalizeChatEffort(effortChange.newValue));
      }
      const webSearchChange = changes[CHAT_WEB_SEARCH_SESSION_KEY];
      if (webSearchChange) {
        setWebSearchEnabled(webSearchChange.newValue === true);
      }
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, [refreshChatState]);

  // Focus follows the active tab; the chat list sticks to the newest message.
  useEffect(() => {
    (mode === "chat" ? chatInputRef : inputRef).current?.focus();
  }, [mode]);

  useEffect(() => {
    const el = chatListRef.current;
    if (mode === "chat" && el) el.scrollTop = el.scrollHeight;
  }, [mode, chatTurns, chatPending, streamText]);

  // Auto-grow the chat input with its content (1 → ~4 lines), including
  // programmatic changes (send clears it, rejections restore it).
  useEffect(() => {
    const el = chatInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, 120)}px`;
  }, [chatInput, mode]);

  // Persist target language to settings
  const saveTargetLang = useCallback(
    async (lang: string) => {
      if (!settings) return;
      const updated = { ...settings, defaultTargetLang: lang };
      setSettings(updated);
      try {
        await chrome.runtime.sendMessage({
          type: "SAVE_SETTINGS",
          payload: updated,
        });
        setLangSaved(true);
        setTimeout(() => setLangSaved(false), 1200);
      } catch {
        // ignore
      }
    },
    [settings]
  );

  // Persist page translation target language
  const savePageTargetLang = useCallback(
    async (lang: string) => {
      if (!settings) return;
      const updated = { ...settings, pageTargetLang: lang };
      setSettings(updated);
      try {
        await chrome.runtime.sendMessage({
          type: "SAVE_SETTINGS",
          payload: updated,
        });
        setPageLangSaved(true);
        setTimeout(() => setPageLangSaved(false), 1200);
      } catch {
        // ignore
      }
    },
    [settings]
  );

  // Swap languages
  const swapLangs = useCallback(() => {
    if (sourceLang === "Auto") return;
    const tmp = sourceLang;
    setSourceLang(targetLang);
    setTargetLang(tmp);
    saveTargetLang(tmp);
  }, [sourceLang, targetLang, saveTargetLang]);

  // Translate
  const handleTranslate = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;

    setLoading(true);
    setError("");
    setResult("");
    setResolvedLang("");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "TRANSLATE_TEXT",
        payload: {
          text,
          targetLang,
          sourceLang: sourceLang === "Auto" ? undefined : sourceLang,
          mode: "manual",
        },
      });

      if (response?.success) {
        const translation =
          typeof response.translation === "string" ? response.translation.trim() : "";
        if (!translation) {
          setError(t(lang, "error.invalidResponse"));
        } else {
          setResult(translation);
          setResolvedLang(response.resolvedLang || "");
          if (historyOpen) void loadTranslationHistory();
        }
      } else {
        setError(response?.error || t(lang, "error.translationFailed"));
      }
    } catch {
      setError(t(lang, "popup.connectFail"));
    } finally {
      setLoading(false);
    }
  }, [inputText, targetLang, sourceLang, lang, historyOpen, loadTranslationHistory]);

  // Clear
  const handleClear = useCallback(() => {
    setInputText("");
    setResult("");
    setResolvedLang("");
    setError("");
    inputRef.current?.focus();
  }, []);

  // Copy result
  const handleCopy = useCallback(async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    showToast(t(lang, "popup.copied"));
  }, [result, lang]);

  // Show toast
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1500);
  }, []);

  const handleHistorySelect = useCallback((entry: TranslationHistoryEntry) => {
    setMode("translate");
    chrome.storage.session
      ?.set({ [POPUP_MODE_STORAGE_KEY]: "translate" })
      .catch(() => {});
    setInputText(entry.sourceText);
    setResult(entry.translation);
    setResolvedLang(entry.targetLang);
    setSourceLang(entry.sourceLang || "Auto");
    setTargetLang(entry.targetLang);
    setError("");
    setHistoryOpen(false);
    setHistoryQuery("");
    inputRef.current?.focus();
  }, []);

  const handleHistoryClear = useCallback(async () => {
    if (!window.confirm(t(lang, "popup.historyClearConfirm"))) return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "CLEAR_TRANSLATION_HISTORY",
      });
      if (response?.success) {
        setHistoryItems([]);
        setHistoryQuery("");
        showToast(t(lang, "popup.historyClear"));
      }
    } catch {
      // Keep the current list if clearing could not reach the service worker.
    }
  }, [lang, showToast]);

  // Page translate
  const handlePageTranslate = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: "PAGE_TRANSLATE_START" });
        window.close();
      }
    } catch {
      setError(t(lang, "popup.cannotAccess"));
    }
  }, [lang]);

  // Page restore
  const handlePageRestore = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: "PAGE_TRANSLATE_RESTORE" });
        setPageStatus(t(lang, "popup.pageRestored"));
        setTimeout(() => setPageStatus(""), 2000);
      }
    } catch {
      setError(t(lang, "popup.cannotAccess"));
    }
  }, [lang]);

  // Open options
  const openOptions = useCallback(() => {
    chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" });
  }, []);

  const refreshLiveState = useCallback(async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "LIVE_TRANSLATE_GET_STATE" });
      if (res?.state) setLiveState(res.state);
      const hist = await chrome.runtime.sendMessage({ type: "GET_LIVE_SUBTITLE_HISTORY" });
      if (hist?.items) setLiveHistory(hist.items);
    } catch {}
  }, []);

  const handleToggleLive = useCallback(async () => {
    setLiveLoading(true);
    setError("");
    try {
      if (liveState.running) {
        await chrome.runtime.sendMessage({ type: "LIVE_TRANSLATE_STOP" });
        setLiveState({ running: false, status: "idle", message: "已停止" });
      } else {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const res = await chrome.runtime.sendMessage({
          type: "LIVE_TRANSLATE_START",
          payload: { tabId: tab?.id },
        });
        if (!res?.success) {
          setError(res?.error || t(lang, "live.tabCaptureError"));
        } else {
          setLiveState({ running: true, status: "connecting", message: "连接中…" });
        }
      }
      setTimeout(refreshLiveState, 500);
    } catch (err: any) {
      setError(err?.message || "操作失败");
    } finally {
      setLiveLoading(false);
    }
  }, [liveState.running, lang, refreshLiveState]);

  const handleExportLiveSrt = useCallback(() => {
    if (liveHistory.length === 0) return;
    let srtContent = "";
    let idx = 1;
    const baseTime = liveHistory[0].startTime;
    const formatTime = (ms: number) => {
      const totalSec = Math.floor(Math.max(0, ms) / 1000);
      const hours = String(Math.floor(totalSec / 3600)).padStart(2, "0");
      const minutes = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
      const seconds = String(totalSec % 60).padStart(2, "0");
      const millis = String(Math.max(0, ms) % 1000).padStart(3, "0");
      return `${hours}:${minutes}:${seconds},${millis}`;
    };
    for (const item of liveHistory) {
      const startMs = item.startTime - baseTime;
      const endMs = item.endTime ? item.endTime - baseTime : startMs + 3000;
      srtContent += `${idx}\n${formatTime(startMs)} --> ${formatTime(endMs)}\n`;
      if (item.original) srtContent += `${item.original}\n`;
      srtContent += `${item.translation}\n\n`;
      idx++;
    }
    const blob = new Blob([srtContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Astra_LiveSubtitle_${Date.now()}.srt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(t(lang, "opt.glossaryExportDone"));
  }, [liveHistory, lang, showToast]);

  const handleClearLiveHistory = useCallback(async () => {
    await chrome.runtime.sendMessage({ type: "CLEAR_LIVE_SUBTITLE_HISTORY" });
    setLiveHistory([]);
    showToast(t(lang, "live.clearHistory"));
  }, [lang, showToast]);

  const handleLiveTargetLangChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (!settings) return;
      const updated = { ...settings, liveTranslateTargetLang: val };
      setSettings(updated);
      await chrome.runtime.sendMessage({
        type: "SAVE_SETTINGS",
        payload: updated,
      });
      showToast(t(lang, "opt.saved"));
    },
    [settings, lang, showToast]
  );

  const handleToggleLiveShowOriginal = useCallback(async () => {
    if (!settings) return;
    const nextVal = !(settings.liveTranslateShowOriginal !== false);
    const updated = { ...settings, liveTranslateShowOriginal: nextVal };
    setSettings(updated);
    await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      payload: updated,
    });
    showToast(nextVal ? "已开启双语字幕" : "已切换为单译文");
  }, [settings, showToast]);

  const handleCycleLiveOpacity = useCallback(async () => {
    if (!settings) return;
    const current = settings.liveTranslateBgOpacity ?? 80;
    const presets = [80, 50, 20, 95];
    const nextIdx = (presets.indexOf(current) + 1) % presets.length;
    const nextVal = presets[nextIdx];
    const updated = { ...settings, liveTranslateBgOpacity: nextVal };
    setSettings(updated);
    await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      payload: updated,
    });
    showToast(`透明度: ${nextVal}%`);
  }, [settings, showToast]);

  // ---- Chat mode actions ----

  const switchMode = useCallback((next: PopupMode) => {
    setMode(next);
    chrome.storage.session
      ?.set({ [POPUP_MODE_STORAGE_KEY]: next })
      .catch(() => {});
    if (next === "live") {
      void refreshLiveState();
    }
  }, [refreshLiveState]);


  const handleAddImages = useCallback(
    async (files: File[]) => {
      if (chatImages.length + files.length > MAX_IMAGES_PER_TURN) {
        setChatError(t(lang, "chat.imageLimitExceeded", { max: MAX_IMAGES_PER_TURN }));
        return;
      }
      setChatError("");
      const processed: ChatImageAttachment[] = [];
      for (const file of files) {
        try {
          const img = await processImageFile(file);
          processed.push(img);
        } catch {
          // ignore
        }
      }
      setChatImages((prev) => [...prev, ...processed]);
      chatInputRef.current?.focus();
    },
    [chatImages.length, lang]
  );

  const handleCaptureScreenshot = useCallback(async () => {
    if (chatImages.length >= MAX_IMAGES_PER_TURN) {
      setChatError(t(lang, "chat.imageLimitExceeded", { max: MAX_IMAGES_PER_TURN }));
      return;
    }
    try {
      const res = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
      if (res?.success && res?.dataUrl) {
        const resBlob = await fetch(res.dataUrl).then((r) => r.blob());
        const img = await processImageFile(resBlob, "tab-screenshot.jpg");
        setChatImages((prev) => [...prev, img]);
        setChatError("");
      } else {
        setChatError(t(lang, "chat.screenshotFailed"));
      }
    } catch {
      setChatError(t(lang, "chat.screenshotFailed"));
    }
  }, [chatImages.length, lang]);

  /** Pre-flight rejection: nothing entered the conversation — surface the
   * error inline and give the text (and attachment) back for a retry. */
  const handleChatRejection = useCallback(
    (text: string, attach: ChatAttachment | null, images?: ChatImageAttachment[], error?: string) => {
      if (!error) return; // deliberate cancel (clear) — nothing to surface
      setChatError(error);
      setChatInput(text);
      if (attach) setChatAttach(attach);
      if (images && images.length > 0) setChatImages(images);
    },
    []
  );

  /** Streaming send over a dedicated port. Returns false when the port
   * can't be opened so the caller can fall back to the one-shot path.
   * `retry` restores the composer if the request was rejected pre-flight. */
  const sendViaStream = useCallback(
    (
      payload: Record<string, unknown>,
      retry?: { text: string; attach: ChatAttachment | null; images?: ChatImageAttachment[] }
    ): boolean => {
      let port: chrome.runtime.Port;
      try {
        port = chrome.runtime.connect({ name: CHAT_STREAM_PORT });
      } catch {
        return false;
      }
      const requestId = `chat-${Date.now().toString(36)}-${++streamReqRef.current}`;
      let finished = false;

      port.onMessage.addListener((event: ChatStreamEvent) => {
        if (event.requestId && event.requestId !== requestId) return;

        if (event.type === "phase") {
          setChatPhase(event.phase);
          return;
        }

        if (event.type === "delta") {
          setChatPhase("answering");
          setStreamText((prev) => prev + event.text);
          return;
        }

        // done — sync the persisted turn in before dropping the live bubble,
        // so the reply never flickers out of view between the two states.
        finished = true;
        const finish = async () => {
          await refreshChatState();
          setChatPhase(null);
          setStreamText("");
          if (!event.success && !event.appended) {
            if (retry) {
              handleChatRejection(retry.text, retry.attach, retry.images, event.error);
            } else if (event.error) {
              setChatError(event.error);
            }
          }
        };
        void finish().finally(() => {
          try {
            port.disconnect();
          } catch {
            // ignore
          }
        });
      });

      port.onDisconnect.addListener(() => {
        // Service worker died mid-stream (crash — keepalive covers idle).
        // The next SW start resets the stuck pending flag; just resync.
        if (finished) return;
        finished = true;
        setChatPhase(null);
        setStreamText("");
        refreshChatState();
      });

      try {
        port.postMessage({
          type: "CHAT_STREAM",
          payload: { ...payload, requestId },
        });
      } catch {
        finished = true;
        try {
          port.disconnect();
        } catch {
          // ignore
        }
        return false;
      }
      return true;
    },
    [refreshChatState, handleChatRejection]
  );

  const handleChatSend = useCallback(async () => {
    const text = chatInput.trim();
    if ((!text && chatImages.length === 0) || chatPending) return;
    const attach = chatAttach;
    const imagesToSend = chatImages.slice();
    setChatError("");
    setChatInput("");
    setChatAttach(null);
    setChatImages([]);
    setStreamText("");

    const doWebSearch = webSearchEnabled;
    setChatPhase(doWebSearch ? "searching" : "answering");

    const payload: Record<string, unknown> = {
      text,
      webSearch: doWebSearch,
      effort: chatEffort,
    };
    if (attach) payload.attachment = attach;
    if (imagesToSend.length > 0) payload.images = imagesToSend;

    // Prefer streaming; fall back to the one-shot message on port failure.
    if (sendViaStream(payload, { text, attach, images: imagesToSend })) return;

    try {
      const res = await chrome.runtime.sendMessage({
        type: "CHAT_MESSAGE",
        payload,
      });
      if (res && !res.success && !res.appended) {
        handleChatRejection(text, attach, imagesToSend, res.error);
      }
      // Storage events already track the conversation; this refresh only
      // matters for the no-session-storage fallback.
      refreshChatState();
      setChatPhase(null);
    } catch {
      setChatPhase(null);
      setChatError(t(lang, "popup.connectFail"));
      setChatInput(text);
      if (attach) setChatAttach(attach);
      if (imagesToSend.length > 0) setChatImages(imagesToSend);
    }
  }, [
    chatInput,
    chatImages,
    chatPending,
    chatAttach,
    chatEffort,
    lang,
    refreshChatState,
    sendViaStream,
    handleChatRejection,
    webSearchEnabled,
  ]);

  /** Re-answer the last question: the service drops the stale reply and
   * reuses the stored question, attachment and web-search choice. */
  const handleRegenerate = useCallback(async () => {
    if (chatPending) return;
    setChatError("");
    setStreamText("");
    setChatPhase("answering");

    const payload = { text: "", regenerate: true, effort: chatEffort };
    if (sendViaStream(payload)) return;

    try {
      const res = await chrome.runtime.sendMessage({
        type: "REGENERATE_CHAT",
        payload: { effort: chatEffort },
      });
      if (res && !res.success && !res.appended && res.error) {
        setChatError(res.error);
      }
      refreshChatState();
      setChatPhase(null);
    } catch {
      setChatPhase(null);
      setChatError(t(lang, "popup.connectFail"));
    }
  }, [chatPending, chatEffort, lang, refreshChatState, sendViaStream]);

  /** Change the per-session thinking effort (shared with the in-page panel). */
  const handleEffortChange = (next: ChatEffort) => {
    setChatEffort(next);
    chrome.storage.session
      ?.set({ [CHAT_EFFORT_SESSION_KEY]: next })
      .catch(() => {});
  };

  const handleModelSwitch = useCallback(
    async (presetId: string) => {
      if (!settings) return;
      const next = switchProviderSettings(settings, presetId);
      setSettings(next);
      const nextEffort = normalizeChatEffort(chatEffort, presetId);
      setChatEffort(nextEffort);
      try {
        await chrome.runtime.sendMessage({
          type: "SAVE_SETTINGS",
          payload: next,
        });
        await chrome.storage.session?.set({ [CHAT_EFFORT_SESSION_KEY]: nextEffort });
        const preset = DEFAULT_PROVIDER_PRESETS.find((p) => p.id === presetId);
        const displayLabel = getModelDisplayLabel(
          presetId,
          next.model || preset?.defaultModel || ""
        );
        showToast(
          t(lang, "chat.modelSwitched", {
            model: displayLabel,
          })
        );
      } catch {
        showToast(t(lang, "opt.saveFailed"));
      }
    },
    [settings, chatEffort, lang, showToast]
  );

  /** Grab context from the active tab: the selection if any, else the main
   * readable content. Explicit user action — the popup never attaches
   * automatically (the in-page panel does, where the chip is always visible). */
  const handleAttachPage = useCallback(async () => {
    setChatError("");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("no tab");
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageContext,
      });
      const ctx = results?.[0]?.result as ChatAttachment | undefined;
      if (!ctx || !ctx.text.trim()) throw new Error("empty");
      setChatAttach(ctx);
      chatInputRef.current?.focus();
    } catch {
      // chrome:// pages, the Web Store, or an empty page — nothing to grab.
      setChatError(t(lang, "chat.attachFailed"));
    }
  }, [lang]);

  /** Move the conversation into the page itself, where the article is. */
  const handleOpenInPage = useCallback(async () => {
    setChatError("");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("no tab");
      const res = await chrome.runtime.sendMessage({
        type: "OPEN_CHAT_PANEL",
        payload: { tabId: tab.id },
      });
      if (!res?.success) throw new Error("no panel");
      window.close();
    } catch {
      setChatError(t(lang, "chat.openInPageFailed"));
    }
  }, [lang]);

  const handleChatClear = useCallback(() => {
    setChatError("");
    setChatPhase(null);
    setStreamText("");
    setChatAttach(null);
    chrome.runtime
      .sendMessage({ type: "CLEAR_CHAT" })
      .then(() => refreshChatState())
      .catch(() => {});
  }, [refreshChatState]);

  /** Turn built-in web search on or off for this browser session. */
  const toggleWebSearch = useCallback(() => {
    if (!settings?.chatWebSearchEnabled) {
      setChatError(t(lang, "chat.webSearchNeedSetup"));
      return;
    }
    setWebSearchEnabled((enabled) => {
      const next = !enabled;
      chrome.storage.session
        ?.set({ [CHAT_WEB_SEARCH_SESSION_KEY]: next })
        .catch(() => {});
      return next;
    });
    chatInputRef.current?.focus();
  }, [lang, settings]);

  const handleCopyTurn = useCallback(
    async (content: string) => {
      try {
        await navigator.clipboard.writeText(content);
        showToast(t(lang, "popup.copied"));
      } catch {
        // Clipboard permission denied — nothing useful to do.
      }
    },
    [lang, showToast]
  );

  const handleChatKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends; Shift+Enter inserts a newline. Skip while composing
      // with an IME — that Enter commits the composition.
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleChatSend();
      }
    },
    [handleChatSend]
  );

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mode === "chat") {
        // The chat textarea handles Enter itself; only Esc acts globally.
        if (e.key === "Escape") {
          if (chatError) setChatError("");
          else setChatInput("");
        }
        return;
      }
      // Enter in the source box translates; Shift+Enter inserts a newline
      // (default behaviour). Ctrl/Cmd+Enter keeps working for muscle memory.
      // Skip while composing with an IME — that Enter commits the composition.
      const inSourceBox = e.target === inputRef.current;
      const plainEnter =
        e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing;
      if (plainEnter && (inSourceBox || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleTranslate();
      }
      if (e.key === "Escape") {
        if (error) {
          setError("");
        } else {
          handleClear();
        }
      }
    },
    [mode, chatError, handleTranslate, handleClear, error]
  );

  const allLangs = ["Auto", ...SUPPORTED_LANGUAGES];
  const historySearch = historyQuery.trim().toLocaleLowerCase();
  const visibleHistory = historyItems.filter((item) => {
    if (!historySearch) return true;
    return `${item.sourceText}\n${item.translation}\n${item.targetLang}`
      .toLocaleLowerCase()
      .includes(historySearch);
  });

  // Only the newest assistant reply is regenerable — the service always
  // re-answers the last question, so an older ↻ would be a lie.
  let lastAssistantIndex = -1;
  for (let i = chatTurns.length - 1; i >= 0; i--) {
    if (chatTurns[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }

  return (
    <div className="ast-popup-shell" onKeyDown={handleKeyDown}>
      <div className="ast-popup-topbar">
        {/* Header: title · mode segmented control · settings */}
        <div className="ast-popup-header">
          <div className="ast-popup-title">
            <span className="ast-popup-title-brand">{t(lang, "app.name")}</span>
          </div>
          <div className="ast-seg" role="tablist">
            <button
              role="tab"
              aria-selected={mode === "translate"}
              className={`ast-seg-btn ${mode === "translate" ? "ast-seg-btn--active" : ""}`}
              onClick={() => switchMode("translate")}
            >
              <span className="ast-seg-icon">🌐</span>
              <span>{t(lang, "popup.modeTranslate")}</span>
            </button>
            <button
              role="tab"
              aria-selected={mode === "chat"}
              className={`ast-seg-btn ${mode === "chat" ? "ast-seg-btn--active" : ""}`}
              onClick={() => switchMode("chat")}
            >
              <span className="ast-seg-icon">💬</span>
              <span>{t(lang, "popup.modeChat")}</span>
            </button>
            <button
              role="tab"
              aria-selected={mode === "live"}
              className={`ast-seg-btn ${mode === "live" ? "ast-seg-btn--active" : ""}`}
              onClick={() => switchMode("live")}
            >
              <span className="ast-seg-icon">🎙️</span>
              <span>{t(lang, "popup.modeLive")}</span>
            </button>
          </div>

          <div className="ast-popup-header-actions">
            {mode === "chat" && (
              <button
                type="button"
                className="ast-popup-clear-btn"
                onClick={handleChatClear}
                disabled={chatTurns.length === 0 && !chatPending}
                title={t(lang, "chat.clear")}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 6h18" />
                  <path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2" />
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className={`ast-popup-history-btn ${historyOpen ? "ast-popup-history-btn--active" : ""}`}
              onClick={() => setHistoryOpen((open) => !open)}
              aria-expanded={historyOpen}
              aria-pressed={historyOpen}
              aria-controls="ast-history-panel"
              aria-label={t(lang, "popup.historyToggle")}
              title={t(lang, "popup.historyToggle")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 4v6h6" />
                <path d="M12 7v5l3 2" />
              </svg>
            </button>
            <button
              type="button"
              className="ast-popup-settings-btn"
              onClick={openOptions}
              title={t(lang, "popup.openSettings")}
            >
              ⚙
            </button>
          </div>
        </div>

        {historyOpen && (
          <div
            id="ast-history-panel"
            className="ast-history-panel"
            aria-label={t(lang, "popup.history")}
          >
            <div className="ast-history-toolbar">
              <input
                className="ast-history-search"
                type="search"
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder={t(lang, "popup.historySearch")}
                aria-label={t(lang, "popup.historySearch")}
              />
              <button
                type="button"
                className="ast-history-clear"
                onClick={handleHistoryClear}
                disabled={historyItems.length === 0}
              >
                {t(lang, "popup.historyClear")}
              </button>
            </div>
            {historyLoading ? (
              <div className="ast-history-empty">{t(lang, "popup.historyLoading")}</div>
            ) : visibleHistory.length === 0 ? (
              <div className="ast-history-empty">
                {historyItems.length > 0
                  ? t(lang, "popup.historyNoMatch")
                  : t(lang, "popup.historyEmpty")}
              </div>
            ) : (
              <div className="ast-history-list">
                {visibleHistory.map((item) => (
                  <button
                    type="button"
                    className="ast-history-item"
                    key={item.id}
                    onClick={() => handleHistorySelect(item)}
                    title={item.sourceText}
                  >
                    <div className="ast-history-item-meta">
                      <span>{item.targetLang}</span>
                      <time dateTime={new Date(item.createdAt).toISOString()}>
                        {new Date(item.createdAt).toLocaleString(lang)}
                      </time>
                    </div>
                    <div className="ast-history-item-source">{item.sourceText}</div>
                    <div className="ast-history-item-translation">{item.translation}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {mode === "translate" && (
        <>
          {/* Language bar */}
          <div className="ast-lang-bar">
            <select
              className="ast-lang-select"
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
            >
              {allLangs.map((l) => (
                <option key={l} value={l}>
                  {l === "Auto" ? t(lang, "popup.auto") : l}
                </option>
              ))}
            </select>
            <button className="ast-lang-swap" onClick={swapLangs} title="⇄">
              ⇄
            </button>
            <select
              className="ast-lang-select"
              value={targetLang}
              onChange={(e) => {
                const v = e.target.value;
                setTargetLang(v);
                saveTargetLang(v);
              }}
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <span className={`ast-lang-saved ${langSaved ? "ast-lang-saved--show" : ""}`}>
              ✓
            </span>
          </div>

          {/* Input */}
          <div className="ast-input-area">
            <textarea
              ref={inputRef}
              className="ast-input-box"
              placeholder={t(lang, "popup.placeholder")}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              rows={3}
            />
          </div>

          {/* Actions + keyboard hint inline */}
          <div className="ast-actions">
            <button
              className="ast-btn ast-btn-primary"
              onClick={handleTranslate}
              disabled={loading || !inputText.trim()}
            >
              {loading ? t(lang, "popup.translating") : t(lang, "popup.translate")}
            </button>
            <button className="ast-btn ast-btn-secondary" onClick={handleClear}>
              {t(lang, "popup.clear")}
            </button>
            <button
              className="ast-btn ast-btn-secondary"
              onClick={handleCopy}
              disabled={!result}
            >
              {t(lang, "popup.copy")}
            </button>
            <span className="ast-keyboard-hint">{t(lang, "popup.kbHint")}</span>
          </div>

          {/* Error */}
          {error && (
            <div className="ast-error-msg">
              <span>⚠</span>
              <span>{error}</span>
            </div>
          )}

          {/* Result */}
          {(result || loading) && (
            <div className="ast-result-area">
              {loading ? (
                <div className="ast-loading-inline">
                  <div className="ast-spinner-sm" />
                  <span>{t(lang, "popup.translating")}</span>
                </div>
              ) : (
                <>
                  {resolvedLang && (
                    <div className="ast-result-lang-label">
                      {t(lang, "bubble.translatedTo", { lang: resolvedLang })}
                    </div>
                  )}
                  <div className="ast-result-box">{result}</div>
                  {result.trim() === inputText.trim() && result.trim().length > 0 && (
                    <div className="ast-result-hint">
                      {t(lang, "bubble.mayBeIdentifier")}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Page translation */}
          <div className="ast-page-section">
            <div className="ast-page-header">
              <div className="ast-page-title">{t(lang, "popup.pageTranslation")}</div>
              <select
                className="ast-lang-select"
                value={pageTargetLang}
                onChange={(e) => {
                  const v = e.target.value;
                  setPageTargetLang(v);
                  savePageTargetLang(v);
                }}
              >
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <span className={`ast-lang-saved ${pageLangSaved ? "ast-lang-saved--show" : ""}`}>
                ✓
              </span>
            </div>
            <div className="ast-page-actions">
              <button className="ast-btn ast-btn-primary" onClick={handlePageTranslate}>
                {t(lang, "popup.translatePage")}
              </button>
              <button className="ast-btn ast-btn-secondary" onClick={handlePageRestore}>
                {t(lang, "popup.restorePage")}
              </button>
            </div>
            {pageStatus && <div className="ast-page-status">{pageStatus}</div>}
          </div>
        </>
      )}

      {mode === "chat" && (
        <div
          className="ast-chat"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer?.files) {
              const files = extractImagesFromDataTransfer(e.dataTransfer.files);
              if (files.length > 0) void handleAddImages(files);
            }
          }}
        >
          <div className="ast-chat-list" ref={chatListRef}>
            {chatTurns.length === 0 && !chatPending && !streamText && (
              <div className="ast-chat-empty">{t(lang, "chat.empty")}</div>
            )}
            {chatTurns.map((turn, i) => (
              <div
                key={`${turn.ts}-${i}`}
                className={
                  turn.role === "user"
                    ? "ast-chat-bubble ast-chat-bubble--user"
                    : turn.error
                      ? "ast-chat-bubble ast-chat-bubble--error"
                      : "ast-chat-bubble ast-chat-bubble--assistant"
                }
              >
                {turn.webSearch && (
                  <div className="ast-chat-bubble-search">🌐 {t(lang, "chat.webSearchUsed")}</div>
                )}
                {(turn.attachment || turn.pageContextUsed) && (
                  <>
                    {turn.attachment && (
                      <div
                        className="ast-chat-bubble-attach"
                        title={turn.attachment.title || turn.attachment.url}
                      >
                        📎{" "}
                        {turn.attachment.selected
                          ? t(lang, "chat.attachSelection")
                          : turn.attachment.title || t(lang, "chat.attachPage")}
                      </div>
                    )}
                    {turn.pageContextUsed && (
                      <div className="ast-chat-bubble-attach">
                        ＋ {t(lang, "chat.pageContextUsed")}
                      </div>
                    )}
                  </>
                )}
                {turn.images && turn.images.length > 0 && (
                  <div className="ast-chat-img-grid">
                    {turn.images.map((img) => (
                      <img
                        key={img.id}
                        className="ast-chat-turn-img"
                        src={img.dataUrl}
                        alt={img.name || "image"}
                        title={`${img.name || "image"}${
                          img.width && img.height ? ` (${img.width}x${img.height})` : ""
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setLightboxImage({ url: img.dataUrl, name: img.name });
                        }}
                      />
                    ))}
                  </div>
                )}
                {turn.role === "assistant" && !turn.error ? (
                  <>
                    <div className="ast-chat-bubble-tools">
                      {i === lastAssistantIndex && !chatPending && (
                        <button
                          className="ast-chat-bubble-tool"
                          title={t(lang, "chat.regenerate")}
                          onClick={handleRegenerate}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="12"
                            height="12"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M1 4v6h6" />
                            <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                          </svg>
                        </button>
                      )}
                      <button
                        className="ast-chat-bubble-tool"
                        title={t(lang, "popup.copy")}
                        onClick={() => handleCopyTurn(turn.content)}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="12"
                          height="12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                        </svg>
                      </button>
                    </div>
                    <ChatRichText text={turn.content} />
                    {turn.ungroundedSearchFallback && (
                      <div className="ast-chat-search-fallback" role="note">
                        <span aria-hidden="true">ⓘ</span>
                        <span>{t(lang, "chat.searchNoResultsFallback")}</span>
                      </div>
                    )}
                    {turn.sources && turn.sources.length > 0 && (
                      <div className="ast-chat-sources">
                        <div className="ast-chat-sources-label">{t(lang, "chat.sources")}</div>
                        <div className="ast-chat-sources-list">
                          {turn.sources.map((source, sourceIndex) => (
                            <a
                              key={`${source.url}-${sourceIndex}`}
                              className="ast-chat-source-link"
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              title={source.snippet || source.url}
                            >
                              <span>{sourceIndex + 1}</span>
                              <span>{source.title}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  turn.content
                )}
              </div>
            ))}
            {streamText ? (
              <div className="ast-chat-bubble ast-chat-bubble--assistant">
                <ChatRichText text={streamText} />
                <span className="ast-chat-cursor" />
              </div>
            ) : (
              chatPending && (
                <div className="ast-chat-bubble ast-chat-bubble--assistant ast-chat-bubble--thinking">
                  <div className="ast-spinner-sm" />
                  <span>{chatPhase === "searching" ? t(lang, "chat.searching") : t(lang, "chat.thinking")}</span>
                </div>
              )
            )}
          </div>

          {chatError && (
            <div className="ast-error-msg">
              <span>⚠</span>
              <span>{chatError}</span>
            </div>
          )}

          <div className="ast-chat-composer-card">
            {chatAttach && (
              <div
                className="ast-chat-attach-chip"
                title={chatAttach.title || chatAttach.url}
              >
                <span>📎</span>
                <span className="ast-chat-attach-label">
                  {t(lang, "chat.attachChip", {
                    label: chatAttach.selected
                      ? t(lang, "chat.attachSelection")
                      : chatAttach.title || t(lang, "chat.attachPage"),
                    n: chatAttach.text.length,
                  })}
                </span>
                <button
                  type="button"
                  className="ast-chat-attach-remove"
                  onClick={() => setChatAttach(null)}
                  title={t(lang, "chat.clear")}
                >
                  ✕
                </button>
              </div>
            )}

            {chatImages.length > 0 && (
              <div className="ast-chat-img-tray">
                {chatImages.map((img, idx) => (
                  <div key={img.id} className="ast-chat-img-item">
                    <img
                      className="ast-chat-img-thumb"
                      src={img.dataUrl}
                      alt={img.name || "image"}
                      title={`${img.name || "image"}${
                        img.width && img.height ? ` (${img.width}x${img.height})` : ""
                      }`}
                      onClick={() => setLightboxImage({ url: img.dataUrl, name: img.name })}
                    />
                    <button
                      type="button"
                      className="ast-chat-img-del"
                      title={t(lang, "chat.attachRemove")}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setChatImages((prev) => prev.filter((_, i) => i !== idx));
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {chatImages.length > 0 && !isVisionCapable(settings?.providerId, settings?.model) && (
              <div className="ast-chat-vision-notice">
                <span>ℹ️</span>
                <span>{t(lang, "chat.textOnlyNotice")}</span>
              </div>
            )}

            <textarea
              ref={chatInputRef}
              className="ast-chat-input"
              placeholder={t(lang, "chat.placeholder")}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleChatKeyDown}
              onPaste={(e) => {
                const items = e.clipboardData?.items;
                if (items) {
                  const files = extractImagesFromDataTransfer(items);
                  if (files.length > 0) {
                    e.preventDefault();
                    void handleAddImages(files);
                  }
                }
              }}
              rows={1}
              maxLength={8000}
            />
            <div className="ast-chat-actions">
              <div className="ast-chat-actions-left">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      const files = Array.from(e.target.files);
                      e.target.value = "";
                      void handleAddImages(files);
                    }
                  }}
                />
                <button
                  type="button"
                  className="ast-chat-tool-btn"
                  onClick={() => fileInputRef.current?.click()}
                  title={t(lang, "chat.uploadImage")}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                    <circle cx="9" cy="9" r="2"/>
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                  </svg>
                </button>
                <button
                  type="button"
                  className="ast-chat-tool-btn"
                  onClick={handleCaptureScreenshot}
                  title={t(lang, "chat.screenshot")}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
                    <circle cx="12" cy="13" r="3"/>
                  </svg>
                </button>
                {!chatAttach && (
                  <button
                    type="button"
                    className="ast-chat-tool-btn"
                    onClick={handleAttachPage}
                    title={t(lang, "chat.attach")}
                  >
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                    </svg>
                  </button>
                )}
                <button
                  type="button"
                  className={[
                    "ast-chat-pill",
                    webSearchEnabled ? "ast-chat-pill--on" : "",
                    settings?.chatWebSearchEnabled ? "" : "ast-chat-pill--locked",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={toggleWebSearch}
                  aria-pressed={webSearchEnabled}
                  title={t(
                    lang,
                    webSearchEnabled
                      ? "chat.webSearchOn"
                      : settings?.chatWebSearchEnabled
                        ? "chat.webSearchOff"
                        : "chat.webSearchNeedSetup"
                  )}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0 }}
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 2a14.5 14.5 0 0 1 0 20M2 12h20" />
                    <path d="M12 2a14.5 14.5 0 0 0 0 20" />
                  </svg>
                  <span>{t(lang, "chat.webSearch")}</span>
                </button>
              </div>

              <div className="ast-chat-actions-right">
                <ChatModelMenu
                  settings={settings}
                  lang={lang}
                  onSwitch={handleModelSwitch}
                  onOpenSettings={openOptions}
                />
                <ChatEffortMenu
                  value={chatEffort}
                  providerId={settings?.providerId}
                  lang={lang}
                  onChange={handleEffortChange}
                />
                <button
                  type="button"
                  className="ast-chat-tool-btn"
                  onClick={handleOpenInPage}
                  title={t(lang, "chat.openInPage")}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 3 21 3 21 9"/>
                    <polyline points="9 21 3 21 3 15"/>
                    <line x1="21" y1="3" x2="14" y2="10"/>
                    <line x1="3" y1="21" x2="10" y2="14"/>
                  </svg>
                </button>
                <button
                  type="button"
                  className="ast-chat-send-btn"
                  onClick={handleChatSend}
                  disabled={chatPending || (!chatInput.trim() && chatImages.length === 0)}
                  title={chatPending ? t(lang, "chat.thinking") : t(lang, "chat.send")}
                >
                  {chatPending ? (
                    <div className="ast-spinner-xs" />
                  ) : (
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="19" x2="12" y2="5"/>
                      <polyline points="5 12 12 5 19 12"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
          <div className="ast-chat-hint">{t(lang, "chat.kbHint")}</div>
        </div>
      )}

      {mode === "live" && (
        <div className="ast-live-panel">
          {/* Top Sound Studio & Settings Card */}
          <div className="ast-live-hero-card">
            <div className="ast-live-hero-header">
              <div className="ast-live-status-badge">
                <span className={`ast-live-dot ast-live-dot--${liveState.status}`} />
                <span className="ast-live-status-text">
                  {liveState.running
                    ? (liveState.message || t(lang, "live.connected"))
                    : t(lang, "live.idle")}
                </span>
              </div>
              <div className="ast-live-eq" title={liveState.running ? "正在监听网页音频" : "等待开启"}>
                <span
                  className={`ast-live-eq-bar ${liveState.running ? "ast-live-eq-bar--live" : ""}`}
                  style={{ height: liveState.running ? `${Math.max(25, Math.min(100, (liveState.level || 0) * 1.1))}%` : "25%" }}
                />
                <span
                  className={`ast-live-eq-bar ${liveState.running ? "ast-live-eq-bar--live" : ""}`}
                  style={{ height: liveState.running ? `${Math.max(40, Math.min(100, (liveState.level || 0) * 1.5))}%` : "40%" }}
                />
                <span
                  className={`ast-live-eq-bar ${liveState.running ? "ast-live-eq-bar--live" : ""}`}
                  style={{ height: liveState.running ? `${Math.max(60, Math.min(100, (liveState.level || 0) * 1.8))}%` : "60%" }}
                />
                <span
                  className={`ast-live-eq-bar ${liveState.running ? "ast-live-eq-bar--live" : ""}`}
                  style={{ height: liveState.running ? `${Math.max(30, Math.min(100, (liveState.level || 0) * 1.2))}%` : "30%" }}
                />
              </div>
            </div>

            <div className="ast-live-setting-row">
              <div className="ast-live-setting-label">
                <span>🌐</span>
                <span>{t(lang, "live.targetLang")}</span>
              </div>
              <select
                className="ast-lang-select ast-live-lang-select"
                value={settings?.liveTranslateTargetLang || settings?.defaultTargetLang || "Simplified Chinese"}
                onChange={handleLiveTargetLangChange}
              >
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>

            <div className="ast-live-setting-grid">
              <button
                type="button"
                className={`ast-live-chip-btn ${settings?.liveTranslateShowOriginal ? "ast-live-chip-btn--active" : ""}`}
                onClick={handleToggleLiveShowOriginal}
                title="切换悬浮字幕双语/单译文"
              >
                <span className="ast-live-chip-icon">🔤</span>
                <span>{settings?.liveTranslateShowOriginal ? "双语字幕" : "单译文"}</span>
              </button>

              <button
                type="button"
                className="ast-live-chip-btn"
                onClick={handleCycleLiveOpacity}
                title="点击循环切换悬浮字幕背景透明度"
              >
                <span className="ast-live-chip-icon">🌗</span>
                <span>透明度 {settings?.liveTranslateBgOpacity ?? 80}%</span>
              </button>
            </div>
          </div>

          {/* Subtitle Stream Feed Card */}
          <div className="ast-live-feed-card">
            <div className="ast-live-feed-header">
              <div className="ast-live-feed-title">
                <span>实时同传流</span>
                {liveHistory.length > 0 && <span className="ast-live-feed-count">{liveHistory.length}</span>}
              </div>
              <div className="ast-live-feed-actions">
                <button
                  type="button"
                  className="ast-btn ast-btn-sm ast-live-tool-btn"
                  onClick={handleExportLiveSrt}
                  disabled={liveHistory.length === 0}
                  title={t(lang, "live.exportSrt")}
                >
                  📥 SRT
                </button>
                <button
                  type="button"
                  className="ast-btn ast-btn-sm ast-live-tool-btn"
                  onClick={handleClearLiveHistory}
                  disabled={liveHistory.length === 0}
                  title={t(lang, "live.clearHistory")}
                >
                  🗑
                </button>
              </div>
            </div>

            <div className="ast-live-feed-list">
              {liveHistory.length === 0 ? (
                <div className="ast-live-feed-empty">
                  <div className="ast-live-empty-waves">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="ast-live-empty-title">
                    {liveState.running ? "正在监听网页音频…" : "等待开启同传"}
                  </div>
                  <div className="ast-live-empty-sub">在 YouTube、Bilibili、播客等页面播放，双语字幕将实时浮现</div>
                </div>
              ) : (
                liveHistory.slice().reverse().map((item) => (
                  <div key={item.id} className="ast-live-feed-item">
                    {item.original && <div className="ast-live-feed-orig">{item.original}</div>}
                    <div className="ast-live-feed-trans">{item.translation}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Bottom Action Button Bar */}
          <div className="ast-live-bottom-bar">
            <button
              type="button"
              className={`ast-btn ${liveState.running ? "ast-live-btn--running" : "ast-live-btn--idle"} ast-live-cta-btn`}
              onClick={handleToggleLive}
              disabled={liveLoading}
            >
              <span className="ast-live-btn-icon">{liveLoading ? "⏳" : liveState.running ? "⏹" : "🎙️"}</span>
              <span className="ast-live-btn-text">
                {liveLoading ? "正在切换…" : liveState.running ? t(lang, "live.stop") : t(lang, "live.start")}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxImage && (
        <div
          className="ast-chat-lightbox"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="ast-chat-lightbox-toolbar"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="ast-chat-lightbox-tool"
              onClick={() => {
                fetch(lightboxImage.url)
                  .then((r) => r.blob())
                  .then((blob) => {
                    const blobUrl = URL.createObjectURL(blob);
                    chrome.tabs.create({ url: blobUrl });
                  })
                  .catch(() => {
                    chrome.tabs.create({ url: lightboxImage.url });
                  });
              }}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              <span>新标签页查看高清原图</span>
            </button>
            <button
              type="button"
              className="ast-chat-lightbox-tool ast-chat-lightbox-close"
              onClick={() => setLightboxImage(null)}
              title="关闭"
            >
              ✕
            </button>
          </div>
          <div
            className="ast-chat-lightbox-body"
            onClick={() => setLightboxImage(null)}
          >
            <img
              className="ast-chat-lightbox-img"
              src={lightboxImage.url}
              alt={lightboxImage.name || "Preview"}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* Toast */}

      {toast && (
        <div className="ast-toast" role="status" aria-live="polite">
          <span className="ast-toast-icon">✓</span>
          <span className="ast-toast-text">{toast}</span>
        </div>
      )}
    </div>
  );
}

// Mount React app
const root = createRoot(document.getElementById("root")!);
root.render(<Popup />);
