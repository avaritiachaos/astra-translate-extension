import { t, type UiLanguage } from "../i18n.ts";
import type { MangaMarkerReason } from "./textLayout.ts";

export interface TranslationContent {
  translatedText: string;
  uncertain: boolean;
  folded?: boolean;
}
export interface MangaTranslationResult extends TranslationContent {
  id: string;
  number: number;
  sourceText: string;
  folded: boolean;
  markerReason?: MangaMarkerReason;
}
export function translationState(
  region: TranslationContent,
): "translated" | "uncertain" | "untranslated" {
  if (!region.translatedText.trim()) return "untranslated";
  return region.uncertain ? "uncertain" : "translated";
}
const reasonKeys: Record<MangaMarkerReason, string> = {
  untranslated: "manga.markerUntranslated",
  uncertain: "manga.markerUncertain",
  sfx: "manga.markerSfx",
  oversized: "manga.markerOversized",
  background: "manga.markerBackground",
  clipped: "manga.markerClipped",
  space: "manga.markerSpace",
};
const stateKeys = {
  translated: "manga.textTranslated",
  uncertain: "manga.textUncertain",
  untranslated: "manga.textUntranslated",
};
export function translationPresentation(
  region: TranslationContent,
  reason: MangaMarkerReason | undefined,
  lang: UiLanguage,
) {
  const state = translationState(region);
  const description =
    state === "untranslated"
      ? t(lang, reasonKeys.untranslated)
      : state === "uncertain"
        ? t(lang, reasonKeys.uncertain)
        : reason
          ? t(lang, reasonKeys[reason])
          : "";
  return {
    state,
    label: t(
      lang,
      state === "translated" && reason ? "manga.textFolded" : stateKeys[state],
    ),
    description,
  };
}
export function summarizeTranslations(regions: TranslationContent[]) {
  const summary = { translated: 0, folded: 0, uncertain: 0, untranslated: 0 };
  for (const region of regions) {
    const state = translationState(region);
    summary[state]++;
    if (state === "translated" && region.folded) summary.folded++;
  }
  return summary;
}
