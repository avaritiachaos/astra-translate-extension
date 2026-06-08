import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import type { AstraSettings, ProviderApiFormat } from "../shared/types";
import { t, type UiLanguage } from "../shared/i18n";
import {
  DEFAULT_PROVIDER_PRESETS,
  SUPPORTED_LANGUAGES,
} from "../shared/constants";
import { DEFAULT_SELECTION_PROMPT, DEFAULT_PAGE_PROMPT } from "../shared/prompts";
import { getDefaultSettings } from "../shared/storage";
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
  const [dirty, setDirty] = useState(false);

  const lang: UiLanguage = settings.uiLanguage || "zh-CN";

  // Load settings
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }).then((s) => {
      if (s) setSettings(s);
    });
  }, []);

  // Mark dirty on any change
  const update = useCallback(
    <K extends keyof AstraSettings>(key: K, value: AstraSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      setDirty(true);
    },
    []
  );

  // Provider preset change
  const handlePresetChange = useCallback(
    (presetId: string) => {
      const preset = DEFAULT_PROVIDER_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      setSettings((prev) => ({
        ...prev,
        providerId: preset.id,
        providerName: preset.name,
        apiFormat: preset.apiFormat,
        baseUrl: preset.baseUrl,
        endpoint: preset.endpoint,
        model: preset.defaultModel || prev.model,
      }));
      setDirty(true);
    },
    []
  );

  // Save
  const handleSave = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({
        type: "SAVE_SETTINGS",
        payload: settings,
      });
      setDirty(false);
      showToast(t(lang, "opt.saved"));
    } catch {
      showToast(t(lang, "opt.saveFailed"));
    }
  }, [settings, lang]);

  // Reset to defaults
  const handleReset = useCallback(async () => {
    const defaults = getDefaultSettings();
    setSettings(defaults);
    setDirty(true);
    setTestResult(null);
  }, []);

  // Reset prompts
  const handleResetPrompts = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      selectionPrompt: DEFAULT_SELECTION_PROMPT,
      pagePrompt: DEFAULT_PAGE_PROMPT,
    }));
    setDirty(true);
  }, []);

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
        // Auto-save on success
        try {
          await chrome.runtime.sendMessage({
            type: "SAVE_SETTINGS",
            payload: settings,
          });
          setDirty(false);
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

  // Toast helper
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  }, []);

  const selectedPreset = DEFAULT_PROVIDER_PRESETS.find(
    (p) => p.id === settings.providerId
  );

  return (
    <div className="ast-options-container">
      {/* Header */}
      <div className="ast-options-header">
        <div className="ast-options-logo">{t(lang, "app.name")}</div>
        <div className="ast-options-desc">{t(lang, "app.desc")}</div>
      </div>

      {/* Provider Card */}
      <div className="ast-card">
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
              placeholder="https://api.deepseek.com"
            />
          </div>
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "opt.endpoint")}</label>
            <input
              className="ast-form-input"
              type="text"
              value={settings.endpoint}
              onChange={(e) => update("endpoint", e.target.value)}
              placeholder="/chat/completions"
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
              placeholder="deepseek-v4-flash"
            />
          </div>
          <div className="ast-form-group">
            <label className="ast-form-label">{t(lang, "opt.apiKey")}</label>
            <div className="ast-api-key-group">
              <input
                className="ast-form-input"
                type={showKey ? "text" : "password"}
                value={settings.apiKey}
                onChange={(e) => update("apiKey", e.target.value)}
                placeholder="sk-..."
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
      <div className="ast-card">
        <div className="ast-card-title">{t(lang, "opt.uiLang")}</div>
        <div className="ast-form-group">
          <select
            className="ast-form-select"
            value={settings.uiLanguage}
            onChange={(e) => update("uiLanguage", e.target.value as UiLanguage)}
          >
            <option value="zh-CN">简体中文</option>
            <option value="en-US">English</option>
          </select>
        </div>
      </div>

      {/* Translation Settings Card */}
      <div className="ast-card">
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
              max="5"
              step="1"
              value={settings.concurrency}
              onChange={(e) =>
                update("concurrency", parseInt(e.target.value) || 2)
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
      </div>

      {/* Prompt Settings Card */}
      <div className="ast-card">
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

        <button className="ast-btn ast-btn-secondary" onClick={handleResetPrompts}>
          {t(lang, "opt.resetPrompts")}
        </button>
      </div>

      {/* Actions */}
      <div className="ast-options-actions">
        <button className="ast-btn ast-btn-primary" onClick={handleSave}>
          {t(lang, "opt.save")}
        </button>
        <button className="ast-btn ast-btn-secondary" onClick={handleReset}>
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
