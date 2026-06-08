import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { SUPPORTED_LANGUAGES } from "../shared/constants";
import { t, type UiLanguage } from "../shared/i18n";
import type { AstraSettings } from "../shared/types";
import "./popup.css";

export default function Popup() {
  const [settings, setSettings] = useState<AstraSettings | null>(null);
  const [sourceLang, setSourceLang] = useState("Auto");
  const [targetLang, setTargetLang] = useState("Simplified Chinese");
  const [pageTargetLang, setPageTargetLang] = useState("Simplified Chinese");
  const [inputText, setInputText] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pageStatus, setPageStatus] = useState<string>("");
  const [toast, setToast] = useState("");
  const [langSaved, setLangSaved] = useState(false);
  const [pageLangSaved, setPageLangSaved] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

    try {
      const response = await chrome.runtime.sendMessage({
        type: "TRANSLATE_TEXT",
        payload: {
          text,
          targetLang,
          sourceLang: sourceLang === "Auto" ? undefined : sourceLang,
        },
      });

      if (response?.success) {
        setResult(response.translation || "");
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

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
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
    [handleTranslate, handleClear, error]
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
            <div className="ast-result-box">{result}</div>
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

      {/* Toast */}
      {toast && <div className="ast-toast">{toast}</div>}
    </div>
  );
}

// Mount React app
const root = createRoot(document.getElementById("root")!);
root.render(<Popup />);
