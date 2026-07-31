// ============================================================
// Astra Translate – Pure web-search result parsers
// ============================================================
// No extension imports: these helpers are directly unit-testable under Node.

export type BuiltInSearchEngine = "duckduckgo" | "google";

export interface ParsedSearchSource {
  title: string;
  url: string;
  snippet: string;
  source: BuiltInSearchEngine;
  isExternal: true;
}

const MAX_RESULTS = 5;
const MAX_TITLE = 120;
const MAX_URL = 400;
const MAX_SNIPPET = 280;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function cleanText(raw: string, max: number): string {
  return decodeEntities(raw.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanUrl(raw: string): string {
  const value = decodeEntities(raw).trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString().slice(0, MAX_URL)
      : "";
  } catch {
    return "";
  }
}

function sanitizeSources(raw: Omit<ParsedSearchSource, "isExternal">[]): ParsedSearchSource[] {
  const out: ParsedSearchSource[] = [];
  const seen = new Set<string>();
  for (const result of raw) {
    const url = cleanUrl(result.url);
    const title = cleanText(result.title, MAX_TITLE) || url;
    const snippet = cleanText(result.snippet, MAX_SNIPPET);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    out.push({ title, url, snippet, source: result.source, isExternal: true });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

function duckDuckGoResultUrl(href: string): string {
  const decoded = decodeEntities(href);
  try {
    const url = new URL(decoded, "https://html.duckduckgo.com");
    return url.searchParams.get("uddg") || decoded;
  } catch {
    return decoded;
  }
}

function googleResultUrl(href: string): string {
  const decoded = decodeEntities(href);
  try {
    const url = new URL(decoded, "https://www.google.com");
    return url.pathname === "/url" ? url.searchParams.get("q") || "" : decoded;
  } catch {
    return "";
  }
}

function firstClassContent(html: string, classPattern: string): string {
  const match = new RegExp(
    `<(a|div|span)\\b[^>]*class=["'][^"']*${classPattern}[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    "i"
  ).exec(html);
  return match?.[2] ?? "";
}

/** Parse DuckDuckGo's lightweight HTML result page. */
export function parseDuckDuckGoHtml(html: string): ParsedSearchSource[] {
  const raw: Omit<ParsedSearchSource, "isExternal">[] = [];
  const anchor = /<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html))) {
    const nearby = html.slice(anchor.lastIndex, anchor.lastIndex + 2200);
    raw.push({
      title: match[2],
      url: duckDuckGoResultUrl(match[1]),
      snippet: firstClassContent(nearby, "result__snippet"),
      source: "duckduckgo",
    });
  }
  return sanitizeSources(raw);
}

/** Best-effort parser for Google result HTML (fallback only). */
export function parseGoogleHtml(html: string): ParsedSearchSource[] {
  const raw: Omit<ParsedSearchSource, "isExternal">[] = [];
  const resultAnchor = /<a\b[^>]*href=["'](\/url\?q=[^"']+)["'][^>]*>[\s\S]{0,700}?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  let match: RegExpExecArray | null;
  while ((match = resultAnchor.exec(html))) {
    const nearby = html.slice(resultAnchor.lastIndex, resultAnchor.lastIndex + 1600);
    raw.push({
      title: match[2],
      url: googleResultUrl(match[1]),
      snippet: firstClassContent(nearby, "VwiC3b") || firstClassContent(nearby, "IsZvec"),
      source: "google",
    });
  }
  return sanitizeSources(raw);
}
