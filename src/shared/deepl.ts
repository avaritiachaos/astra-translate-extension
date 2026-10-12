// ============================================================
// Astra Translate – DeepL shared helpers (pure, unit-testable)
// ============================================================
// Language-name → DeepL target_lang mapping, endpoint resolution by key
// suffix, page-segment split/join, and request chunking. No fetch here —
// the background client (background/deeplClient.ts) owns the network side.

/** DeepL API v2 official hosts. Free keys (:fx) use api-free, Pro keys use api. */
const DEEPL_FREE_HOST = "https://api-free.deepl.com/v2";
const DEEPL_PRO_HOST = "https://api.deepl.com/v2";

/**
 * Resolve the DeepL base URL for a key.
 *
 * DeepL free-tier keys end with ":fx" and only work against api-free.deepl.com;
 * Pro keys only work against api.deepl.com. The preset ships the free host, so
 * a Pro key entered by the user must be re-pointed automatically. A Base URL
 * that is neither official host is treated as a user proxy and kept as-is.
 */
export function resolveDeeplBase(apiKey: string, baseUrl: string): string {
  const base = (baseUrl || "").trim().replace(/\/+$/, "");
  const isOfficial = base === DEEPL_FREE_HOST || base === DEEPL_PRO_HOST;
  // A custom proxy Base URL wins over key-suffix rewriting; an official host
  // (or blank) is chosen by the key suffix.
  if (base && !isOfficial) return base;
  const isFreeKey = (apiKey || "").trim().toLowerCase().endsWith(":fx");
  return isFreeKey ? DEEPL_FREE_HOST : DEEPL_PRO_HOST;
}

/**
 * Map an Astra target-language name to a DeepL `target_lang` code.
 * Returns null when DeepL cannot serve that target (the caller surfaces a
 * localized error instead of silently producing the wrong script/output).
 *
 * Codes follow the DeepL API v2 language table. Regional targets use the
 * recommended explicit variants (EN, PT-BR). ZH is DeepL's Simplified Chinese
 * target; ZH-HANT is attempted for Traditional Chinese and surfaces a clear
 * error if the account/plan rejects it.
 */
const DEEPL_TARGET_CODES: Record<string, string> = {
  "Simplified Chinese": "ZH",
  "Traditional Chinese": "ZH-HANT",
  "English": "EN",
  "Japanese": "JA",
  "Korean": "KO",
  "French": "FR",
  "German": "DE",
  "Spanish": "ES",
  "Portuguese": "PT-BR",
  "Russian": "RU",
  "Arabic": "AR",
  "Italian": "IT",
  "Dutch": "NL",
  "Polish": "PL",
  "Turkish": "TR",
  "Vietnamese": "VI",
  "Thai": "TH",
  "Indonesian": "ID",
  "Malay": "MS",
  "Hindi": "HI",
};

export function deeplTargetCode(targetLang: string): string | null {
  const code = DEEPL_TARGET_CODES[(targetLang || "").trim()];
  return code || null;
}

/** Source-language names that may be attached as an optional `source_lang`. */
export function deeplSourceCode(langName?: string): string | undefined {
  const name = (langName || "").trim();
  if (!name || /^auto$/i.test(name)) return undefined;
  // Regional targets double as sources with the region stripped.
  const mapped = DEEPL_TARGET_CODES[name];
  if (!mapped) return undefined;
  return mapped.split("-")[0];
}

/**
 * Split one page item into its U+E000-joined fragments. DeepL translates each
 * fragment as its own text entry, which is strictly more reliable than asking
 * an LLM to preserve separator counts.
 */
export function splitDeeplSegments(text: string, separator: string): string[] {
  return text.split(separator);
}

/** Rebuild an item's translation from its fragment translations. */
export function joinDeeplSegments(parts: string[], separator: string): string {
  return parts.join(separator);
}

export interface DeeplChunk {
  /** Indices into the original flat array covered by this chunk. */
  indices: number[];
  texts: string[];
}

/**
 * Split a flat text array into request chunks under both DeepL limits:
 * a conservative 50 entries per call and a serialized-body byte budget
 * (DeepL rejects requests over 128 KiB; stay well below after JSON overhead).
 */
export function chunkDeeplTexts(
  texts: string[],
  maxTexts = 50,
  maxBytes = 96 * 1024,
): DeeplChunk[] {
  const encoder = new TextEncoder();
  const chunks: DeeplChunk[] = [];
  let current: DeeplChunk = { indices: [], texts: [] };
  let bytes = 0;
  const push = () => {
    if (current.indices.length > 0) chunks.push(current);
    current = { indices: [], texts: [] };
    bytes = 0;
  };
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i] ?? "";
    const size = encoder.encode(text).byteLength;
    // A single entry larger than the budget still ships alone — the API's
    // 413 is the honest failure for one oversized fragment.
    if (current.indices.length > 0 && (current.indices.length >= maxTexts || bytes + size > maxBytes)) {
      push();
    }
    current.indices.push(i);
    current.texts.push(text);
    bytes += size;
  }
  push();
  return chunks;
}
