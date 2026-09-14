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
];

export const NON_MANGA_HOSTS = [
  // AI & Chatbots
  "deepseek.com",
  "chatgpt.com",
  "openai.com",
  "claude.ai",
  "anthropic.com",
  "poe.com",
  "perplexity.ai",
  "gemini.google.com",
  "copilot.microsoft.com",
  // Search Engines & Portals
  "google.com",
  "bing.com",
  "baidu.com",
  "duckduckgo.com",
  "sogou.com",
  "so.com",
  "yahoo.com",
  // Developer & Knowledge Platforms
  "github.com",
  "gitlab.com",
  "gitee.com",
  "stackoverflow.com",
  "v2ex.com",
  "npmjs.com",
  "wikipedia.org",
  "blender.org",
  // Social, Media & Video
  "youtube.com",
  "bilibili.com",
  "zhihu.com",
  "weibo.com",
  "tieba.baidu.com",
  "douban.com",
  "twitter.com",
  "x.com",
  "reddit.com",
  "facebook.com",
  "instagram.com",
  "threads.net",
  "tiktok.com",
  "douyin.com",
  "xiaohongshu.com",
  "discord.com",
  // Shopping & Services
  "amazon.com",
  "apple.com",
  "microsoft.com",
  "taobao.com",
  "jd.com",
  "tmall.com",
  "aliexpress.com",
  "pinduoduo.com",
  // Productivity & Workspaces
  "notion.so",
  "feishu.cn",
  "larksuite.com",
  "slack.com",
];

export function isMangaReaderUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (!/^https?:$/.test(parsed.protocol)) return false;

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    // Fast check non-manga major domains
    if (
      NON_MANGA_HOSTS.some(
        (blocked) => host === blocked || host.endsWith("." + blocked),
      )
    ) {
      return false;
    }

    // 1. Hostname hints: known manga/comic domains
    if (MANGA_HOST_KEYWORDS.some((kw) => host.includes(kw))) {
      return true;
    }

    // 2. Path patterns: reading a chapter or comic viewer
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
