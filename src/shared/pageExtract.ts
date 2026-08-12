// ============================================================
// Astra Translate – Readable page-content extraction
// ============================================================
// Picks the main article out of a page instead of swallowing the whole body.
// A raw body.innerText drags in nav, header, footer, sidebar and cookie
// banners, which dilutes the real content until the model can no longer tell
// what the page is about — the reason chat used to feel page-blind.
//
// !! HARD CONSTRAINT !!
// `extractPageContext` is handed to chrome.scripting.executeScript({ func })
// by the popup, which serializes the function source and runs it inside the
// page. Closures do NOT travel. Every constant, set, and helper it needs must
// live INSIDE the function body. Do not hoist anything out of it, and do not
// import anything into it — a module-scope reference compiles fine and then
// throws ReferenceError only at runtime, in the page.
//
// The landmark tags and ARIA roles inlined below mirror SKIP_CHROME_TAGS /
// SKIP_ROLES in content/textWalker.ts; keep them in sync by hand.

/** Structural mirror of ChatAttachment (shared/types.ts). */
export interface ExtractedPageContext {
  title: string;
  url: string;
  /** True when the text is the user's selection rather than extracted content. */
  selected: boolean;
  text: string;
}

/** Char cap on extracted page text — bounds the chat context budget. */
export const PAGE_EXTRACT_MAX_CHARS = 4000;

/**
 * Extract the user's selection, or failing that the page's main readable
 * content. Pass `{ includeSelection: false }` when the caller already has a
 * selection and needs the page as supplementary background instead. Runs both
 * in the content script and, serialized, inside the page via executeScript —
 * see the constraint note above.
 */
export function extractPageContext(
  options: { includeSelection?: boolean } = {}
): ExtractedPageContext {
  const MAX = 4000;

  const title = document.title || "";
  const url = location.href;

  const selection = window.getSelection()?.toString().trim() || "";
  if (options.includeSelection !== false && selection) {
    return { title, url, selected: true, text: selection.slice(0, MAX) };
  }

  // ---- everything below must stay inside this function ----

  const CHROME_TAGS = new Set([
    "NAV",
    "HEADER",
    "FOOTER",
    "ASIDE",
    "FORM",
    "DIALOG",
  ]);
  const CHROME_ROLES = new Set([
    "navigation",
    "banner",
    "contentinfo",
    "search",
    "complementary",
    "dialog",
    "alertdialog",
  ]);
  const TECHNICAL_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "SVG",
    "CANVAS",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "VIDEO",
    "AUDIO",
    "TEXTAREA",
    "SELECT",
    "OPTION",
  ]);

  /** Our own injected UI must never be fed back to the model. */
  const isOwnUi = (el: Element): boolean => {
    const cls = el.className ? String(el.className) : "";
    return cls.includes("ast-") || (el.id ? el.id.startsWith("ast-") : false);
  };

  const isHidden = (el: Element): boolean => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.hidden) return true;
    const style = getComputedStyle(el);
    return (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    );
  };

  /** Is this element itself (not its ancestors) page furniture? */
  const isChrome = (el: Element): boolean => {
    if (CHROME_TAGS.has(el.tagName.toUpperCase())) return true;
    const role = el.getAttribute("role");
    return !!role && CHROME_ROLES.has(role);
  };

  /** Chrome / hidden / our UI anywhere up the chain disqualifies a candidate. */
  const inSkippedRegion = (el: Element): boolean => {
    let node: Element | null = el;
    while (node && node !== document.body) {
      if (isOwnUi(node) || isChrome(node) || isHidden(node)) return true;
      node = node.parentElement;
    }
    return false;
  };

  /**
   * Readable text of an element with furniture and technical subtrees pruned.
   * innerText is used per surviving block so CSS-driven line breaking and
   * `display:none` are respected the way the user actually sees the page.
   */
  const readableTextOf = (root: HTMLElement): string => {
    const parts: string[] = [];
    const walk = (el: Element): void => {
      if (TECHNICAL_TAGS.has(el.tagName.toUpperCase())) return;
      if (isOwnUi(el)) return;
      if (el !== root && isChrome(el)) return;
      if (isHidden(el)) return;

      // A leaf-ish block with no element children of its own contributes text.
      const hasElementChild = el.firstElementChild !== null;
      if (!hasElementChild) {
        const text = (el as HTMLElement).innerText?.trim() || "";
        if (text) parts.push(text);
        return;
      }
      // Mixed content: pick up direct text nodes, then recurse into children.
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = (child.textContent || "").trim();
          if (text) parts.push(text);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child as Element);
        }
      }
    };
    walk(root);
    return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  };

  /**
   * Content density score. Long prose with real paragraphs scores high; a
   * block that is mostly link text is a menu no matter how many chars it has.
   */
  const scoreOf = (el: HTMLElement, text: string): number => {
    const len = text.length;
    if (len < 140) return 0;

    const paragraphs = el.querySelectorAll("p").length;

    let linkChars = 0;
    for (const a of Array.from(el.querySelectorAll("a"))) {
      linkChars += (a.textContent || "").trim().length;
    }
    const linkRatio = len > 0 ? Math.min(1, linkChars / len) : 0;

    // Link-dominated blocks are navigation; collapse them hard rather than
    // letting sheer size carry a sidebar past the article.
    let score = len * (1 - linkRatio * 1.5);
    score += paragraphs * 120;

    const tag = el.tagName.toUpperCase();
    if (tag === "ARTICLE" || tag === "MAIN") score *= 1.6;
    if (el.getAttribute("role") === "main") score *= 1.6;

    const idClass = `${el.id} ${el.className ? String(el.className) : ""}`.toLowerCase();
    if (/(^|[\s_-])(article|post|entry|content|main|body|story|markdown)/.test(idClass)) {
      score *= 1.25;
    }
    if (/(comment|sidebar|footer|header|nav|menu|banner|promo|related|share)/.test(idClass)) {
      score *= 0.4;
    }

    return score;
  };

  const candidates: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const addCandidate = (el: Element | null): void => {
    if (!(el instanceof HTMLElement) || seen.has(el)) return;
    seen.add(el);
    if (inSkippedRegion(el)) return;
    candidates.push(el);
  };

  for (const el of Array.from(
    document.querySelectorAll(
      "article, main, [role='main'], .post, .article, .entry-content, .content, .markdown-body, #content, #main"
    )
  )) {
    addCandidate(el);
  }
  // Generic containers catch sites with no semantic markup at all.
  for (const el of Array.from(document.querySelectorAll("div, section"))) {
    if (candidates.length > 400) break;
    addCandidate(el);
  }

  let best = "";
  let bestScore = 0;
  for (const el of candidates) {
    const text = readableTextOf(el);
    if (!text) continue;
    const score = scoreOf(el, text);
    if (score > bestScore) {
      bestScore = score;
      best = text;
    }
  }

  // Nothing scored: a short page, or markup we could not read. Fall back to
  // the pruned body rather than returning nothing.
  if (!best && document.body) {
    best = readableTextOf(document.body);
  }

  return { title, url, selected: false, text: best.slice(0, MAX) };
}
