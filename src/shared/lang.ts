// ============================================================
// Astra Translate – Language Helpers
// ============================================================

/**
 * Map common language names to ISO 639-1 codes for API use.
 */
export const LANG_TO_CODE: Record<string, string> = {
  "Simplified Chinese": "zh",
  "Traditional Chinese": "zh-TW",
  English: "en",
  Japanese: "ja",
  Korean: "ko",
  French: "fr",
  German: "de",
  Spanish: "es",
  Portuguese: "pt",
  Russian: "ru",
  Arabic: "ar",
  Italian: "it",
  Dutch: "nl",
  Polish: "pl",
  Turkish: "tr",
  Vietnamese: "vi",
  Thai: "th",
  Indonesian: "id",
  Malay: "ms",
  Hindi: "hi",
};

/**
 * Get ISO code from language name; falls back to the name itself.
 */
export function langCode(name: string): string {
  return LANG_TO_CODE[name] ?? name.toLowerCase();
}
