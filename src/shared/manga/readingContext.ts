import { readingPageUrl } from "./readingPolicy.ts";
interface ReadingSender {
  frameId?: number;
  url?: string;
  tab?: { id?: number; url?: string };
}
interface ReadingTab {
  id?: number;
  url?: string;
}

/** Chrome's sender.url may retain the document's initial URL after pushState. */
export function resolveReadingPage(
  sender: ReadingSender,
  currentTab: ReadingTab,
): string | null {
  if (
    sender.frameId !== 0 ||
    !Number.isInteger(sender.tab?.id) ||
    sender.tab!.id !== currentTab.id
  )
    return null;
  const documentUrl = readingPageUrl(sender.url || "");
  const reportedPage = readingPageUrl(sender.tab?.url || sender.url || "");
  const currentPage = readingPageUrl(currentTab.url || "");
  if (
    !documentUrl ||
    !reportedPage ||
    !currentPage ||
    reportedPage !== currentPage
  )
    return null;
  // Only the browser-provided top-frame tab snapshot can override a stale
  // document path. Never accept a page URL from an extension message payload.
  if (new URL(documentUrl).origin !== new URL(currentPage).origin) return null;
  return currentPage;
}
