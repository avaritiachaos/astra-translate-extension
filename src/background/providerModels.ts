import type { UserProviderSettings } from "../shared/types";
import { t, type UiLanguage } from "../shared/i18n.ts";
import { buildRequestParts } from "./openAICompatibleClient.ts";

const MAX_BYTES = 512 * 1024;
export function parseProviderModels(data: unknown): string[] {
  const rows = (data as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) throw new Error("MODEL_LIST_INVALID");
  return [...new Set(rows.flatMap(row => {
    const id = row?.id;
    return typeof id === "string" && id.length > 0 && id.length <= 200 &&
      id === id.trim() && !/[\u0000-\u001f\u007f]/.test(id) ? [id] : [];
  }))].sort((a, b) => a.localeCompare(b));
}

export async function listProviderModels(provider: UserProviderSettings, lang: UiLanguage) {
  const { headers } = buildRequestParts(provider, [], false, lang, { optionalBody: {} });
  let response: Response;
  try {
    response = await fetch(provider.baseUrl.replace(/\/+$/, "") + "/models", {
      method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { success: false as const, error: t(lang, "manga.modelsFailed") };
  }
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => {});
    return { success: false as const, error: t(lang, "manga.modelsHttpError", { status: response.status }) };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("MODEL_LIST_TOO_LARGE");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const models = parseProviderModels(JSON.parse(text));
    if (!models.length) return { success: false as const, error: t(lang, "manga.modelsEmpty") };
    return { success: true as const, models };
  } catch {
    return { success: false as const, error: t(lang, "manga.modelsFailed") };
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
