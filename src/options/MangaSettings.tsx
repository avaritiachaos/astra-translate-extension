import React, { useEffect, useRef, useState } from "react";
import type { AstraSettings } from "../shared/types";
import type { MangaSettings as Settings, MangaThinkingEffort } from "../shared/manga/types";
import {
  DEFAULT_PROVIDER_PRESETS,
  SUPPORTED_LANGUAGES,
} from "../shared/constants";
import { t } from "../shared/i18n";
import { resolveMangaConfiguration } from "../shared/manga/configuration";
export function MangaSettingsCard({
  settings,
  onChange,
}: {
  settings: AstraSettings;
  onChange: (value: Settings) => void;
}) {
  const lang = settings.uiLanguage;
  const configuration = resolveMangaConfiguration(settings).status;
  const connection = resolveMangaConfiguration(settings, { requireModel: false }).status;
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const modelGeneration = useRef(0);
  useEffect(() => {
    modelGeneration.current++;
    setModels([]);
    setModelsError("");
    setModelsLoading(false);
    return () => { modelGeneration.current++; };
  }, [settings.providerId, settings.manga.providerId, settings.baseUrl,
    settings.endpoint, settings.apiKey, settings.customHeaders, settings.providerConfigs]);
  const loadModels = async () => {
    const version = ++modelGeneration.current;
    setModelsLoading(true);
    setModelsError("");
    try {
      const response = await chrome.runtime.sendMessage({ type: "MANGA_MODELS", payload: { settings } });
      if (version !== modelGeneration.current) return;
      if (!response?.success) throw new Error(response?.error || t(lang, "manga.modelsFailed"));
      setModels(response.models);
    } catch (error) {
      if (version === modelGeneration.current)
        setModelsError(error instanceof Error ? error.message : t(lang, "manga.modelsFailed"));
    } finally {
      if (version === modelGeneration.current) setModelsLoading(false);
    }
  };
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const generation = useRef(0),
    jobId = useRef<string>();
  const cancel = () => {
    generation.current++;
    if (jobId.current)
      void chrome.runtime
        .sendMessage({ type: "MANGA_CANCEL", payload: { id: jobId.current } })
        .catch(() => {});
    jobId.current = undefined;
    setBusy(false);
  };
  useEffect(() => {
    cancel();
    setResult(null);
  }, [
    settings.manga,
    settings.providerConfigs,
    settings.apiKey,
    settings.providerId,
    settings.apiFormat,
    settings.endpoint,
    settings.baseUrl,
    settings.customHeaders,
  ]);
  useEffect(
    () => () => {
      generation.current++;
      if (jobId.current)
        void chrome.runtime
          .sendMessage({ type: "MANGA_CANCEL", payload: { id: jobId.current } })
          .catch(() => {});
    },
    [],
  );
  const test = async () => {
    const version = ++generation.current;
    setBusy(true);
    setResult(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: "MANGA_PROBE",
        payload: { settings },
      });
      if (!response?.success)
        throw new Error(response?.error || t(lang, "manga.failed"));
      if (version !== generation.current) {
        void chrome.runtime.sendMessage({
          type: "MANGA_CANCEL",
          payload: { id: response.jobId },
        });
        return;
      }
      jobId.current = response.jobId;
      while (version === generation.current) {
        const state = await chrome.runtime.sendMessage({
          type: "MANGA_STATUS",
          payload: { id: response.jobId },
        });
        if (version !== generation.current) return;
        if (!state?.success || !state.job)
          throw new Error(t(lang, "manga.interrupted"));
        if (state.job.phase === "ready") {
          setResult({ ok: true, text: t(lang, "manga.verified") });
          break;
        }
        if (["failed", "cancelled", "interrupted"].includes(state.job.phase))
          throw new Error(state.job.error || t(lang, "manga.visionFailed"));
        await new Promise((resolve) => setTimeout(resolve, 650));
      }
    } catch (error) {
      if (version === generation.current)
        setResult({
          ok: false,
          text:
            error instanceof Error ? error.message : t(lang, "manga.failed"),
        });
    } finally {
      if (version === generation.current) {
        setBusy(false);
        jobId.current = undefined;
      }
    }
  };
  return (
    <div className="ast-card" id="sec-manga">
      <div className="ast-card-title">{t(lang, "manga.title")}</div>
      <p className="ast-form-hint">{t(lang, "manga.description")}</p>
      <div className="ast-form-row">
        <div className="ast-form-group">
          <label className="ast-form-label" htmlFor="manga-provider">
            {t(lang, "opt.provider")}
          </label>
          <select
            id="manga-provider"
            className="ast-form-select"
            value={settings.manga.providerId}
            onChange={(e) =>
              onChange({ ...settings.manga, providerId: e.target.value })
            }
          >
            <option value="current">
              {t(lang, "manga.followCurrent", { provider: settings.providerName })}
            </option>
            {DEFAULT_PROVIDER_PRESETS.filter(
              (p) => p.apiFormat === "openai-compatible",
            ).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ast-form-group">
          <label className="ast-form-label" htmlFor="manga-model">
            {t(lang, "manga.model")}
          </label>
          <input
            id="manga-model"
            className="ast-form-input"
            value={settings.manga.modelId}
            placeholder={t(lang, "manga.modelPlaceholder")}
            maxLength={200}
            onChange={(e) =>
              onChange({ ...settings.manga, modelId: e.target.value })
            }
          />
        </div>
        <div className="ast-form-group">
          <label className="ast-form-label" htmlFor="manga-language">
            {t(lang, "manga.target")}
          </label>
          <select
            id="manga-language"
            className="ast-form-select"
            value={settings.manga.targetLanguage}
            onChange={(e) =>
              onChange({ ...settings.manga, targetLanguage: e.target.value })
            }
          >
            {SUPPORTED_LANGUAGES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="ast-form-group">
          <label className="ast-form-label" htmlFor="manga-effort">
            {t(lang, "manga.effort")}
          </label>
          <select
            id="manga-effort"
            className="ast-form-select"
            value={settings.manga.thinkingEffort ?? "low"}
            onChange={(e) =>
              onChange({
                ...settings.manga,
                thinkingEffort: e.target.value as MangaThinkingEffort,
              })
            }
          >
            <option value="low">{t(lang, "manga.effortLow")}</option>
            <option value="default">{t(lang, "manga.effortDefault")}</option>
            <option value="medium">{t(lang, "manga.effortMedium")}</option>
            <option value="high">{t(lang, "manga.effortHigh")}</option>
            <option value="off">{t(lang, "manga.effortOff")}</option>
          </select>
        </div>
      </div>
      <p className="ast-form-hint" style={{ marginTop: -4, marginBottom: 12 }}>
        {t(lang, "manga.effortHint")}
      </p>
      <div className="ast-form-group">
        <button type="button" className="ast-btn ast-btn-secondary"
          disabled={modelsLoading || busy || !connection.ready} onClick={() => void loadModels()}>
          {t(lang, modelsLoading ? "manga.modelsLoading" : "manga.loadModels")}
        </button>
        {models.length > 0 && <>
          <label className="ast-form-label" htmlFor="manga-available-models" style={{ marginTop: 10 }}>{t(lang, "manga.availableModels")}</label>
          <select id="manga-available-models" className="ast-form-select"
            value={models.includes(settings.manga.modelId) ? settings.manga.modelId : ""}
            onChange={event => { if (event.target.value) onChange({ ...settings.manga, modelId: event.target.value }); }}>
            <option value="" disabled>{t(lang, "manga.selectModel")}</option>
            {models.map(model => <option value={model} key={model}>{model}</option>)}
          </select>
          {!!settings.manga.modelId && !models.includes(settings.manga.modelId) &&
            <p role="status" style={{ color: "var(--ast-error)" }}>{t(lang, "error.modelUnavailable", { model: settings.manga.modelId })}</p>}
        </>}
        {modelsError && <p role="status" style={{ color: "var(--ast-error)" }}>{modelsError}</p>}
        <p className="ast-form-hint">{t(lang, "manga.modelListHint")}</p>
      </div>
      <div id="manga-configuration-status" role="status" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12, overflowWrap: "anywhere" }}>
        <div>{t(lang, "manga.activeConfiguration", { provider: configuration.providerName, model: configuration.modelId || "—" })}</div>
        {configuration.origin && <div>{t(lang, "manga.requestOrigin", { origin: configuration.origin })}</div>}
        <div style={{ color: configuration.ready ? "var(--ast-success)" : "var(--ast-error)" }}>
          {configuration.ready ? t(lang, "manga.configurationReady") : configuration.error}
        </div>
      </div>
      {!configuration.followsCurrent && <button
        type="button" className="ast-btn ast-btn-secondary" disabled={busy}
        onClick={() => onChange({ ...settings.manga, providerId: "current" })}
      >{t(lang, "manga.useCurrent", { provider: settings.providerName })}</button>}
      <p className="ast-form-hint">{t(lang, "manga.setupHint")}</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          className="ast-btn ast-btn-primary"
          disabled={busy || !configuration.ready}
          onClick={() => void test()}
        >
          {t(lang, busy ? "manga.verifying" : "manga.verify")}
        </button>
        {busy && (
          <button className="ast-btn ast-btn-secondary" onClick={cancel}>
            {t(lang, "manga.cancel")}
          </button>
        )}
      </div>
      {result && (
        <p
          role="status"
          style={{
            color: result.ok ? "var(--ast-success)" : "var(--ast-error)",
            fontSize: 13,
            marginBottom: 0,
          }}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
