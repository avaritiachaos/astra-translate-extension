// ============================================================
// Astra Translate – Pure web-search result parsers
// ============================================================
// No extension imports: these helpers are directly unit-testable under Node.

export type BuiltInSearchEngine = "duckduckgo" | "google" | "bing";

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
  // Exactly one decoding pass: `&amp;` last, so "&amp;lt;" → "&lt;" (text),
  // never "<".
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
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

/** Parse Google result HTML (primary engine; markup shifts often, so
 * best-effort — an unrecognised page simply yields zero results). */
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

/** Resolve Bing's /ck/a click-tracking redirect ("u=a1<base64url>") to the
 * real target; pass any direct URL through unchanged. */
function bingResultUrl(href: string): string {
  const decoded = decodeEntities(href);
  try {
    const url = new URL(decoded, "https://www.bing.com");
    if (url.hostname.endsWith("bing.com") && url.pathname === "/ck/a") {
      const u = url.searchParams.get("u") ?? "";
      if (u.startsWith("a1")) {
        const b64 = u.slice(2).replace(/-/g, "+").replace(/_/g, "/");
        return decodeURIComponent(
          Array.from(atob(b64), (c) =>
            "%" + c.charCodeAt(0).toString(16).padStart(2, "0")
          ).join("")
        );
      }
      return "";
    }
    return decoded;
  } catch {
    return "";
  }
}

/** Parse Bing result HTML: <li class="b_algo"> blocks with an <h2><a> title
 * and a nearby <p> snippet. Bing is the mainland-reachable middle engine. */
export function parseBingHtml(html: string): ParsedSearchSource[] {
  const raw: Omit<ParsedSearchSource, "isExternal">[] = [];
  const resultAnchor = /<li\b[^>]*class=["'][^"']*b_algo[^"']*["'][^>]*>[\s\S]{0,600}?<h2[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = resultAnchor.exec(html))) {
    const nearby = html.slice(resultAnchor.lastIndex, resultAnchor.lastIndex + 2000);
    const snippet = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(nearby)?.[1] ?? "";
    raw.push({
      title: match[2],
      url: bingResultUrl(match[1]),
      snippet,
      source: "bing",
    });
  }
  return sanitizeSources(raw);
}
