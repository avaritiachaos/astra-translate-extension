// ============================================================
// Astra Translate – Text Walker
// ============================================================

import { uid } from "../shared/utils";

// Tags whose content should never be translated (technical / non-prose).
// We skip the entire subtree rooted at these tags.
const SKIP_TAGS_ALWAYS = new Set([
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

// UI control labels — skipped by default; opt-in via translateUiControls.
const SKIP_UI_CONTROL_TAGS = new Set(["BUTTON"]);

// Semantic page-chrome landmarks. Translate the article, not the furniture
// (global navigation, site header/footer, sidebars). Skip the whole subtree
// unless the user opts into translatePageChrome.
const SKIP_CHROME_TAGS = new Set(["NAV", "HEADER", "FOOTER", "ASIDE"]);

// ARIA roles that mark a region as chrome rather than main content.
const SKIP_ROLES = new Set([
  "navigation",
  "banner",
  "contentinfo",
  "search",
  "complementary",
]);

// input types whose `value` is a visible button label (not user data).
const BUTTON_INPUT_TYPES = new Set(["submit", "button", "reset"]);

// input types that may carry a human-readable placeholder hint.
const PLACEHOLDER_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "tel",
  "url",
  "password",
  "number",
]);

// Prefix used by our own injected UI
const AST_PREFIX = "ast-";

/**
 * Options that control which page regions / UI labels are collected.
 * Defaults match the historical "content-first" behaviour.
 */
export interface TextCollectOptions {
  /** Include nav / header / footer / aside (and matching ARIA roles). */
  translatePageChrome?: boolean;
  /**
   * Include UI control labels: `<button>` text, `input[type=submit|button|reset]`
   * values, and input placeholders. Ordinary input values stay skipped.
   */
  translateUiControls?: boolean;
}

/** Where a collected string lives in the DOM. */
export type TranslateTarget =
  | { type: "text"; node: Text }
  | { type: "attr"; element: HTMLElement; attr: string };

/**
 * A collected translatable unit with metadata.
 */
export interface CollectedNode {
  id: string;
  originalText: string;
  target: TranslateTarget;
}

/**
 * Per-collection caches. Recreated on every `collectTextNodes` call so we
 * never recompute styles or skip decisions for an element (or its shared
 * ancestors) more than once during a single pass.
 */
interface WalkCaches {
  hidden: WeakMap<Element, boolean>;
  skipSubtree: WeakMap<Element, boolean>;
  options: Required<TextCollectOptions>;
}

function normalizeCollectOptions(opts?: TextCollectOptions): Required<TextCollectOptions> {
  return {
    translatePageChrome: opts?.translatePageChrome ?? false,
    translateUiControls: opts?.translateUiControls ?? false,
  };
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
  // Technical tags and form fields — always skipped for text-node walking.
  if (SKIP_TAGS_ALWAYS.has(el.tagName)) return true;

  // Buttons are chrome by default; include when the user opts in.
  if (SKIP_UI_CONTROL_TAGS.has(el.tagName) && !caches.options.translateUiControls) {
    return true;
  }

  // Landmark chrome — skipped unless translatePageChrome is on.
  if (!caches.options.translatePageChrome) {
    if (SKIP_CHROME_TAGS.has(el.tagName)) return true;
    const role = el.getAttribute("role");
    if (role && SKIP_ROLES.has(role)) return true;
  }

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
 *
 * Important: JS `\w` is ASCII-only (`[A-Za-z0-9_]`). Using it to detect
 * "pure punctuation" would reject pure Cyrillic / CJK / Arabic labels like
 * "Вход", "поиск", "Имя:" — exactly the short UI strings page translation
 * most needs. Require at least one Unicode letter instead.
 */
function isTranslatableText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Too short
  if (trimmed.length < 2) return false;
  // Pure numbers / number-ish tokens
  if (/^[\d\s.,:;!?%+\-*/=()[\]{}]+$/.test(trimmed)) return false;
  // Must contain at least one letter in any script (Cyrillic, CJK, Latin, …)
  if (!/\p{L}/u.test(trimmed)) return false;
  // URL
  if (/^https?:\/\//i.test(trimmed)) return false;
  // Email
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(trimmed)) return false;
  return true;
}

/** Host element used for layout / ancestry checks. */
export function targetElement(target: TranslateTarget): Element | null {
  if (target.type === "text") return target.node.parentElement;
  return target.element;
}

/** Read the current string for a target. */
export function readTargetText(target: TranslateTarget): string {
  if (target.type === "text") return target.node.textContent || "";
  return target.element.getAttribute(target.attr) || "";
}

/** Write a translated (or restored) string back onto a target. */
export function writeTargetText(target: TranslateTarget, text: string): void {
  if (target.type === "text") {
    target.node.textContent = text;
    return;
  }
  // Keep input.value in sync for button-like inputs (attribute + property).
  if (
    target.attr === "value" &&
    target.element instanceof HTMLInputElement
  ) {
    target.element.value = text;
    target.element.setAttribute("value", text);
    return;
  }
  if (target.attr === "placeholder" && "placeholder" in target.element) {
    (target.element as HTMLInputElement).placeholder = text;
    return;
  }
  target.element.setAttribute(target.attr, text);
}

/**
 * Collect attribute-based UI labels (submit buttons, placeholders) when the
 * user opts into translateUiControls. Never touches typed user values.
 */
function collectUiAttrTargets(
  root: HTMLElement,
  caches: WalkCaches
): CollectedNode[] {
  if (!caches.options.translateUiControls) return [];

  const collected: CollectedNode[] = [];
  const inputs = root.querySelectorAll("input");

  for (const input of inputs) {
    if (!(input instanceof HTMLInputElement)) continue;
    // Attribute targets still respect chrome / hidden / our own UI, but not
    // the INPUT-as-tag skip (that's only for text-node walking).
    if (isAttrHostSkipped(input, caches)) continue;

    const type = (input.type || "text").toLowerCase();

    if (BUTTON_INPUT_TYPES.has(type)) {
      // Prefer the attribute (static HTML label); fall back to the property.
      const value = input.getAttribute("value") ?? input.value ?? "";
      if (isTranslatableText(value)) {
        collected.push({
          id: uid(),
          originalText: value,
          target: { type: "attr", element: input, attr: "value" },
        });
      }
    }

    if (PLACEHOLDER_INPUT_TYPES.has(type)) {
      const placeholder = input.getAttribute("placeholder") || "";
      if (isTranslatableText(placeholder)) {
        collected.push({
          id: uid(),
          originalText: placeholder,
          target: { type: "attr", element: input, attr: "placeholder" },
        });
      }
    }
  }

  // <textarea placeholder="..."> is also a common UI hint.
  for (const ta of root.querySelectorAll("textarea")) {
    if (!(ta instanceof HTMLTextAreaElement)) continue;
    if (isAttrHostSkipped(ta, caches)) continue;
    const placeholder = ta.getAttribute("placeholder") || "";
    if (isTranslatableText(placeholder)) {
      collected.push({
        id: uid(),
        originalText: placeholder,
        target: { type: "attr", element: ta, attr: "placeholder" },
      });
    }
  }

  return collected;
}

/**
 * Skip rules for attribute hosts: chrome landmarks, our UI, and hidden —
 * but NOT the INPUT/TEXTAREA tag itself (those are only skipped for text walk).
 */
function isAttrHostSkipped(el: Element, caches: WalkCaches): boolean {
  // Our own injected UI.
  if (
    el.className?.toString().includes(AST_PREFIX) ||
    el.id?.startsWith(AST_PREFIX)
  ) {
    return true;
  }
  if (isHiddenElement(el, caches.hidden)) return true;

  // Walk ancestors for chrome / our UI / hidden (ignore INPUT/TEXTAREA self-skip).
  let parent = el.parentElement;
  while (parent) {
    if (
      parent.className?.toString().includes(AST_PREFIX) ||
      parent.id?.startsWith(AST_PREFIX)
    ) {
      return true;
    }
    if (!caches.options.translatePageChrome) {
      if (SKIP_CHROME_TAGS.has(parent.tagName)) return true;
      const role = parent.getAttribute("role");
      if (role && SKIP_ROLES.has(role)) return true;
    }
    if (isHiddenElement(parent, caches.hidden)) return true;
    // Stop at other technical containers that shouldn't contribute labels.
    if (
      parent.tagName === "SCRIPT" ||
      parent.tagName === "STYLE" ||
      parent.tagName === "NOSCRIPT" ||
      parent.tagName === "SVG" ||
      parent.tagName === "TEMPLATE"
    ) {
      return true;
    }
    parent = parent.parentElement;
  }
  return false;
}

/**
 * Walk the DOM and collect translatable units (text nodes + optional UI attrs).
 * Returns an array of CollectedNode objects.
 */
export function collectTextNodes(
  root: HTMLElement,
  options?: TextCollectOptions
): CollectedNode[] {
  const collected: CollectedNode[] = [];
  const caches: WalkCaches = {
    hidden: new WeakMap(),
    skipSubtree: new WeakMap(),
    options: normalizeCollectOptions(options),
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
    // Keep the full original (incl. surrounding whitespace) so restore is exact;
    // translatability still uses the trimmed form.
    const full = node.textContent || "";
    if (!isTranslatableText(full)) continue;

    collected.push({
      id: uid(),
      originalText: full,
      target: { type: "text", node },
    });
  }

  collected.push(...collectUiAttrTargets(root, caches));
  return collected;
}
