import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { AstraSettings, ProviderApiFormat } from "../shared/types";
import { t, type UiLanguage } from "../shared/i18n";
import {
  DEFAULT_PROVIDER_PRESETS,
  SUPPORTED_LANGUAGES,
} from "../shared/constants";
import {
  DEFAULT_SELECTION_PROMPT,
  DEFAULT_PAGE_PROMPT,
  DEFAULT_CHAT_PROMPT,
  DEFAULT_LIVE_TRANSLATE_PROMPT,
} from "../shared/prompts";
import { parseGlossary, serializeGlossary } from "../shared/glossary";
import { getDefaultSettings, switchProviderSettings } from "../shared/storage";
import "./options.css";


export default function Options() {
  const [settings, setSettings] = useState<AstraSettings>(getDefaultSettings());
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [siteStats, setSiteStats] = useState<{
    hostCount: number;
    phraseCount: number;
    hosts: Array<{ host: string; phrases: number }>;
  } | null>(null);
  const [clearingLexicon, setClearingLexicon] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Custom headers (JSON text, e.g. {"X-Proxy-Token":"abc"})
  const [customHeadersText, setCustomHeadersText] = useState(() => {
    try {
      return JSON.stringify(settings.customHeaders || {}, null, 0);
    } catch {
      return "{}";
    }
  });

  const lang: UiLanguage = settings.uiLanguage || "zh-CN";

  const refreshSiteStats = useCallback(() => {
    chrome.runtime
      .sendMessage({ type: "GET_SITE_LEXICON_STATS" })
      .then((res) => {
        if (res?.success) {
          setSiteStats({
            hostCount: res.hostCount ?? 0,
            phraseCount: res.phraseCount ?? 0,
            hosts: res.hosts ?? [],
          });
        }
      })
      .catch(() => {});
  }, []);

  // Load settings
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }).then((s) => {
      if (s) setSettings(s);
    });
    refreshSiteStats();
  }, [refreshSiteStats]);

  // Toast helper (defined early so scheduleSave can use it)
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  }, []);

  // Debounced auto-save
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        await chrome.runtime.sendMessage({
          type: "SAVE_SETTINGS",
          payload: settingsRef.current,
        });
        setSaveStatus("saved");
        showToast(t(settingsRef.current.uiLanguage || "zh-CN", "opt.saved"));
        setTimeout(() => setSaveStatus("idle"), 1500);
      } catch {
        setSaveStatus("idle");
        showToast(t(settingsRef.current.uiLanguage || "zh-CN", "opt.saveFailed"));
      }
    }, 600);
  }, [showToast]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Update a single field and auto-save
  const update = useCallback(
    <K extends keyof AstraSettings>(key: K, value: AstraSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        const providerKeys = [
          "apiKey",
          "baseUrl",
          "endpoint",
          "model",
          "disableThinking",
          "temperature",
          "apiFormat",
          "customHeaders",
        ];
        if (providerKeys.includes(key as string) && prev.providerId) {
          const configs = { ...(prev.providerConfigs || {}) };
          configs[prev.providerId] = {
            ...(configs[prev.providerId] || {}),
            [key]: value,
          };
          next.providerConfigs = configs;
        }
        settingsRef.current = next;
        return next;
      });
      scheduleSave();
    },
    [scheduleSave]
  );

  // Parse JSON custom headers text into settings.customHeaders (valid JSON only)
  const handleCustomHeadersChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value;
      setCustomHeadersText(text);
      try {
        const parsed = JSON.parse(text || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const clean: Record<string, string> = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string") clean[k] = v;
          }
          update("customHeaders", clean);
        }
      } catch {
        // invalid JSON while typing: skip update (auto-save will keep last valid)
      }
    },
    [update]
  );

  // Provider preset change: persist current provider's settings and restore target provider's settings
  const handlePresetChange = useCallback(
    (presetId: string) => {
      setSettings((prev) => {
        const next = switchProviderSettings(prev, presetId);
        settingsRef.current = next;
        return next;
      });
      scheduleSave();
    },
    [scheduleSave]
  );

  // Reset to defaults
  const handleReset = useCallback(() => {
    const defaults = getDefaultSettings();
    setSettings(defaults);
    settingsRef.current = defaults;
    setTestResult(null);
    scheduleSave();
  }, [scheduleSave]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset prompts
  const handleResetPrompts = useCallback(() => {
    setSettings((prev) => {
      const next = {
        ...prev,
        selectionPrompt: DEFAULT_SELECTION_PROMPT,
        pagePrompt: DEFAULT_PAGE_PROMPT,
        chatPrompt: DEFAULT_CHAT_PROMPT,
        liveTranslatePrompt: DEFAULT_LIVE_TRANSLATE_PROMPT,
      };
      settingsRef.current = next;
      return next;
    });
    scheduleSave();
  }, [scheduleSave]);

  const handleExportGlossary = useCallback(() => {
    const blob = new Blob([settings.customGlossary || ""], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Astra_Glossary_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(t(lang, "opt.glossaryExportDone"));
  }, [settings.customGlossary, lang, showToast]);

  const handleImportGlossary = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = String(event.target?.result || "");
        const parsed = parseGlossary(content);
        const formatted = serializeGlossary(parsed);
        update("customGlossary", formatted);
        showToast(t(lang, "opt.glossaryImportDone", { count: parsed.length }));
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [update, lang, showToast]
  );


  const handleClearAllSiteLexicon = useCallback(async () => {
    const ok = window.confirm(t(lang, "opt.clearSiteLexiconConfirm"));
    if (!ok) return;
    setClearingLexicon(true);
    try {
      const res = await chrome.runtime.sendMessage({
        type: "CLEAR_SITE_LEXICON",
        payload: {},
      });
      const count = res?.cleared ?? 0;
      showToast(t(lang, "opt.clearSiteLexiconDone", { count }));
      refreshSiteStats();
    } catch {
      showToast(t(lang, "opt.saveFailed"));
    } finally {
      setClearingLexicon(false);
    }
  }, [lang, showToast, refreshSiteStats]);

  const handleClearHostLexicon = useCallback(
    async (host: string) => {
      // Irreversible — same confirmation bar as the clear-all action.
      const ok = window.confirm(t(lang, "opt.clearHostLexiconConfirm", { host }));
      if (!ok) return;
      setClearingLexicon(true);
      try {
        const res = await chrome.runtime.sendMessage({
          type: "CLEAR_SITE_LEXICON",
          payload: { host },
        });
        const count = res?.cleared ?? 0;
        showToast(t(lang, "opt.clearSiteLexiconDone", { count }));
        refreshSiteStats();
      } catch {
        showToast(t(lang, "opt.saveFailed"));
      } finally {
        setClearingLexicon(false);
      }
    },
    [lang, showToast, refreshSiteStats]
  );

  // Test API — uses current form state directly, auto-saves on success
  const handleTest = useCallback(async () => {
    if (!settings.apiKey) {
      setTestResult({ ok: false, msg: t(lang, "error.apiKeyNotConfigured") });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "TEST_PROVIDER",
        settings, // Send current form state as draft
      });

      if (response?.success) {
        // Force save on test success
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        try {
          await chrome.runtime.sendMessage({
            type: "SAVE_SETTINGS",
            payload: settings,
          });
        } catch {
          // Save failed, but test succeeded — still show success
        }
        const baseMsg = t(lang, "opt.testSuccess", { model: response.model || settings.model });
        setTestResult({ ok: true, msg: baseMsg + " " + t(lang, "opt.testAutoSaved") });
      } else {
        setTestResult({
          ok: false,
          msg: response?.error || t(lang, "opt.testFail"),
        });
      }
    } catch {
      setTestResult({ ok: false, msg: t(lang, "opt.testFail") });
    } finally {
      setTesting(false);
    }
  }, [settings, lang]);

  const selectedPreset = DEFAULT_PROVIDER_PRESETS.find(
    (p) => p.id === settings.providerId
  );

  const SECTIONS: Array<{ id: string; labelKey: string }> = [
    { id: "sec-provider", labelKey: "opt.provider" },
    { id: "sec-uilang", labelKey: "opt.uiLang" },
    { id: "sec-translation", labelKey: "opt.translation" },
    { id: "sec-glossary", labelKey: "opt.glossary" },
    { id: "sec-live-translate", labelKey: "opt.liveSettings" },
    { id: "sec-floatingball", labelKey: "opt.floatingBall" },
    { id: "sec-chat-context", labelKey: "opt.chatContext" },
    { id: "sec-web-search", labelKey: "opt.webSearch" },
    { id: "sec-prompt", labelKey: "opt.prompt" },
  ];


  return (
    <div className="ast-options-container">
      {/* Header */}
      <div className="ast-options-header">
        <div className="ast-options-logo">{t(lang, "app.name")}</div>
        <div className="ast-options-desc">{t(lang, "app.desc")}</div>
      </div>

      {/* Sticky section nav — anchors into the cards below */}
      <div className="ast-options-nav">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className="ast-options-nav-chip"
            onClick={() =>
              document
                .getElementById(s.id)
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            {t(lang, s.labelKey)}
          </button>
        ))}
      </div>

      {/* Provider Card */}
      <div className="ast-card" id="sec-provider">
        <div className="ast-card-title">{t(lang, "opt.provider")}</div>

        <div className="ast-form-group">
          <label className="ast-form-label">{t(lang, "opt.providerPreset")}</label>
          <select
            className="ast-form-select"
            value={settings.providerId}
            onChange={(e) => handlePresetChange(e.target.value)}
          >
            {DEFAULT_PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="ast-form-group">
          <label className="ast-form-label">{t(lang, "opt.apiFormat")}</label>
          <select
            className="ast-form-select"
            value={settings.apiFormat}
            onChange={(e) => update("apiFormat", e.target.value as ProviderApiFormat)}
          >
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="gemini-compatible" disabled>
              {t(lang, "opt.geminiSoon")}
            </option>
            <option value="anthropic-compatible" disabled>
              {t(lang, "opt.anthropicSoon")}
            </option>
          </select>
        </div>

        <div className="ast-form-row">
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "opt.baseUrl")}</label>
            <input
              className="ast-form-input"
              type="text"
              value={settings.baseUrl}
              onChange={(e) => update("baseUrl", e.target.value)}
              placeholder={selectedPreset?.baseUrl || "https://generativelanguage.googleapis.com/v1beta/openai"}
            />
          </div>
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "opt.endpoint")}</label>
            <input
              className="ast-form-input"
              type="text"
              value={settings.endpoint}
              onChange={(e) => update("endpoint", e.target.value)}
              placeholder={selectedPreset?.endpoint || "/chat/completions"}
            />
          </div>
        </div>

        <div className="ast-form-row">
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "opt.customHeaders")}</label>
            <input
              className="ast-form-input"
              type="text"
              value={customHeadersText}
              onChange={handleCustomHeadersChange}
              placeholder={'{"X-Proxy-Token":"your-token"}'}
            />
          </div>
        </div>

        <div className="ast-form-row">
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "opt.model")}</label>
            <input
              className="ast-form-input"
              type="text"
              value={settings.model}
              onChange={(e) => update("model", e.target.value)}
              placeholder={selectedPreset?.defaultModel || "gemini-3.7-flash"}
            />
          </div>
          <div className="ast-form-group">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label className="ast-form-label" style={{ margin: 0 }}>{t(lang, "opt.apiKey")}</label>
              {selectedPreset?.website && (
                <a
                  href={selectedPreset.website}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: "var(--ast-primary)", textDecoration: "none" }}
                >
                  {t(lang, "opt.getApiKey")} ↗
                </a>
              )}
            </div>
            <div className="ast-api-key-group">
              <input
                className="ast-form-input"
                type={showKey ? "text" : "password"}
                value={settings.apiKey}
                onChange={(e) => update("apiKey", e.target.value)}
                placeholder={selectedPreset?.id === "google-gemini" ? "AIzaSy..." : "sk-..."}
              />
              <button
                className="ast-toggle-visibility"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? t(lang, "opt.hideKey") : t(lang, "opt.showKey")}
              >
                {showKey ? (
                  <img src={chrome.runtime.getURL("icons/key-girl.png")} alt="hide" className="ast-key-icon" />
                ) : "👁"}
              </button>
            </div>
          </div>
        </div>

        {selectedPreset?.supportsThinkingToggle && (
          <div className="ast-toggle-row">
            <span className="ast-toggle-label">{t(lang, "opt.disableThinking")}</span>
            <input
              type="checkbox"
              className="ast-toggle"
              checked={settings.disableThinking}
              onChange={(e) => update("disableThinking", e.target.checked)}
            />
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button
            className="ast-btn ast-btn-outline"
            onClick={handleTest}
            disabled={testing}
          >
            {testing ? t(lang, "opt.testing") : t(lang, "opt.testConnection")}
          </button>
        </div>

        {testResult && (
          <div
            className={`ast-test-result ${
              testResult.ok ? "ast-test-success" : "ast-test-error"
            }`}
          >
            <span>{testResult.ok ? "✓" : "✗"}</span>
            <span>{testResult.msg}</span>
          </div>
        )}
      </div>

      {/* UI Language Card */}
      <div className="ast-card" id="sec-uilang">
        <div className="ast-card-title">{t(lang, "opt.uiLang")}</div>
        <div className="ast-form-group">
          <select
            className="ast-form-select"
            value={settings.uiLanguage}
            onChange={(e) => update("uiLanguage", e.target.value as UiLanguage)}
          >
            <option value="zh-CN">简体中文</option>
            <option value="en-US">English</option>
            <option value="ja-JP">日本語</option>
          </select>
        </div>
      </div>

      {/* Translation Settings Card */}
      <div className="ast-card" id="sec-translation">
        <div className="ast-card-title">{t(lang, "opt.translation")}</div>

        <div className="ast-form-row">
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "opt.defaultTargetLang")}</label>
            <select
              className="ast-form-select"
              value={settings.defaultTargetLang}
              onChange={(e) => update("defaultTargetLang", e.target.value)}
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "opt.pageTargetLang")}</label>
            <select
              className="ast-form-select"
              value={settings.pageTargetLang}
              onChange={(e) => update("pageTargetLang", e.target.value)}
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="ast-form-row">
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "opt.selectionTargetLang")}</label>
            <select
              className="ast-form-select"
              value={settings.selectionTargetLang}
              onChange={(e) => update("selectionTargetLang", e.target.value)}
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "opt.temperature")}</label>
            <input
              className="ast-form-input"
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={settings.temperature}
              onChange={(e) =>
                update("temperature", parseFloat(e.target.value) || 0.2)
              }
            />
            <div className="ast-form-hint">{t(lang, "opt.temperatureHint")}</div>
          </div>
        </div>

        {/* Smart Target Language */}
        <div className="ast-toggle-row" style={{ marginTop: 8 }}>
          <span className="ast-toggle-label">{t(lang, "opt.smartTargetEnabled")}</span>
          <input
            type="checkbox"
            className="ast-toggle"
            checked={settings.smartTargetEnabled}
            onChange={(e) => update("smartTargetEnabled", e.target.checked)}
          />
        </div>
        <div className="ast-form-hint" style={{ marginTop: -4, marginBottom: 8 }}>
          {t(lang, "opt.smartTargetDescription")}
        </div>

        {settings.smartTargetEnabled && (
          <div className="ast-form-row">
            <div className="ast-form-group">
              <label className="ast-form-label">{t(lang, "opt.secondaryTargetLang")}</label>
              <select
                className="ast-form-select"
                value={settings.secondaryTargetLang}
                onChange={(e) => update("secondaryTargetLang", e.target.value)}
              >
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="ast-form-group">
              <label className="ast-form-label">{t(lang, "opt.smartTargetMaxChars")}</label>
              <input
                className="ast-form-input"
                type="number"
                min="10"
                max="200"
                step="5"
                value={settings.smartTargetMaxChars}
                onChange={(e) =>
                  update("smartTargetMaxChars", parseInt(e.target.value) || 40)
                }
              />
              <div className="ast-form-hint">{t(lang, "opt.smartTargetMaxCharsHint")}</div>
            </div>
          </div>
        )}

        {settings.smartTargetEnabled && (
          <>
            <div className="ast-toggle-row" style={{ marginTop: 4 }}>
              <span className="ast-toggle-label">{t(lang, "opt.sameLanguageToSecondary")}</span>
              <input
                type="checkbox"
                className="ast-toggle"
                checked={settings.sameLanguageToSecondaryEnabled}
                onChange={(e) => update("sameLanguageToSecondaryEnabled", e.target.checked)}
              />
            </div>
            <div className="ast-form-hint" style={{ marginTop: -4, marginBottom: 8 }}>
              {t(lang, "opt.sameLanguageToSecondaryHint")}
            </div>

            {settings.sameLanguageToSecondaryEnabled && (
              <div className="ast-form-row">
                <div className="ast-form-group">
                  <label className="ast-form-label">{t(lang, "opt.sameLanguageMinPurity")}</label>
                  <input
                    className="ast-form-input"
                    type="number"
                    min="0.5"
                    max="0.99"
                    step="0.01"
                    value={settings.sameLanguageMinPurity}
                    onChange={(e) =>
                      update("sameLanguageMinPurity", parseFloat(e.target.value) || 0.82)
                    }
                  />
                  <div className="ast-form-hint">{t(lang, "opt.sameLanguageMinPurityHint")}</div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Dictionary Mode */}
        <div className="ast-toggle-row" style={{ marginTop: 8 }}>
          <span className="ast-toggle-label">{t(lang, "opt.dictionaryMode")}</span>
          <input
            type="checkbox"
            className="ast-toggle"
            checked={settings.dictionaryModeEnabled}
            onChange={(e) => update("dictionaryModeEnabled", e.target.checked)}
          />
        </div>
        <div className="ast-form-hint" style={{ marginTop: -4, marginBottom: 8 }}>
          {t(lang, "opt.dictionaryModeDescription")}
        </div>

        <div className="ast-form-row">
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "opt.timeout")}</label>
            <input
              className="ast-form-input"
              type="number"
              min="5000"
              max="120000"
              step="1000"
              value={settings.timeoutMs}
              onChange={(e) =>
                update("timeoutMs", parseInt(e.target.value) || 30000)
              }
            />
          </div>
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "opt.batchSize")}</label>
            <input
              className="ast-form-input"
              type="number"
              min="500"
              max="20000"
              step="500"
              value={settings.batchSize}
              onChange={(e) =>
                update("batchSize", parseInt(e.target.value) || 4000)
              }
            />
          </div>
        </div>

        <div className="ast-form-row">
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "opt.concurrency")}</label>
            <input
              className="ast-form-input"
              type="number"
              min="1"
              max="8"
              step="1"
              value={settings.concurrency}
              onChange={(e) =>
                update("concurrency", parseInt(e.target.value) || 4)
              }
            />
          </div>
          <div className="ast-form-group" style={{ display: "flex", alignItems: "flex-end", paddingBottom: 4 }}>
            <div className="ast-toggle-row" style={{ width: "100%" }}>
              <span className="ast-toggle-label">{t(lang, "opt.realtime")}</span>
              <input
                type="checkbox"
                className="ast-toggle"
                checked={settings.enableRealtimePageTranslate}
                onChange={(e) =>
                  update("enableRealtimePageTranslate", e.target.checked)
                }
              />
            </div>
          </div>
        </div>

        <div className="ast-toggle-row" style={{ marginTop: 12 }}>
          <span className="ast-toggle-label">{t(lang, "opt.translateWholePage")}</span>
          <input
            type="checkbox"
            className="ast-toggle"
            checked={settings.translateWholePage}
            onChange={(e) => update("translateWholePage", e.target.checked)}
          />
        </div>
        <div className="ast-form-hint" style={{ marginTop: -4, marginBottom: 8 }}>
          {t(lang, "opt.translateWholePageDescription")}
        </div>

        <div className="ast-toggle-row" style={{ marginTop: 4 }}>
          <span className="ast-toggle-label">{t(lang, "opt.translatePageChrome")}</span>
          <input
            type="checkbox"
            className="ast-toggle"
            checked={settings.translatePageChrome}
            onChange={(e) => update("translatePageChrome", e.target.checked)}
          />
        </div>
        <div className="ast-form-hint" style={{ marginTop: -4, marginBottom: 8 }}>
          {t(lang, "opt.translatePageChromeDescription")}
        </div>

        <div className="ast-toggle-row" style={{ marginTop: 4 }}>
          <span className="ast-toggle-label">{t(lang, "opt.translateUiControls")}</span>
          <input
            type="checkbox"
            className="ast-toggle"
            checked={settings.translateUiControls}
            onChange={(e) => update("translateUiControls", e.target.checked)}
          />
        </div>
        <div className="ast-form-hint" style={{ marginTop: -4, marginBottom: 8 }}>
          {t(lang, "opt.translateUiControlsDescription")}
        </div>

        <div className="ast-toggle-row" style={{ marginTop: 4 }}>
          <span className="ast-toggle-label">{t(lang, "opt.streamingPage")}</span>
          <input
            type="checkbox"
            className="ast-toggle"
            checked={settings.enableStreamingPageTranslate}
            onChange={(e) => update("enableStreamingPageTranslate", e.target.checked)}
          />
        </div>
        <div className="ast-form-hint" style={{ marginTop: -4, marginBottom: 8 }}>
          {t(lang, "opt.streamingPageDescription")}
        </div>

        <div className="ast-toggle-row" style={{ marginTop: 4 }}>
          <span className="ast-toggle-label">{t(lang, "opt.siteLexicon")}</span>
          <input
            type="checkbox"
            className="ast-toggle"
            checked={settings.enableSiteLexicon}
            onChange={(e) => update("enableSiteLexicon", e.target.checked)}
          />
        </div>
        <div className="ast-form-hint" style={{ marginTop: -4, marginBottom: 8 }}>
          {t(lang, "opt.siteLexiconDescription")}
        </div>

        <div
          style={{
            marginTop: 4,
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--ast-surface-2, #f3f4f6)",
            fontSize: 13,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: "#6b7280", flex: 1 }}>
              {siteStats && siteStats.phraseCount > 0
                ? t(lang, "opt.siteLexiconStats", {
                    hosts: siteStats.hostCount,
                    phrases: siteStats.phraseCount,
                  })
                : t(lang, "opt.siteLexiconEmpty")}
            </span>
            <button
              type="button"
              className="ast-btn ast-btn-secondary"
              style={{ fontSize: 12, padding: "4px 10px" }}
              onClick={refreshSiteStats}
              disabled={clearingLexicon}
            >
              {t(lang, "opt.refreshStats")}
            </button>
            <button
              type="button"
              className="ast-btn ast-btn-secondary"
              style={{ fontSize: 12, padding: "4px 10px" }}
              onClick={handleClearAllSiteLexicon}
              disabled={clearingLexicon || !siteStats?.phraseCount}
            >
              {t(lang, "opt.clearSiteLexicon")}
            </button>
          </div>
          {siteStats && siteStats.hosts.length > 0 && (
            <ul
              style={{
                margin: "8px 0 0",
                padding: 0,
                listStyle: "none",
                maxHeight: 140,
                overflowY: "auto",
              }}
            >
              {siteStats.hosts.slice(0, 12).map((h) => (
                <li
                  key={h.host}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 0",
                    borderTop: "1px solid rgba(0,0,0,0.06)",
                  }}
                >
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {h.host}
                  </span>
                  <span style={{ color: "#9ca3af", fontSize: 12 }}>{h.phrases}</span>
                  <button
                    type="button"
                    className="ast-btn ast-btn-secondary"
                    style={{ fontSize: 11, padding: "2px 8px" }}
                    disabled={clearingLexicon}
                    onClick={() => handleClearHostLexicon(h.host)}
                  >
                    {t(lang, "opt.clearThisHost")}
                  </button>
                </li>
              ))}
              {siteStats.hosts.length > 12 && (
                <li style={{ padding: "4px 0", color: "#9ca3af", fontSize: 12 }}>
                  {t(lang, "opt.moreHosts", { count: siteStats.hosts.length - 12 })}
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* Custom Glossary Card */}
      <div className="ast-card" id="sec-glossary">
        <div className="ast-card-title">{t(lang, "opt.glossary")}</div>
        <div className="ast-form-hint" style={{ marginTop: -4, marginBottom: 10 }}>
          {t(lang, "opt.glossaryDescription")}
        </div>

        <div className="ast-form-group">
          <textarea
            className="ast-form-textarea"
            rows={8}
            placeholder={t(lang, "opt.glossaryPlaceholder")}
            value={settings.customGlossary || ""}
            onChange={(e) => update("customGlossary", e.target.value)}
          />
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="file"
            accept=".txt,.json"
            ref={fileInputRef}
            style={{ display: "none" }}
            onChange={handleImportGlossary}
          />
          <button
            type="button"
            className="ast-btn ast-btn-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            {t(lang, "opt.glossaryImport")}
          </button>
          <button
            type="button"
            className="ast-btn ast-btn-secondary"
            onClick={handleExportGlossary}
            disabled={!settings.customGlossary}
          >
            {t(lang, "opt.glossaryExport")}
          </button>
          <button
            type="button"
            className="ast-btn ast-btn-ghost"
            onClick={() => update("customGlossary", "")}
            disabled={!settings.customGlossary}
          >
            {t(lang, "opt.reset")}
          </button>
        </div>
      </div>

      {/* Live Video / Tab Audio Subtitles Card */}
      <div className="ast-card" id="sec-live-translate">
        <div className="ast-card-title">{t(lang, "opt.liveSettings")}</div>
        <div className="ast-form-hint" style={{ marginTop: -4, marginBottom: 12 }}>
          {t(lang, "opt.liveSettingsDescription")}
        </div>

        <div className="ast-form-row">
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "live.model")}</label>
            <input
              className="ast-form-input"
              type="text"
              list="live-models-list"
              value={settings.liveTranslateModel || "models/gemini-3.5-live-translate-preview"}
              onChange={(e) => update("liveTranslateModel", e.target.value)}
              placeholder="models/gemini-3.5-live-translate-preview"
            />
            <datalist id="live-models-list">
              <option value="models/gemini-3.5-live-translate-preview">models/gemini-3.5-live-translate-preview（实时同传专用模型，推荐）</option>
              <option value="models/gemini-2.5-flash">models/gemini-2.5-flash</option>
              <option value="models/gemini-2.0-flash">models/gemini-2.0-flash</option>
            </datalist>
          </div>
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "live.targetLang")}</label>
            <select
              className="ast-form-select"
              value={settings.liveTranslateTargetLang || "Simplified Chinese"}
              onChange={(e) => update("liveTranslateTargetLang", e.target.value)}
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="ast-toggle-row">
          <span className="ast-toggle-label">{t(lang, "live.showOriginal")}</span>
          <input
            type="checkbox"
            className="ast-toggle"
            checked={settings.liveTranslateShowOriginal}
            onChange={(e) => update("liveTranslateShowOriginal", e.target.checked)}
          />
        </div>

        <div className="ast-toggle-row" style={{ marginTop: 8 }}>
          <span className="ast-toggle-label">{t(lang, "live.vad")}</span>
          <input
            type="checkbox"
            className="ast-toggle"
            checked={settings.liveTranslateVadEnabled}
            onChange={(e) => update("liveTranslateVadEnabled", e.target.checked)}
          />
        </div>

        <div className="ast-form-row" style={{ marginTop: 10 }}>
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "live.fontSize")}</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input
                type="range"
                min="14"
                max="36"
                step="1"
                value={settings.liveTranslateFontSize || 20}
                onChange={(e) => update("liveTranslateFontSize", parseInt(e.target.value) || 20)}
                style={{ flex: 1 }}
              />
              <span style={{ minWidth: 40, textAlign: "right", fontSize: 13, color: "#6b7280" }}>
                {settings.liveTranslateFontSize || 20}px
              </span>
            </div>
          </div>
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "live.bgOpacity")}</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={settings.liveTranslateBgOpacity ?? 80}
                onChange={(e) => update("liveTranslateBgOpacity", parseInt(e.target.value) ?? 80)}
                style={{ flex: 1 }}
              />
              <span style={{ minWidth: 40, textAlign: "right", fontSize: 13, color: "#6b7280" }}>
                {settings.liveTranslateBgOpacity ?? 80}%
              </span>
            </div>
          </div>
        </div>

        <div className="ast-form-group" style={{ marginTop: 10 }}>
          <label className="ast-form-label">{t(lang, "opt.livePrompt")}</label>
          <textarea
            className="ast-form-textarea"
            rows={4}
            value={settings.liveTranslatePrompt}
            onChange={(e) => update("liveTranslatePrompt", e.target.value)}
          />
        </div>
      </div>

      {/* Floating Ball Card */}
      <div className="ast-card" id="sec-floatingball">

        <div className="ast-card-title">{t(lang, "opt.floatingBall")}</div>

        <div className="ast-toggle-row">
          <span className="ast-toggle-label">{t(lang, "opt.floatingBallEnable")}</span>
          <input
            type="checkbox"
            className="ast-toggle"
            checked={settings.enableFloatingBall}
            onChange={(e) => update("enableFloatingBall", e.target.checked)}
          />
        </div>

        <div className="ast-form-row" style={{ marginTop: 12 }}>
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "opt.floatingBallSize")}</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input
                type="range"
                min="32"
                max="80"
                step="2"
                value={settings.floatingBallSize}
                onChange={(e) => update("floatingBallSize", parseInt(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ minWidth: 40, textAlign: "right", fontSize: 13, color: "#6b7280" }}>
                {settings.floatingBallSize}px
              </span>
            </div>
          </div>
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "opt.floatingBallOpacity")}</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={Math.round(settings.floatingBallOpacity * 100)}
                onChange={(e) => update("floatingBallOpacity", parseInt(e.target.value) / 100)}
                style={{ flex: 1 }}
              />
              <span style={{ minWidth: 40, textAlign: "right", fontSize: 13, color: "#6b7280" }}>
                {Math.round(settings.floatingBallOpacity * 100)}%
              </span>
            </div>
          </div>
        </div>

        <div className="ast-form-group">
          <label className="ast-form-label">{t(lang, "opt.popupScale")}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
              type="range"
              min="80"
              max="180"
              step="10"
              value={Math.round(settings.popupScale * 100)}
              onChange={(e) => update("popupScale", parseInt(e.target.value) / 100)}
              style={{ flex: 1 }}
            />
            <span style={{ minWidth: 44, textAlign: "right", fontSize: 13, color: "#6b7280" }}>
              {Math.round(settings.popupScale * 100)}%
            </span>
          </div>
        </div>
      </div>

      {/* Chat page-context card */}
      <div className="ast-card" id="sec-chat-context">
        <div className="ast-card-title">{t(lang, "opt.chatContext")}</div>

        <div className="ast-toggle-row">
          <span className="ast-toggle-label">{t(lang, "opt.chatAutoAttach")}</span>
          <input
            type="checkbox"
            className="ast-toggle"
            checked={settings.chatAutoAttachPage}
            onChange={(e) => update("chatAutoAttachPage", e.target.checked)}
          />
        </div>
        <div className="ast-form-hint ast-web-search-description">
          {t(lang, "opt.chatAutoAttachDescription")}
        </div>
      </div>

      {/* Built-in chat web search card */}
      <div className="ast-card" id="sec-web-search">
        <div className="ast-card-title">{t(lang, "opt.webSearch")}</div>

        <div className="ast-toggle-row">
          <span className="ast-toggle-label">{t(lang, "opt.webSearchEnable")}</span>
          <input
            type="checkbox"
            className="ast-toggle"
            checked={settings.chatWebSearchEnabled}
            onChange={(e) => update("chatWebSearchEnabled", e.target.checked)}
          />
        </div>
        <div className="ast-form-hint ast-web-search-description">
          {t(lang, "opt.webSearchDescription")}
        </div>
      </div>

      {/* Prompt Settings Card */}
      <div className="ast-card" id="sec-prompt">
        <div className="ast-card-title">{t(lang, "opt.prompt")}</div>

        <div className="ast-form-group">
          <label className="ast-form-label">{t(lang, "opt.selectionPrompt")}</label>
          <textarea
            className="ast-form-textarea"
            value={settings.selectionPrompt}
            onChange={(e) => update("selectionPrompt", e.target.value)}
            rows={6}
          />
          <div className="ast-form-hint">
            {t(lang, "opt.promptHint1", { targetLang: "{{targetLang}}" })}
          </div>
        </div>

        <div className="ast-form-group">
          <label className="ast-form-label">{t(lang, "opt.pagePrompt")}</label>
          <textarea
            className="ast-form-textarea"
            value={settings.pagePrompt}
            onChange={(e) => update("pagePrompt", e.target.value)}
            rows={8}
          />
          <div className="ast-form-hint">
            {t(lang, "opt.promptHint2", { targetLang: "{{targetLang}}" })}
          </div>
        </div>

        <div className="ast-form-group">
          <label className="ast-form-label">{t(lang, "opt.chatPrompt")}</label>
          <textarea
            className="ast-form-textarea"
            value={settings.chatPrompt}
            onChange={(e) => update("chatPrompt", e.target.value)}
            rows={5}
          />
          <div className="ast-form-hint">
            {t(lang, "opt.chatPromptHint", { lang: "{{lang}}" })}
          </div>
        </div>

        <button className="ast-btn ast-btn-secondary" onClick={handleResetPrompts}>
          {t(lang, "opt.resetPrompts")}
        </button>
      </div>

      {/* Auto-save status + reset */}
      <div className="ast-options-actions">
        <span className={`ast-autosave-status ${
          saveStatus === "saving" ? "ast-autosave-saving" :
          saveStatus === "saved" ? "ast-autosave-saved" : ""
        }`}>
          {saveStatus === "saving" && t(lang, "opt.autoSaving")}
          {saveStatus === "saved" && `✓ ${t(lang, "opt.saved")}`}
        </span>
        <button className="ast-btn ast-btn-ghost" onClick={handleReset}>
          {t(lang, "opt.reset")}
        </button>
      </div>

      {/* Footer */}
      <div className="ast-options-footer">
        {t(lang, "app.version")}
      </div>

      {/* Toast */}
      {toast && <div className="ast-toast">{toast}</div>}
    </div>
  );
}

// Mount React app
const root = createRoot(document.getElementById("root")!);
root.render(<Options />);
