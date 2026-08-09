import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { SUPPORTED_LANGUAGES } from "../shared/constants";
import { t, type UiLanguage } from "../shared/i18n";
import type {
  AstraSettings,
  ChatAttachment,
  ChatState,
  ChatStreamEvent,
  ChatStreamPhase,
  ChatTurn,
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
  CHAT_EFFORTS,
  DEFAULT_CHAT_EFFORT,
  normalizeChatEffort,
  type ChatEffort,
} from "../shared/chatEffort";
import { extractPageContext } from "../shared/pageExtract";
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

type PopupMode = "translate" | "chat";

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
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
  const chatListRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const streamReqRef = useRef(0);

  const lang: UiLanguage = settings?.uiLanguage || "zh-CN";

  // Load settings on mount
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }).then((s) => {
      if (s) {
        setSettings(s);
        setTargetLang(s.defaultTargetLang || "Simplified Chinese");
        setPageTargetLang(s.pageTargetLang || "Simplified Chinese");
      }
    });
    inputRef.current?.focus();
  }, []);

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
      const change = changes[CHAT_STORAGE_KEY];
      if (!change) return;
      const next = change.newValue as ChatState | undefined;
      setChatTurns(next?.turns ?? []);
      setChatPending(!!next?.pending);
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
        setResult(response.translation || "");
        setResolvedLang(response.resolvedLang || "");
      } else {
        setError(response?.error || t(lang, "error.translationFailed"));
      }
    } catch {
      setError(t(lang, "popup.connectFail"));
    } finally {
      setLoading(false);
    }
  }, [inputText, targetLang, sourceLang, lang]);

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

  // ---- Chat mode actions ----

  const switchMode = useCallback((next: PopupMode) => {
    setMode(next);
    chrome.storage.session
      ?.set({ [POPUP_MODE_STORAGE_KEY]: next })
      .catch(() => {});
  }, []);

  /** Pre-flight rejection: nothing entered the conversation — surface the
   * error inline and give the text (and attachment) back for a retry. */
  const handleChatRejection = useCallback(
    (text: string, attach: ChatAttachment | null, error?: string) => {
      if (!error) return; // deliberate cancel (clear) — nothing to surface
      setChatError(error);
      setChatInput(text);
      if (attach) setChatAttach(attach);
    },
    []
  );

  /** Streaming send over a dedicated port. Returns false when the port
   * can't be opened so the caller can fall back to the one-shot path.
   * `retry` restores the composer if the request was rejected pre-flight. */
  const sendViaStream = useCallback(
    (
      payload: Record<string, unknown>,
      retry?: { text: string; attach: ChatAttachment | null }
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
              handleChatRejection(retry.text, retry.attach, event.error);
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
    if (!text || chatPending) return;
    const attach = chatAttach;
    setChatError("");
    setChatInput("");
    setChatAttach(null);
    setStreamText("");

    const doWebSearch = webSearchEnabled;
    setChatPhase(doWebSearch ? "searching" : "answering");

    const payload: Record<string, unknown> = {
      text,
      webSearch: doWebSearch,
      effort: chatEffort,
    };
    if (attach) payload.attachment = attach;

    // Prefer streaming; fall back to the one-shot message on port failure.
    if (sendViaStream(payload, { text, attach })) return;

    try {
      const res = await chrome.runtime.sendMessage({
        type: "CHAT_MESSAGE",
        payload,
      });
      if (res && !res.success && !res.appended) {
        handleChatRejection(text, attach, res.error);
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
    }
  }, [
    chatInput,
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
  const handleEffortChange = useCallback((next: ChatEffort) => {
    setChatEffort(next);
    chrome.storage.session
      ?.set({ [CHAT_EFFORT_SESSION_KEY]: next })
      .catch(() => {});
  }, []);

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
    <div onKeyDown={handleKeyDown}>
      {/* Header: title · mode segmented control · settings */}
      <div className="ast-popup-header">
        <span className="ast-popup-title">{t(lang, "app.name")}</span>
        <div className="ast-seg" role="tablist">
          <button
            role="tab"
            aria-selected={mode === "translate"}
            className={`ast-seg-btn ${mode === "translate" ? "ast-seg-btn--active" : ""}`}
            onClick={() => switchMode("translate")}
          >
            {t(lang, "popup.modeTranslate")}
          </button>
          <button
            role="tab"
            aria-selected={mode === "chat"}
            className={`ast-seg-btn ${mode === "chat" ? "ast-seg-btn--active" : ""}`}
            onClick={() => switchMode("chat")}
          >
            {t(lang, "popup.modeChat")}
          </button>
        </div>
        <button className="ast-popup-settings-btn" onClick={openOptions} title={t(lang, "popup.openSettings")}>
          ⚙
        </button>
      </div>

      {mode === "chat" ? (
        <div className="ast-chat">
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
                className="ast-chat-attach-remove"
                onClick={() => setChatAttach(null)}
                title={t(lang, "chat.clear")}
              >
                ✕
              </button>
            </div>
          )}

          <textarea
            ref={chatInputRef}
            className="ast-input-box ast-chat-input"
            placeholder={t(lang, "chat.placeholder")}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleChatKeyDown}
            rows={1}
            maxLength={8000}
          />
          <div className="ast-chat-actions">
            <button
              className="ast-btn ast-btn-primary"
              onClick={handleChatSend}
              disabled={chatPending || !chatInput.trim()}
            >
              {chatPending ? t(lang, "chat.thinking") : t(lang, "chat.send")}
            </button>
            <button
              className="ast-btn ast-btn-secondary"
              onClick={handleChatClear}
              disabled={chatTurns.length === 0 && !chatPending}
            >
              {t(lang, "chat.clear")}
            </button>
            <button
              className={[
                "ast-chat-web-toggle",
                webSearchEnabled ? "ast-chat-web-toggle--on" : "",
                settings?.chatWebSearchEnabled ? "" : "ast-chat-web-toggle--locked",
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
              <span aria-hidden="true">🌐</span>
              {t(lang, "chat.webSearch")}
            </button>
            <select
              className="ast-chat-effort"
              value={chatEffort}
              onChange={(e) => handleEffortChange(normalizeChatEffort(e.target.value))}
              title={t(lang, "chat.effortHint")}
            >
              {CHAT_EFFORTS.map((level) => (
                <option key={level} value={level}>
                  {t(lang, `chat.effort.${level}`)}
                </option>
              ))}
            </select>
            {!chatAttach && (
              <button
                className="ast-btn ast-btn-secondary ast-chat-attach-btn"
                onClick={handleAttachPage}
                title={t(lang, "chat.attach")}
              >
                📎
              </button>
            )}
            <button
              className="ast-btn ast-btn-secondary ast-chat-attach-btn"
              onClick={handleOpenInPage}
              title={t(lang, "chat.openInPage")}
            >
              ⤢
            </button>
            <span className="ast-keyboard-hint">{t(lang, "chat.kbHint")}</span>
          </div>
        </div>
      ) : (
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

      {/* Toast */}
      {toast && <div className="ast-toast">{toast}</div>}
    </div>
  );
}

// Mount React app
const root = createRoot(document.getElementById("root")!);
root.render(<Popup />);
