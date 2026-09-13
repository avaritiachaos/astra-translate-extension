export interface MangaReadingState {
  enabled: boolean;
  prefetch: boolean;
  scope?: string;
  expires?: number;
  aheadCount?: number;
  readyCount?: number;
  workingCount?: number;
}
export interface MangaReadingUi extends MangaReadingState {
  busy?: boolean;
  hint?: string;
  failure?: string;
  recovery?: "retry" | "settings";
  prefetchedCount?: number;
  prefetchTarget?: number;
}
export const READING_SESSION_MS = 30 * 60_000;
export function readingPageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password)
      return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
/** Stay within a numbered chapter or the exact SPA reader URL. */
export function mangaReadingScope(value: string): string | null {
  const page = readingPageUrl(value);
  if (!page) return null;
  const url = new URL(page);
  for (const key of ["page", "p", "pg"]) {
    if (/^\d{1,6}$/.test(url.searchParams.get(key) ?? "")) {
      url.searchParams.set(key, "*");
      return url.href;
    }
  }
  const pieces = url.pathname.split("/").filter(Boolean);
  if (pieces.length >= 3 && /^\d{1,6}$/.test(pieces[pieces.length - 1]!)) {
    pieces[pieces.length - 1] = "*";
    url.pathname =
      "/" + pieces.join("/") + (url.pathname.endsWith("/") ? "/" : "");
  }
  return url.href;
}
function pageNumber(url: URL): number | null {
  for (const key of ["page", "p", "pg"]) {
    const value = url.searchParams.get(key);
    if (value && /^\d{1,6}$/.test(value)) return Number(value);
  }
  const pieces = url.pathname.split("/").filter(Boolean);
  return pieces.length >= 3 && /^\d{1,6}$/.test(pieces[pieces.length - 1]!)
    ? Number(pieces[pieces.length - 1])
    : null;
}
export function isNextMangaPage(current: string, next: string): boolean {
  const from = readingPageUrl(current),
    to = readingPageUrl(next);
  if (!from || !to || mangaReadingScope(from) !== mangaReadingScope(to))
    return false;
  const a = pageNumber(new URL(from)),
    b = pageNumber(new URL(to));
  return a !== null && b === a + 1;
}
/** Evidence from existing image URLs, never a synthesized request URL. */
export function isNextNumberedImage(current: string, next: string): boolean {
  try {
    const a = new URL(current),
      b = new URL(next);
    if (!/^https?:$/.test(a.protocol) || a.origin !== b.origin) return false;
    const x = a.pathname.match(/^(.*?)(\d{1,6})(\.[a-z0-9]+)$/i);
    const y = b.pathname.match(/^(.*?)(\d{1,6})(\.[a-z0-9]+)$/i);
    return (
      !!x &&
      !!y &&
      x[1] === y[1] &&
      x[3] === y[3] &&
      Number(y[2]) === Number(x[2]) + 1
    );
  } catch {
    return false;
  }
}
export function readingSessionAllows(
  state: MangaReadingState,
  url: string,
  now = Date.now(),
): boolean {
  return (
    state.enabled &&
    !!state.scope &&
    state.scope === mangaReadingScope(url) &&
    (state.expires ?? 0) > now
  );
}

/** One attempt per stable visible source, with no error/retry loop while idle. */
export class MangaReadingGate {
  private signature = "";
  private since = 0;
  private attempts = new Set<string>();
  observe(signature: string, now: number, settledMs = 600): boolean {
    if (signature !== this.signature) {
      this.signature = signature;
      this.since = now;
      return false;
    }
    return (
      Boolean(signature) &&
      now - this.since >= settledMs &&
      !this.attempts.has(signature)
    );
  }
  mark(signature: string) {
    this.attempts.add(signature);
    while (this.attempts.size > 120)
      this.attempts.delete(this.attempts.values().next().value!);
  }
  reset() {
    this.signature = "";
    this.since = 0;
    this.attempts.clear();
  }
}
