// ============================================================
// Astra Translate - Persistent Translation Cache
// ============================================================

import type { AstraSettings, DictionaryResult } from "../shared/types";

const CACHE_STORAGE_KEY = "astra_translation_cache_v1";
const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 5000;

export interface CachedTranslationValue {
  translation: string;
  resolvedLang?: string;
  dictionaryResult?: DictionaryResult;
}

interface CacheEntry extends CachedTranslationValue {
  createdAt: number;
  lastUsedAt: number;
  hits: number;
}

interface CacheStore {
  version: number;
  entries: Record<string, CacheEntry>;
}

export interface TranslationCacheKeyInput {
  mode: "page" | "manual" | "selection" | "dictionary";
  text: string;
  targetLang: string;
  systemPrompt: string;
  settings: AstraSettings;
  contextBefore?: string;
  contextAfter?: string;
  fullLineText?: string;
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function providerFingerprint(settings: AstraSettings): string {
  return [
    settings.providerId,
    settings.apiFormat,
    settings.baseUrl,
    settings.endpoint,
    settings.model,
  ].join("\n");
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function loadStore(): Promise<CacheStore> {
  const result = await chrome.storage.local.get(CACHE_STORAGE_KEY);
  const store = result[CACHE_STORAGE_KEY] as CacheStore | undefined;
  if (!store || store.version !== CACHE_SCHEMA_VERSION || !store.entries) {
    return { version: CACHE_SCHEMA_VERSION, entries: {} };
  }
  return store;
}

async function saveStore(store: CacheStore): Promise<void> {
  await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: store });
}

function maxEntries(settings: AstraSettings): number {
  const configured = settings.translationCacheMaxEntries;
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_MAX_ENTRIES;
  return Math.floor(configured);
}

function trimStore(store: CacheStore, max: number): void {
  const entries = Object.entries(store.entries);
  if (entries.length <= max) return;

  entries
    .sort(([, a], [, b]) => a.lastUsedAt - b.lastUsedAt)
    .slice(0, entries.length - max)
    .forEach(([key]) => {
      delete store.entries[key];
    });
}

export async function createTranslationCacheKey(input: TranslationCacheKeyInput): Promise<string> {
  const keyPayload = {
    version: CACHE_SCHEMA_VERSION,
    mode: input.mode,
    provider: providerFingerprint(input.settings),
    targetLang: input.targetLang,
    systemPrompt: input.systemPrompt,
    text: normalizeText(input.text),
    contextBefore: normalizeText(input.contextBefore || ""),
    contextAfter: normalizeText(input.contextAfter || ""),
    fullLineText: normalizeText(input.fullLineText || ""),
  };

  return sha256(JSON.stringify(keyPayload));
}

export async function getCachedTranslation(
  key: string,
  settings: AstraSettings,
): Promise<CachedTranslationValue | null> {
  if (!settings.enableTranslationCache) return null;

  const store = await loadStore();
  const entry = store.entries[key];
  if (!entry) return null;

  entry.lastUsedAt = Date.now();
  entry.hits += 1;
  await saveStore(store);

  return {
    translation: entry.translation,
    resolvedLang: entry.resolvedLang,
    dictionaryResult: entry.dictionaryResult,
  };
}

export async function getCachedTranslations(
  keys: string[],
  settings: AstraSettings,
): Promise<Map<string, CachedTranslationValue>> {
  const hits = new Map<string, CachedTranslationValue>();
  if (!settings.enableTranslationCache || keys.length === 0) return hits;

  const store = await loadStore();
  const now = Date.now();
  let touched = false;

  for (const key of keys) {
    const entry = store.entries[key];
    if (!entry) continue;

    entry.lastUsedAt = now;
    entry.hits += 1;
    touched = true;
    hits.set(key, {
      translation: entry.translation,
      resolvedLang: entry.resolvedLang,
      dictionaryResult: entry.dictionaryResult,
    });
  }

  if (touched) {
    await saveStore(store);
  }

  return hits;
}

export async function setCachedTranslation(
  key: string,
  value: CachedTranslationValue,
  settings: AstraSettings,
): Promise<void> {
  if (!settings.enableTranslationCache || !value.translation) return;

  const store = await loadStore();
  const now = Date.now();
  store.entries[key] = {
    ...value,
    createdAt: store.entries[key]?.createdAt || now,
    lastUsedAt: now,
    hits: store.entries[key]?.hits || 0,
  };
  trimStore(store, maxEntries(settings));
  await saveStore(store);
}

export async function setCachedTranslations(
  values: Array<{ key: string; value: CachedTranslationValue }>,
  settings: AstraSettings,
): Promise<void> {
  if (!settings.enableTranslationCache || values.length === 0) return;

  const store = await loadStore();
  const now = Date.now();
  for (const { key, value } of values) {
    if (!value.translation) continue;
    store.entries[key] = {
      ...value,
      createdAt: store.entries[key]?.createdAt || now,
      lastUsedAt: now,
      hits: store.entries[key]?.hits || 0,
    };
  }
  trimStore(store, maxEntries(settings));
  await saveStore(store);
}
