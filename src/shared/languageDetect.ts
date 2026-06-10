// ============================================================
// Astra Translate – Lightweight Language Detection
// ============================================================
// Pure character-statistics approach. No external dependencies.
// Used only for smart target language resolution in selection
// and manual translation. NOT used for page translation.

import type { AstraSettings } from "./types";

// ---- Text normalization ----

/** Trim and collapse internal whitespace. */
export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

// ---- Untranslatable content detection ----

/** Matches http://, https://, ftp://, or www. prefixed strings. */
export function isProbablyUrl(text: string): boolean {
  return /^\s*(https?:\/\/|ftp:\/\/|www\.)/i.test(text);
}

/** Contains @ with a dot in the domain part. */
export function isProbablyEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
}

/** Contains code-like patterns: braces, semicolons, arrows, keywords. */
export function isProbablyCodeLike(text: string): boolean {
  const t = text.trim();
  // Contains multiple code syntax markers
  if (/[{}();]/.test(t) && (t.includes("=>") || t.includes("function ") || t.includes("const ") || t.includes("import ") || t.includes("return "))) {
    return true;
  }
  // Looks like a shell command
  if (/^(npm|yarn|pip|git|docker|curl|wget|sudo|apt|brew|cd|ls|cat|grep|chmod|mkdir)\s/.test(t)) {
    return true;
  }
  // Looks like a code snippet with assignment or comparison
  if (/^(let |var |const |if |else |for |while |switch |class |def |import |export |from )/.test(t)) {
    return true;
  }
  return false;
}

/**
 * Single identifier-like token: alphanumeric, underscores, hyphens, dots.
 * No spaces, length < 32, not a common English word.
 * Examples: avaritia, foo_bar, GPT-5, deepseek-v4-flash, astra-translate-extension
 */
export function isProbablyIdentifier(text: string): boolean {
  const t = text.trim();
  // Must be a single token (no spaces)
  if (/\s/.test(t)) return false;
  // Must be composed of allowed chars
  if (!/^[a-zA-Z0-9_.\-]+$/.test(t)) return false;
  // Must be reasonably short
  if (t.length >= 32) return false;
  // Must not be a common English word (single short word that's clearly natural language)
  if (/^[a-z]{2,8}$/i.test(t) && COMMON_WORDS.has(t.toLowerCase())) {
    return false;
  }
  return true;
}

// Common English words that should NOT be treated as identifiers
const COMMON_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "must", "need",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their", "mine", "yours", "hers", "ours", "theirs",
  "this", "that", "these", "those", "here", "there", "where", "when", "how", "what",
  "which", "who", "whom", "whose", "why",
  "and", "or", "but", "not", "no", "yes", "if", "then", "else", "so",
  "in", "on", "at", "to", "for", "of", "with", "by", "from", "as", "into",
  "about", "between", "through", "after", "before", "above", "below",
  "up", "down", "out", "off", "over", "under", "again", "further",
  "new", "old", "big", "small", "long", "short", "good", "bad", "great",
  "open", "close", "save", "delete", "edit", "copy", "paste", "cut",
  "file", "text", "data", "name", "type", "time", "work", "help", "make",
  "get", "set", "run", "use", "try", "ask", "say", "tell", "give", "take",
  "see", "look", "find", "think", "know", "want", "need", "feel", "keep",
  "let", "put", "add", "move", "turn", "point", "form", "show", "play",
]);

// ---- Character counting ----

/** Count CJK unified ideographs (Chinese characters). */
export function countChinese(text: string): number {
  let count = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // CJK Unified Ideographs: U+4E00–U+9FFF
    // CJK Unified Ideographs Extension A: U+3400–U+4DBF
    // CJK Compatibility Ideographs: U+F900–U+FAFF
    if ((code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0xF900 && code <= 0xFAFF)) {
      count++;
    }
  }
  return count;
}

/** Count Japanese hiragana and katakana. */
export function countJapaneseKana(text: string): number {
  let count = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // Hiragana: U+3040–U+309F
    // Katakana: U+30A0–U+30FF
    // Katakana Phonetic Extensions: U+31F0–U+31FF
    if ((code >= 0x3040 && code <= 0x309F) ||
        (code >= 0x30A0 && code <= 0x30FF) ||
        (code >= 0x31F0 && code <= 0x31FF)) {
      count++;
    }
  }
  return count;
}

/** Count Korean hangul syllables and jamo. */
export function countKorean(text: string): number {
  let count = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // Hangul Syllables: U+AC00–U+D7AF
    // Hangul Jamo: U+1100–U+11FF
    // Hangul Jamo Extended-A: U+A960–U+A97F
    // Hangul Jamo Extended-B: U+D7B0–U+D7FF
    if ((code >= 0xAC00 && code <= 0xD7AF) ||
        (code >= 0x1100 && code <= 0x11FF) ||
        (code >= 0xA960 && code <= 0xA97F) ||
        (code >= 0xD7B0 && code <= 0xD7FF)) {
      count++;
    }
  }
  return count;
}

/** Count all CJK characters (Chinese + Japanese kana + Korean hangul). */
export function countCjk(text: string): number {
  return countChinese(text) + countJapaneseKana(text) + countKorean(text);
}

/** Count Latin/alphabetic words (tokens containing at least one [a-zA-Z]). */
export function countLatinWords(text: string): number {
  const tokens = text.split(/\s+/);
  let count = 0;
  for (const token of tokens) {
    if (/[a-zA-Z]/.test(token)) count++;
  }
  return count;
}

/** Count individual Latin letters (a-z, A-Z). */
function countLatinLetters(text: string): number {
  let count = 0;
  for (const ch of text) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) count++;
  }
  return count;
}

/** Count non-whitespace characters. */
function countNonWhitespace(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (!/\s/.test(ch)) count++;
  }
  return count;
}

// ---- Script detection ----

export type DominantScript = "zh" | "ja" | "ko" | "latin" | "cyrillic" | "mixed" | "unknown";

/** Count Cyrillic characters. */
function countCyrillic(text: string): number {
  let count = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // Cyrillic: U+0400–U+04FF
    // Cyrillic Supplement: U+0500–U+052F
    if ((code >= 0x0400 && code <= 0x04FF) ||
        (code >= 0x0500 && code <= 0x052F)) {
      count++;
    }
  }
  return count;
}

/**
 * Detect the dominant script of a text string.
 * Simple character-statistics approach.
 */
export function detectDominantScript(text: string): DominantScript {
  const chinese = countChinese(text);
  const kana = countJapaneseKana(text);
  const korean = countKorean(text);
  const cyrillic = countCyrillic(text);
  const latin = countLatinWords(text);

  const totalCjk = chinese + kana + korean;
  const total = totalCjk + cyrillic + latin;

  if (total === 0) return "unknown";

  // Has Japanese kana → Japanese
  if (kana > 0) return "ja";

  // Has Korean hangul → Korean
  if (korean > 0) return "ko";

  // Has Chinese characters, no kana → Chinese
  if (chinese > 0 && chinese >= latin) return "zh";

  // Predominantly Cyrillic
  if (cyrillic > 0 && cyrillic >= latin && cyrillic >= totalCjk) return "cyrillic";

  // Predominantly Latin
  if (latin > 0 && latin >= totalCjk && latin >= cyrillic) return "latin";

  // Mixed
  if (totalCjk > 0 && (latin > 0 || cyrillic > 0)) return "mixed";

  return "unknown";
}

// ---- Translation mode resolution ----

export type TranslationMode = "translate" | "dictionary";

/**
 * Determine whether a piece of text should use dictionary mode or plain translation.
 *
 * @param text - The selected text
 * @param settings - Full AstraSettings
 * @returns "dictionary" for short words/phrases, "translate" for everything else
 */
export function resolveTranslationMode(
  text: string,
  settings: Pick<AstraSettings, "dictionaryModeEnabled" | "smartTargetMaxChars" | "smartTargetMaxWords" | "smartTargetMaxCjkChars">
): TranslationMode {
  if (!settings.dictionaryModeEnabled) return "translate";

  const trimmed = text.trim();

  // Untranslatable content → translate mode (the prompt will keep it unchanged)
  if (isProbablyUrl(trimmed) ||
      isProbablyEmail(trimmed) ||
      isProbablyCodeLike(trimmed) ||
      isProbablyIdentifier(trimmed)) {
    return "translate";
  }

  // Long text → translate mode
  if (!isShortSmartTargetCandidate(trimmed, settings)) {
    return "translate";
  }

  const dominant = detectDominantScript(trimmed);

  // CJK short text → translate mode (dictionary mode is mainly for Latin words/phrases)
  if (dominant === "zh" || dominant === "ja" || dominant === "ko") {
    return "translate";
  }

  // Cyrillic short text → translate mode
  if (dominant === "cyrillic") {
    return "translate";
  }

  // Latin short text (1-4 words) → dictionary mode
  const wordCount = countLatinWords(trimmed);
  if (wordCount >= 1 && wordCount <= 4) {
    return "dictionary";
  }

  return "translate";
}

// ---- Smart target language resolution ----

/** Check if text is short enough to be a smart target language candidate. */
export function isShortSmartTargetCandidate(
  text: string,
  settings: Pick<AstraSettings, "smartTargetMaxChars" | "smartTargetMaxWords" | "smartTargetMaxCjkChars">
): boolean {
  const t = text.trim();

  // Too many total characters
  if (t.length > settings.smartTargetMaxChars) return false;

  // Too many Latin words
  if (countLatinWords(t) > settings.smartTargetMaxWords) return false;

  // Too many CJK characters
  if (countCjk(t) > settings.smartTargetMaxCjkChars) return false;

  return true;
}

/**
 * Map a dominant script to the corresponding language name
 * that the user might have as their defaultTargetLang.
 */
function scriptToLanguage(script: DominantScript, defaultTargetLang: string): string | null {
  switch (script) {
    case "zh":
      // Distinguish Simplified vs Traditional by checking the default target
      if (defaultTargetLang.includes("Traditional")) return "Traditional Chinese";
      return "Simplified Chinese";
    case "ja":
      return "Japanese";
    case "ko":
      return "Korean";
    case "latin":
      return "English";
    case "cyrillic":
      return "Russian";
    default:
      return null;
  }
}

/**
 * Calculate the purity ratio of the dominant language in the text.
 * Returns a value between 0 and 1.
 */
function calculateLanguagePurity(text: string, dominant: DominantScript): number {
  const total = countNonWhitespace(text);
  if (total === 0) return 0;

  switch (dominant) {
    case "zh":
      return countChinese(text) / total;
    case "latin":
      return countLatinLetters(text) / total;
    case "ja":
      return (countJapaneseKana(text) + countChinese(text)) / total;
    case "ko":
      return countKorean(text) / total;
    case "cyrillic":
      return countCyrillic(text) / total;
    default:
      return 0;
  }
}

/**
 * Check if the detected dominant script corresponds to the given target language.
 */
function isLanguageCloseToTargetLang(dominant: DominantScript, targetLang: string): boolean {
  const tl = targetLang.toLowerCase();
  if (tl.includes("chinese")) return dominant === "zh";
  if (tl.includes("english")) return dominant === "latin";
  if (tl.includes("japanese")) return dominant === "ja";
  if (tl.includes("korean")) return dominant === "ko";
  if (tl.includes("russian")) return dominant === "cyrillic";
  return false;
}

/**
 * Resolve the target language for a given text.
 *
 * @param text - The source text to translate
 * @param settings - Full AstraSettings
 * @param mode - "selection" (划词), "manual" (popup), or "page" (整页)
 * @returns The resolved target language name
 */
export function resolveTargetLanguageForText(
  text: string,
  settings: AstraSettings,
  mode: "selection" | "manual" | "page"
): string {
  // Page translation always uses the default target language
  if (mode === "page") {
    return settings.defaultTargetLang;
  }

  // Smart target disabled → use default
  if (!settings.smartTargetEnabled) {
    return settings.defaultTargetLang;
  }

  const trimmed = text.trim();

  // Untranslatable content → use default (prompt will preserve it)
  if (isProbablyUrl(trimmed) ||
      isProbablyEmail(trimmed) ||
      isProbablyCodeLike(trimmed) ||
      isProbablyIdentifier(trimmed)) {
    return settings.defaultTargetLang;
  }

  // Same-language purity check: if text is predominantly in the default target
  // language, switch to secondary target regardless of text length.
  if (settings.sameLanguageToSecondaryEnabled) {
    const dominant = detectDominantScript(trimmed);
    if (dominant !== "mixed" && dominant !== "unknown") {
      if (isLanguageCloseToTargetLang(dominant, settings.defaultTargetLang)) {
        const purity = calculateLanguagePurity(trimmed, dominant);
        if (purity >= settings.sameLanguageMinPurity) {
          return settings.secondaryTargetLang;
        }
      }
    }
  }

  // Short text → check if source is already in the default target language
  if (!isShortSmartTargetCandidate(trimmed, settings)) {
    return settings.defaultTargetLang;
  }

  const dominant = detectDominantScript(trimmed);
  const sourceLang = scriptToLanguage(dominant, settings.defaultTargetLang);

  // If the source text's language matches the default target language,
  // switch to the secondary target language
  if (sourceLang && sourceLang === settings.defaultTargetLang) {
    return settings.secondaryTargetLang;
  }

  // Otherwise, use the default target language
  return settings.defaultTargetLang;
}
