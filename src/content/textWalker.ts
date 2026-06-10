// ============================================================
// Astra Translate – Text Walker
// ============================================================

import { uid } from "../shared/utils";

// Tags whose content should never be translated
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
]);

// Tags to skip when they are inside these containers
const SKIP_CONTAINERS = new Set(["BUTTON"]);

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
 * Check if a text node should be skipped.
 */
function shouldSkipNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;

  // Skip our own injected UI
  if (
    parent.className?.toString().includes(AST_PREFIX) ||
    parent.id?.startsWith(AST_PREFIX)
  ) {
    return true;
  }

  // Walk up to check ancestor tags
  let el: HTMLElement | null = parent;
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.className?.toString().includes(AST_PREFIX)) return true;
    if (el.id?.startsWith(AST_PREFIX)) return true;
    el = el.parentElement;
  }

  // Skip password fields
  if (
    parent instanceof HTMLInputElement &&
    parent.type === "password"
  ) {
    return true;
  }

  return false;
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

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (shouldSkipNode(node as Text)) return NodeFilter.FILTER_REJECT;
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
