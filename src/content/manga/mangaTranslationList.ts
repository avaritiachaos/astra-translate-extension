import { t, type UiLanguage } from "../../shared/i18n";
import {
  translationPresentation,
  type MangaTranslationResult,
} from "../../shared/manga/translationPresentation";

/** Render only returned results. Never claim that unrecognized page text is covered. */
export function appendMangaTranslations(
  parent: HTMLElement,
  results: MangaTranslationResult[],
  language: UiLanguage,
) {
  const list = document.createElement("div");
  list.className = "translation-results";
  for (const result of results) {
    const item = document.createElement("article");
    const heading = document.createElement("div");
    const badge = document.createElement("span");
    const reason = document.createElement("p");
    const translation = document.createElement("div");
    const source = document.createElement("p");
    const presentation = translationPresentation(
      result,
      result.markerReason,
      language,
    );
    item.className = "translation-result";
    item.dataset.translationState = presentation.state;
    item.dataset.markerReason = result.markerReason ?? "";
    heading.className = "result-heading";
    badge.className = "result-badge";
    badge.textContent = t(language, "manga.regionStatus", {
      number: result.number,
      state: presentation.label,
    });
    heading.append(badge);
    reason.className = "result-reason";
    reason.textContent = presentation.description;
    reason.hidden = !presentation.description;
    translation.className = "result-translation";
    translation.textContent =
      result.translatedText.trim() ||
      t(language, "manga.noReliableTranslation");
    source.className = "result-source";
    source.textContent =
      t(language, "manga.sourceLabel") +
      " · " +
      (result.sourceText || t(language, "manga.noSourceText"));
    item.append(heading, reason, translation, source);
    list.append(item);
  }
  parent.append(list);
}
