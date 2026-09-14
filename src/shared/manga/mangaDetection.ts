export const MANGA_HOST_KEYWORDS = [
  "manga",
  "comic",
  "manhua",
  "manhwa",
  "webtoon",
  "nhentai",
  "e-hentai",
  "exhentai",
  "hitomi",
  "copymanga",
  "kuaikan",
  "dm5",
  "18comic",
  "rawdevart",
  "asurascans",
  "flamecomics",
  "reaperscans",
  "dynasty-scans",
  "piccoma",
  "cmoa",
  "mechacomic",
  "renta",
  "bookwalker",
  "alphapolis",
  "shonenjump",
  "tonarinoyj",
  "sunday-webry",
  "magapoke",
  "mangafox",
  "mangahere",
  "mangapark",
  "bilibilicomics",
  "manhuagui",
  "mangadex",
  "comic-walker",
];

export function isLocalOrPrivateHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/** Positive-match verification for manga reader URLs. */
export function isMangaReaderUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (!/^https?:$/.test(parsed.protocol)) return false;

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    // 1. Immediately reject localhost and private IP addresses
    if (isLocalOrPrivateHost(host)) {
      return false;
    }

    // 2. Whitelist match: Hostname contains known manga/comic keywords
    if (MANGA_HOST_KEYWORDS.some((kw) => host.includes(kw))) {
      return true;
    }

    // 3. Positive path patterns: explicitly reading a chapter, episode, or comic viewer
    if (
      /\/chapter[s]?[-_/]?\d+/i.test(path) ||
      /\/(ch|ep|episode)[-_/]?\d+/i.test(path) ||
      /\/(read|reader|viewer)\b/i.test(path) ||
      /\/(manga|comic|comics|manhua|manhwa|webtoon|doujin|hentai)\//i.test(
        path,
      ) ||
      /\/g\/\d+/i.test(path)
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
