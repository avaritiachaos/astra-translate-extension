import { t, type UiLanguage } from "../shared/i18n.ts";

/** Avoid Chrome grouping duplicate image-picker entries on images/selections. */
export function translationContextMenus(
  language: UiLanguage,
): chrome.contextMenus.CreateProperties[] {
  const documentUrlPatterns = ["http://*/*", "https://*/*"];
  return [
    {
      id: "ast-translate-selection",
      title: t(language, "menu.translateSelection"),
      contexts: ["selection"],
      documentUrlPatterns,
    },
    {
      id: "ast-translate-image",
      title: t(language, "menu.translateImage"),
      contexts: ["image"],
      documentUrlPatterns,
    },
    {
      id: "ast-pick-manga",
      title: t(language, "menu.selectImage"),
      contexts: ["page"],
      documentUrlPatterns,
    },
  ];
}
