// ============================================================
// Astra Translate – Per-site learned UI phrases
// ============================================================
// Short labels learned from successful page translations, keyed by
// hostname + target language. Instant on next visit (zero API).
// (No cross-file imports — unit-testable under Node strip-types.)

export const SITE_LEXICON_STORAGE_KEY = "astra_site_lexicon_v1";

/** Same normalization as the global UI lexicon. */
function normalizeUiKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
export const SITE_LEXICON_SCHEMA_VERSION = 1;
/** Max characters for a learnable phrase (matches UI lexicon). */
export const SITE_LEXICON_MAX_CHARS = 48;
/** Cap phrases per host+lang to bound storage. */
export const SITE_LEXICON_MAX_PER_HOST_LANG = 400;

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

/** Hostname for storage (no port). Empty for non-http pages. */
export function siteLexiconHost(hostname?: string): string {
  const h = (hostname || "").trim().toLowerCase();
  if (!h || h === "localhost") return h;
  return h;
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

export function lookupInStore(
  store: SiteLexiconStore,
  host: string,
  targetLang: string,
  source: string
): string | null {
  const h = siteLexiconHost(host);
  if (!h) return null;
  const key = normalizeUiKey(source);
  if (!key) return null;
  const entry = store.hosts[h]?.[targetLang]?.[key];
  if (!entry?.translation) return null;

  // Preserve trailing colon like the global UI lexicon.
  const trimmed = source.trim();
  let out = entry.translation;
  if (/[:：]\s*$/.test(trimmed) && !/[:：]\s*$/.test(out)) {
    out += trimmed.includes("：") ? "：" : ":";
  }
  // Also try without colon key if full key missed — handled by normalize keys below.
  return out;
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

/** Touch hit counter when a learned entry is used. */
export function touchLearnedPair(
  store: SiteLexiconStore,
  host: string,
  targetLang: string,
  source: string,
  now = Date.now()
): void {
  const h = siteLexiconHost(host);
  if (!h) return;
  const bucket = store.hosts[h]?.[targetLang];
  if (!bucket) return;
  for (const key of siteLexiconKeys(source)) {
    const entry = bucket[key];
    if (entry) {
      entry.lastUsedAt = now;
      entry.hits += 1;
      return;
    }
  }
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
