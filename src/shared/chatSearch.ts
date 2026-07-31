// ============================================================
// Astra Translate – Pure chat web-search helpers
// ============================================================

/**
 * Build a concise search query from a user question and optional page title.
 * The complete question wins; a title is added only when it is meaningfully
 * useful and fits within the external search backend's 400-char limit.
 */
export function buildChatSearchQuery(text: string, pageTitle?: string): string {
  const base = text.trim().slice(0, 400);
  const title = pageTitle?.trim().slice(0, 80) ?? "";
  const titleBudget = 400 - base.length - 1;
  if (titleBudget < 10 || !title || base.includes(title)) return base;
  return `${base} ${title.slice(0, titleBudget)}`;
}
