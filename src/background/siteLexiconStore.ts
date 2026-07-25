// ============================================================
// Astra Translate – Site lexicon persistence (chrome.storage)
// ============================================================

import {
  emptySiteLexiconStore,
  flattenHostLang,
  SITE_LEXICON_STORAGE_KEY,
  SITE_LEXICON_SCHEMA_VERSION,
  touchLearnedPair,
  upsertLearnedPair,
  type SiteLexiconStore,
} from "../shared/siteLexicon";

async function loadStore(): Promise<SiteLexiconStore> {
  const result = await chrome.storage.local.get(SITE_LEXICON_STORAGE_KEY);
  const store = result[SITE_LEXICON_STORAGE_KEY] as SiteLexiconStore | undefined;
  if (!store || store.version !== SITE_LEXICON_SCHEMA_VERSION || !store.hosts) {
    return emptySiteLexiconStore();
  }
  return store;
}

async function saveStore(store: SiteLexiconStore): Promise<void> {
  await chrome.storage.local.set({ [SITE_LEXICON_STORAGE_KEY]: store });
}

// All mutations run through one promise chain: the store is a single storage
// key, so two tabs learning at once (or a clear racing a learn flush) would
// otherwise load the same snapshot and the later save would drop the earlier
// writes — or resurrect just-cleared data.
let mutationChain: Promise<unknown> = Promise.resolve();
function serialized<T>(op: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(op, op);
  mutationChain = run.catch(() => {});
  return run;
}

/** Return a flat source→translation map for one host + target language. */
export async function getSiteLexiconMap(
  host: string,
  targetLang: string
): Promise<Record<string, string>> {
  const store = await loadStore();
  return flattenHostLang(store, host, targetLang);
}

/** Learn many short UI pairs from a successful page translation session. */
export async function learnSiteLexiconPairs(
  host: string,
  targetLang: string,
  pairs: Array<{ source: string; translation: string }>
): Promise<{ learned: number }> {
  if (!host || !targetLang || pairs.length === 0) return { learned: 0 };
  return serialized(async () => {
    const store = await loadStore();
    let learned = 0;
    const now = Date.now();
    for (const p of pairs) {
      if (upsertLearnedPair(store, host, targetLang, p.source, p.translation, now)) {
        learned += 1;
      }
    }
    if (learned > 0) await saveStore(store);
    return { learned };
  });
}

/** Bump usage stats when content applies learned entries — keeps bucket
 * eviction LRU by *use* rather than by learn time. */
export async function touchSiteLexiconPairs(
  host: string,
  targetLang: string,
  sources: string[]
): Promise<{ touched: number }> {
  if (!host || !targetLang || !sources.length) return { touched: 0 };
  return serialized(async () => {
    const store = await loadStore();
    const now = Date.now();
    let touched = 0;
    for (const s of sources) {
      if (touchLearnedPair(store, host, targetLang, s, now)) touched += 1;
    }
    if (touched > 0) await saveStore(store);
    return { touched };
  });
}

/**
 * Clear learned phrases. If `host` is set, only that hostname is wiped;
 * otherwise the entire site lexicon is cleared.
 */
export async function clearSiteLexicon(host?: string): Promise<{ cleared: number }> {
  return serialized(async () => {
    const store = await loadStore();
    let cleared = 0;

    const countHost = (h: string): number => {
      const langs = store.hosts[h];
      if (!langs) return 0;
      let n = 0;
      for (const bucket of Object.values(langs)) {
        n += Object.keys(bucket).length;
      }
      return n;
    };

    if (host) {
      const h = host.trim().toLowerCase();
      if (store.hosts[h]) {
        cleared = countHost(h);
        delete store.hosts[h];
        await saveStore(store);
      }
      return { cleared };
    }

    for (const h of Object.keys(store.hosts)) {
      cleared += countHost(h);
    }
    await saveStore(emptySiteLexiconStore());
    return { cleared };
  });
}

/** Aggregate stats for the options UI. */
export async function getSiteLexiconStats(): Promise<{
  hostCount: number;
  phraseCount: number;
  hosts: Array<{ host: string; phrases: number }>;
}> {
  const store = await loadStore();
  const hosts: Array<{ host: string; phrases: number }> = [];
  let phraseCount = 0;

  for (const [host, langs] of Object.entries(store.hosts)) {
    let n = 0;
    for (const bucket of Object.values(langs)) {
      n += Object.keys(bucket).length;
    }
    if (n > 0) {
      hosts.push({ host, phrases: n });
      phraseCount += n;
    }
  }

  hosts.sort((a, b) => b.phrases - a.phrases);
  return { hostCount: hosts.length, phraseCount, hosts };
}
