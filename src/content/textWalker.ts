// ============================================================
// Astra Translate – Text Walker
// ============================================================

import { uid } from "../shared/utils";

// Tags whose content should never be translated (technical / non-prose).
// We skip the entire subtree rooted at these tags.
const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "CODE",
  "PRE",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "OPTION",
  "SVG",
  "CANVAS",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "VIDEO",
  "AUDIO",
  "MAP",
  // UI control — its label is chrome, not article content.
  "BUTTON",
]);

// Semantic page-chrome landmarks. Translate the article, not the furniture
// (global navigation, site header/footer, sidebars). Skip the whole subtree.
const SKIP_CHROME_TAGS = new Set(["NAV", "HEADER", "FOOTER", "ASIDE"]);

// ARIA roles that mark a region as chrome rather than main content.
const SKIP_ROLES = new Set([
  "navigation",
  "banner",
  "contentinfo",
  "search",
  "complementary",
]);

// Prefix used by our own injected UI
const AST_PREFIX = "ast-";

/**
 * A collected text node with metadata.
 */
export interface CollectedNode {
  id: string;
  node: Text;
  originalText: string;
}

/**
 * Per-collection caches. Recreated on every `collectTextNodes` call so we
 * never recompute styles or skip decisions for an element (or its shared
 * ancestors) more than once during a single pass.
 */
interface WalkCaches {
  hidden: WeakMap<Element, boolean>;
  skipSubtree: WeakMap<Element, boolean>;
}

/** Is this element visually hidden (and therefore so is its text)? */
function isHiddenElement(el: Element, cache: WeakMap<Element, boolean>): boolean {
  const cached = cache.get(el);
  if (cached !== undefined) return cached;

  let hidden = false;
  if (el instanceof HTMLElement) {
    // `hidden` attribute is unambiguous.
    if (el.hidden) {
      hidden = true;
    } else {
      const style = getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse"
      ) {
        hidden = true;
      }
    }
  }

  cache.set(el, hidden);
  return hidden;
}

/** Does this element start a subtree we should not translate, on its own merits? */
function isSelfSkip(el: Element, caches: WalkCaches): boolean {
  // Technical tags, UI controls, and chrome landmarks.
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (SKIP_CHROME_TAGS.has(el.tagName)) return true;

  const role = el.getAttribute("role");
  if (role && SKIP_ROLES.has(role)) return true;

  // Our own injected UI.
  if (
    el.className?.toString().includes(AST_PREFIX) ||
    el.id?.startsWith(AST_PREFIX)
  ) {
    return true;
  }

  // Invisible content — the user can't see it, so don't spend tokens on it.
  if (isHiddenElement(el, caches.hidden)) return true;

  return false;
}

/**
 * Should the text inside `el` (and its descendants) be skipped?
 * True if `el` itself is a skip boundary or any ancestor is. Memoized per
 * element so each node in the tree is evaluated at most once.
 */
function isInSkippedSubtree(el: Element, caches: WalkCaches): boolean {
  const cached = caches.skipSubtree.get(el);
  if (cached !== undefined) return cached;

  let result: boolean;
  if (isSelfSkip(el, caches)) {
    result = true;
  } else {
    const parent = el.parentElement;
    result = parent ? isInSkippedSubtree(parent, caches) : false;
  }

  caches.skipSubtree.set(el, result);
  return result;
}

/**
 * Check if a text node should be skipped.
 */
function shouldSkipNode(node: Text, caches: WalkCaches): boolean {
  const parent = node.parentElement;
  if (!parent) return true;

  // Skip password fields
  if (parent instanceof HTMLInputElement && parent.type === "password") {
    return true;
  }

  return isInSkippedSubtree(parent, caches);
}

/**
 * Check if text content is worth translating.
 */
function isTranslatableText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Too short
  if (trimmed.length < 2) return false;
  // Pure numbers
  if (/^[\d\s.,:;!?%+\-*/=()[\]{}]+$/.test(trimmed)) return false;
  // Pure punctuation
  if (/^[^\w\s]+$/.test(trimmed)) return false;
  // URL
  if (/^https?:\/\//i.test(trimmed)) return false;
  // Email
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(trimmed)) return false;
  return true;
}

/**
 * Walk the DOM and collect translatable text nodes.
 * Returns an array of CollectedNode objects.
 */
export function collectTextNodes(root: HTMLElement): CollectedNode[] {
  const collected: CollectedNode[] = [];
  const caches: WalkCaches = {
    hidden: new WeakMap(),
    skipSubtree: new WeakMap(),
  };

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (shouldSkipNode(node as Text, caches)) return NodeFilter.FILTER_REJECT;
        const text = (node as Text).textContent?.trim() || "";
        if (!isTranslatableText(text)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent?.trim() || "";
    if (!text) continue;

    collected.push({
      id: uid(),
      node,
      originalText: text,
    });
  }

  return collected;
}
