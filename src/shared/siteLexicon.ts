// ============================================================
// Astra Translate – Per-site learned UI phrases
// ============================================================
// Short labels learned from successful page translations, keyed by
// hostname + target language. Instant on next visit (zero API).
// (No cross-file imports — unit-testable under Node strip-types.)

export const SITE_LEXICON_STORAGE_KEY = "astra_site_lexicon_v1";

/** Same normalization as the global UI lexicon. Locale-independent lowercase:
 * toLocaleLowerCase would break every latin key on tr/az systems (İ→i̇, I→ı). */
function normalizeUiKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}
export const SITE_LEXICON_SCHEMA_VERSION = 1;
/** Max characters for a learnable phrase (matches UI lexicon). */
export const SITE_LEXICON_MAX_CHARS = 48;
/** Cap phrases per host+lang to bound storage. */
export const SITE_LEXICON_MAX_PER_HOST_LANG = 400;
/** Global cap across all hosts/langs — bounds total chrome.storage usage
 * (shares the 10MB local quota with the translation cache). */
export const SITE_LEXICON_MAX_TOTAL = 20_000;

export interface SiteLexiconEntry {
  translation: string;
  lastUsedAt: number;
  hits: number;
}

/** host → targetLang → sourceNorm → entry */
export type SiteLexiconHosts = Record<
  string,
  Record<string, Record<string, SiteLexiconEntry>>
>;

export interface SiteLexiconStore {
  version: number;
  hosts: SiteLexiconHosts;
}

export function emptySiteLexiconStore(): SiteLexiconStore {
  return { version: SITE_LEXICON_SCHEMA_VERSION, hosts: {} };
}

/** Hostname for storage (no port), lowercased. */
export function siteLexiconHost(hostname?: string): string {
  return (hostname || "").trim().toLowerCase();
}

/**
 * Is this pair worth learning? Only short UI-like phrases; skip when
 * source equals translation or looks like long prose.
 */
export function isLearnableUiPair(source: string, translation: string): boolean {
  const src = source.trim();
  const dst = translation.trim();
  if (!src || !dst) return false;
  if (src.length > SITE_LEXICON_MAX_CHARS) return false;
  if (dst.length > SITE_LEXICON_MAX_CHARS * 2) return false;
  if (src === dst) return false;
  // Need at least one letter in source (any script).
  if (!/\p{L}/u.test(src)) return false;
  // Reject multi-sentence prose (period + long tail).
  if (/[.!?。！？].{12,}/.test(src)) return false;
  // Too many words → likely a sentence, not a chrome label.
  const words = src.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  return true;
}

/**
 * Look up a learned translation. Tries the same key set the writer uses
 * (upsertLearnedPair stores under the colon-stripped key), so "Имя:" finds
 * the entry learned from "Имя".
 */
export function lookupInStore(
  store: SiteLexiconStore,
  host: string,
  targetLang: string,
  source: string
): string | null {
  return lookupInStoreWithKeys(store, host, targetLang, source);
}

/** Keys to try: full normalized text and without trailing colon. */
export function siteLexiconKeys(source: string): string[] {
  const norm = normalizeUiKey(source);
  if (!norm) return [];
  const keys = [norm];
  const noColon = norm.replace(/[:：]\s*$/, "").trim();
  if (noColon && noColon !== norm) keys.push(noColon);
  return keys;
}

export function lookupInStoreWithKeys(
  store: SiteLexiconStore,
  host: string,
  targetLang: string,
  source: string
): string | null {
  const h = siteLexiconHost(host);
  if (!h) return null;
  const bucket = store.hosts[h]?.[targetLang];
  if (!bucket) return null;

  for (const key of siteLexiconKeys(source)) {
    const entry = bucket[key];
    if (!entry?.translation) continue;
    const trimmed = source.trim();
    let out = entry.translation;
    if (/[:：]\s*$/.test(trimmed) && !/[:：]\s*$/.test(out)) {
      out += trimmed.includes("：") ? "：" : ":";
    }
    return out;
  }
  return null;
}

export function upsertLearnedPair(
  store: SiteLexiconStore,
  host: string,
  targetLang: string,
  source: string,
  translation: string,
  now = Date.now()
): boolean {
  if (!isLearnableUiPair(source, translation)) return false;
  const h = siteLexiconHost(host);
  if (!h) return false;

  const key = normalizeUiKey(source.replace(/[:：]\s*$/, ""));
  if (!key) return false;

  if (!store.hosts[h]) store.hosts[h] = {};
  if (!store.hosts[h][targetLang]) store.hosts[h][targetLang] = {};
  const bucket = store.hosts[h][targetLang];

  const existing = bucket[key];
  if (existing) {
    existing.translation = translation.trim();
    existing.lastUsedAt = now;
    existing.hits += 1;
  } else {
    bucket[key] = {
      translation: translation.trim(),
      lastUsedAt: now,
      hits: 1,
    };
  }

  trimHostLangBucket(bucket, SITE_LEXICON_MAX_PER_HOST_LANG);
  return true;
}

function trimHostLangBucket(
  bucket: Record<string, SiteLexiconEntry>,
  max: number
): void {
  const keys = Object.keys(bucket);
  if (keys.length <= max) return;
  keys
    .sort((a, b) => bucket[a].lastUsedAt - bucket[b].lastUsedAt)
    .slice(0, keys.length - max)
    .forEach((k) => {
      delete bucket[k];
    });
}

/** Touch usage stats when a learned entry is applied. Returns true on hit —
 * keeping lastUsedAt fresh is what makes bucket eviction truly LRU. */
export function touchLearnedPair(
  store: SiteLexiconStore,
  host: string,
  targetLang: string,
  source: string,
  now = Date.now()
): boolean {
  const h = siteLexiconHost(host);
  if (!h) return false;
  const bucket = store.hosts[h]?.[targetLang];
  if (!bucket) return false;
  for (const key of siteLexiconKeys(source)) {
    const entry = bucket[key];
    if (entry) {
      entry.lastUsedAt = now;
      entry.hits += 1;
      return true;
    }
  }
  return false;
}

/** Flat map for content-script session use. */
export function flattenHostLang(
  store: SiteLexiconStore,
  host: string,
  targetLang: string
): Record<string, string> {
  const h = siteLexiconHost(host);
  const bucket = store.hosts[h]?.[targetLang];
  if (!bucket) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(bucket)) {
    out[k] = v.translation;
  }
  return out;
}

/** Total phrases across every host and language. */
export function countStorePhrases(store: SiteLexiconStore): number {
  let n = 0;
  for (const langs of Object.values(store.hosts)) {
    for (const bucket of Object.values(langs)) {
      n += Object.keys(bucket).length;
    }
  }
  return n;
}

/**
 * Evict least-recently-USED hosts (wholesale) until the store holds at most
 * `max` phrases. A host's recency is its most recent entry — evicting whole
 * cold hosts keeps hot sites intact instead of churning entries everywhere.
 * Returns the number of phrases evicted.
 */
export function trimStoreTotal(
  store: SiteLexiconStore,
  max = SITE_LEXICON_MAX_TOTAL
): number {
  let total = countStorePhrases(store);
  if (total <= max) return 0;

  const hostRecency: Array<{ host: string; latest: number; count: number }> = [];
  for (const [host, langs] of Object.entries(store.hosts)) {
    let latest = 0;
    let count = 0;
    for (const bucket of Object.values(langs)) {
      for (const entry of Object.values(bucket)) {
        if (entry.lastUsedAt > latest) latest = entry.lastUsedAt;
        count += 1;
      }
    }
    hostRecency.push({ host, latest, count });
  }
  hostRecency.sort((a, b) => a.latest - b.latest);

  let evicted = 0;
  for (const h of hostRecency) {
    if (total <= max) break;
    delete store.hosts[h.host];
    total -= h.count;
    evicted += h.count;
  }
  return evicted;
}
