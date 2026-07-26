import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { SUPPORTED_LANGUAGES } from "../shared/constants";
import { t, type UiLanguage } from "../shared/i18n";
import type { AstraSettings, ChatState, ChatTurn } from "../shared/types";
import { CHAT_STORAGE_KEY, POPUP_MODE_STORAGE_KEY } from "../shared/types";
import "./popup.css";

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
  const chatListRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

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
      ?.get(POPUP_MODE_STORAGE_KEY)
      .then((r) => {
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
  }, [mode, chatTurns, chatPending]);

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

  const handleChatSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatPending) return;
    setChatError("");
    setChatInput("");
    try {
      const res = await chrome.runtime.sendMessage({
        type: "CHAT_MESSAGE",
        payload: { text },
      });
      if (res && !res.success && !res.appended) {
        // Pre-flight rejection (missing key / busy) — nothing was added to
        // the conversation, so surface the error here and give the text
        // back to the input for a retry.
        setChatError(res.error || t(lang, "chat.failed"));
        setChatInput(text);
      }
      // Storage events already track the conversation; this refresh only
      // matters for the no-session-storage fallback.
      refreshChatState();
    } catch {
      setChatError(t(lang, "popup.connectFail"));
      setChatInput(text);
    }
  }, [chatInput, chatPending, lang, refreshChatState]);

  const handleChatClear = useCallback(() => {
    setChatError("");
    chrome.runtime
      .sendMessage({ type: "CLEAR_CHAT" })
      .then(() => refreshChatState())
      .catch(() => {});
  }, [refreshChatState]);

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

  return (
    <div onKeyDown={handleKeyDown}>
      {/* Header */}
      <div className="ast-popup-header">
        <span className="ast-popup-title">{t(lang, "app.name")}</span>
        <button className="ast-popup-settings-btn" onClick={openOptions} title={t(lang, "popup.openSettings")}>
          ⚙
        </button>
      </div>

      {/* Mode switch */}
      <div className="ast-mode-switch" role="tablist">
        <button
          role="tab"
          aria-selected={mode === "translate"}
          className={`ast-mode-btn ${mode === "translate" ? "ast-mode-btn--active" : ""}`}
          onClick={() => switchMode("translate")}
        >
          {t(lang, "popup.modeTranslate")}
        </button>
        <button
          role="tab"
          aria-selected={mode === "chat"}
          className={`ast-mode-btn ${mode === "chat" ? "ast-mode-btn--active" : ""}`}
          onClick={() => switchMode("chat")}
        >
          {t(lang, "popup.modeChat")}
        </button>
      </div>

      {mode === "chat" ? (
        <div className="ast-chat">
          <div className="ast-chat-list" ref={chatListRef}>
            {chatTurns.length === 0 && !chatPending && (
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
                {turn.content}
              </div>
            ))}
            {chatPending && (
              <div className="ast-chat-bubble ast-chat-bubble--assistant ast-chat-bubble--thinking">
                <div className="ast-spinner-sm" />
                <span>{t(lang, "chat.thinking")}</span>
              </div>
            )}
          </div>

          {chatError && (
            <div className="ast-error-msg">
              <span>⚠</span>
              <span>{chatError}</span>
            </div>
          )}

          <textarea
            ref={chatInputRef}
            className="ast-input-box ast-chat-input"
            placeholder={t(lang, "chat.placeholder")}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleChatKeyDown}
            rows={2}
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

      {!result && !loading && !error && (
        <div className="ast-result-area">
          <div className="ast-result-box ast-result-placeholder">
            {t(lang, "popup.resultPlaceholder")}
          </div>
        </div>
      )}

      {/* Page translation */}
      <div className="ast-page-section">
        <div className="ast-page-title">{t(lang, "popup.pageTranslation")}</div>
        <div className="ast-page-lang-row">
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
