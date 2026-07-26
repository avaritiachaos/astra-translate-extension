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

// All mutations run through one promise chain (mirrors siteLexiconStore):
// concurrent page batches would otherwise load the same snapshot and the
// later save would silently drop the earlier one's entries.
let mutationChain: Promise<unknown> = Promise.resolve();
function serialized<T>(op: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(op, op);
  mutationChain = run.catch(() => {});
  return run;
}

// ---- Lazy LRU bookkeeping -------------------------------------------------
// Reads used to rewrite the whole store just to bump lastUsedAt/hits — one
// full-store serialization per cache-hit batch on the hot path. Touches now
// accumulate in memory and flush debounced (or piggyback on the next write).
// If the service worker dies before a flush, only LRU metadata is lost —
// eviction gets marginally less accurate, translations are unaffected.
const pendingTouches = new Map<string, { lastUsedAt: number; hits: number }>();
let touchFlushTimer: ReturnType<typeof setTimeout> | undefined;
const TOUCH_FLUSH_MS = 3000;
const TOUCH_FLUSH_MAX_PENDING = 512;

function recordTouch(key: string, now: number): void {
  const pending = pendingTouches.get(key);
  if (pending) {
    pending.lastUsedAt = now;
    pending.hits += 1;
  } else {
    pendingTouches.set(key, { lastUsedAt: now, hits: 1 });
  }
  if (pendingTouches.size >= TOUCH_FLUSH_MAX_PENDING) {
    if (touchFlushTimer) {
      clearTimeout(touchFlushTimer);
      touchFlushTimer = undefined;
    }
    void flushTouches();
    return;
  }
  if (!touchFlushTimer) {
    touchFlushTimer = setTimeout(() => {
      touchFlushTimer = undefined;
      void flushTouches();
    }, TOUCH_FLUSH_MS);
  }
}

/** Merge pending LRU bumps into a loaded store. Returns true if it changed. */
function drainTouchesInto(store: CacheStore): boolean {
  if (pendingTouches.size === 0) return false;
  let dirty = false;
  for (const [key, touch] of pendingTouches) {
    const entry = store.entries[key];
    if (!entry) continue; // evicted or cleared meanwhile
    entry.lastUsedAt = Math.max(entry.lastUsedAt, touch.lastUsedAt);
    entry.hits += touch.hits;
    dirty = true;
  }
  pendingTouches.clear();
  return dirty;
}

async function flushTouches(): Promise<void> {
  await serialized(async () => {
    const store = await loadStore();
    if (drainTouchesInto(store)) await saveStore(store);
  }).catch(() => {
    // LRU metadata only — a failed flush must never surface as an error.
  });
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

  recordTouch(key, Date.now());

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

  for (const key of keys) {
    const entry = store.entries[key];
    if (!entry) continue;

    recordTouch(key, now);
    hits.set(key, {
      translation: entry.translation,
      resolvedLang: entry.resolvedLang,
      dictionaryResult: entry.dictionaryResult,
    });
  }

  return hits;
}

export async function setCachedTranslation(
  key: string,
  value: CachedTranslationValue,
  settings: AstraSettings,
): Promise<void> {
  return setCachedTranslations([{ key, value }], settings);
}

export async function setCachedTranslations(
  values: Array<{ key: string; value: CachedTranslationValue }>,
  settings: AstraSettings,
): Promise<void> {
  const writable = values.filter(({ value }) => value.translation);
  if (!settings.enableTranslationCache || writable.length === 0) return;

  await serialized(async () => {
    const store = await loadStore();
    const now = Date.now();
    // Piggyback pending LRU bumps on this write — entries touched by reads
    // keep their recency even if the debounced flush never fires.
    drainTouchesInto(store);
    for (const { key, value } of writable) {
      store.entries[key] = {
        ...value,
        createdAt: store.entries[key]?.createdAt || now,
        lastUsedAt: now,
        hits: store.entries[key]?.hits || 0,
      };
    }
    trimStore(store, maxEntries(settings));
    await saveStore(store);
  });
}
