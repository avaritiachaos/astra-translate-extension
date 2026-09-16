import type { AstraSettings, UserProviderSettings } from "../types";
import { DEFAULT_PROVIDER_PRESETS } from "../constants.ts";
import { switchProviderSettings } from "../storage.ts";
import { isVisionCapable } from "../modelCapability.ts";
import { t } from "../i18n.ts";

export interface MangaConfigurationStatus {
  ready: boolean;
  followsCurrent: boolean;
  isModelInherited?: boolean;
  providerId: string;
  providerName: string;
  modelId: string;
  origin: string;
  hasApiKey: boolean;
  error?: string;
  errorCode?: "MANGA_PROVIDER_INVALID" | "MANGA_FORMAT_UNSUPPORTED" | "API_KEY_MISSING" | "MANGA_ENDPOINT_MISSING" | "MANGA_SETTINGS_INVALID";
}

/** Resolve one provider as a unit. Never borrow a key from a different host. */
export function resolveMangaConfiguration(settings: AstraSettings, options: { requireModel?: boolean } = {}): {
  provider: UserProviderSettings;
  status: MangaConfigurationStatus;
} {
  const manga = settings.manga;
  const followsCurrent = manga?.providerId === "current";
  const targetId = followsCurrent ? settings.providerId : typeof manga?.providerId === "string" ? manga.providerId : "";
  const preset = DEFAULT_PROVIDER_PRESETS.find(p => p.id === targetId);
  const isCurrent = targetId === settings.providerId;
  const provider = isCurrent ? { ...settings } : switchProviderSettings(settings, targetId);
  const providerName = isCurrent
    ? settings.providerName || preset?.name || t(settings.uiLanguage, "manga.currentProvider")
    : preset?.name || t(settings.uiLanguage, "manga.unknownProvider");
  let origin = "";
  try {
    const url = new URL(provider.baseUrl.trim());
    if (/^https?:$/.test(url.protocol) && !url.username && !url.password) origin = url.origin;
  } catch { /* Report invalid/missing endpoint below. */ }

  const explicitModel = typeof manga?.modelId === "string" ? manga.modelId.trim() : "";
  const fallbackModel =
    followsCurrent &&
    !explicitModel &&
    typeof provider.model === "string" &&
    isVisionCapable(provider.providerId, provider.model)
      ? provider.model.trim()
      : "";
  const modelId = explicitModel || fallbackModel;

  const status: MangaConfigurationStatus = {
    ready: false,
    followsCurrent,
    isModelInherited: Boolean(!explicitModel && fallbackModel),
    providerId: targetId,
    providerName,
    modelId,
    origin,
    hasApiKey: typeof provider.apiKey === "string" && Boolean(provider.apiKey.trim()),
  };
  const fail = (errorCode: MangaConfigurationStatus["errorCode"], key: string) => {
    status.errorCode = errorCode;
    status.error = t(settings.uiLanguage, key, { provider: providerName });
    return { provider, status };
  };
  if ((!isCurrent && !preset) || !targetId) {
    status.hasApiKey = false;
    status.origin = "";
    return fail("MANGA_PROVIDER_INVALID", "manga.providerInvalid");
  }
  if (provider.apiFormat !== "openai-compatible")
    return fail("MANGA_FORMAT_UNSUPPORTED", "manga.formatUnsupported");
  if (!status.hasApiKey) return fail("API_KEY_MISSING", "manga.providerKeyMissing");
  if (!origin) return fail("MANGA_ENDPOINT_MISSING", "manga.providerEndpointMissing");
  if (options.requireModel !== false && (!status.modelId || status.modelId.length > 200 ||
      typeof manga?.targetLanguage !== "string" || !manga.targetLanguage.trim() || manga.targetLanguage.length > 100))
    return fail("MANGA_SETTINGS_INVALID", "manga.modelOrLanguageMissing");
  status.ready = true;
  return { provider, status };
}
