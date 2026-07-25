// ============================================================
// Astra Translate – Page Translator
// ============================================================

import type { CollectedNode, TextCollectOptions, TranslateTarget } from "./textWalker";
import type {
  PageTranslateStatus,
  TranslateBatchStreamEvent,
} from "../shared/types";
import { TRANSLATE_BATCH_STREAM_PORT } from "../shared/types";
import {
  collectTextNodes,
  readTargetText,
  targetElement,
  writeTargetText,
} from "./textWalker";
import { MutationTranslator } from "./mutationTranslator";
import { injectThemeVars } from "./selectionBubble";
import { t, type UiLanguage } from "../shared/i18n";
import { debounce } from "../shared/utils";
import { PAGE_SEGMENT_SEPARATOR } from "../shared/constants";
import { lookupUiLexicon, normalizeUiKey } from "../shared/uiLexicon";
import {
  isLearnableUiPair,
  siteLexiconKeys,
  SITE_LEXICON_MAX_CHARS,
} from "../shared/siteLexicon";
import {
  AdaptiveConcurrency,
  classifyBatchOutcome,
  type BatchOutcome,
} from "./adaptiveConcurrency";

const AST_PREFIX = "ast";
const MAX_RETRIES = 1;
const SCROLL_DEBOUNCE_MS = 800;
// Shorter debounce for draining the viewport queue so scrolled-in content
// translates promptly without thrashing layout on every scroll tick.
const DRAIN_DEBOUNCE_MS = 150;
/** Max block-groups per API request. Short UI labels pack denser (see createBatches). */
const MAX_BATCH_GROUPS = 16;
const MAX_SHORT_BATCH_GROUPS = 32;
/** Groups whose total chars are at or below this pack into denser batches. */
const SHORT_GROUP_CHAR_LIMIT = 48;
// If the model fails to preserve segment separators this many times in a row
// (e.g. a provider that strips them), stop grouping for the rest of the session.
const GROUP_FAILURE_LIMIT = 5;

function currentPageKey(): string {
  return `${window.location.origin}${window.location.pathname}${window.location.search}`;
}

/** Escape text interpolated into progress-UI innerHTML. The error branch can
 * carry provider-derived message text — never trust it as markup. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}

/** Vertical margin (in px) treated as "near the viewport" — about one screen
 * above and below, so scrolling reveals already-translated content. */
function viewportMargin(): number {
  return window.innerHeight || document.documentElement.clientHeight || 800;
}

/** Is a laid-out rect within (or near) the vertical viewport? Unit-agnostic so
 * both text-node and block-level callers can share it. */
function rectInViewport(rect: DOMRect, margin: number): boolean {
  if (rect.width === 0 && rect.height === 0) return false;
  const vh = window.innerHeight || document.documentElement.clientHeight || 800;
  return rect.top < vh + margin && rect.bottom > -margin;
}

/** Is the collected target within (or near) the viewport? */
function collectedInViewport(node: CollectedNode, margin: number): boolean {
  const el = targetElement(node.target);
  if (!el) return false;
  return rectInViewport(el.getBoundingClientRect(), margin);
}

// Inline tags do not start a new block — text flows across them. Anything else
// (P, LI, DIV, TD, …) is treated as a block boundary for grouping.
const INLINE_TAGS = new Set([
  "A", "ABBR", "B", "BDI", "BDO", "BR", "CITE", "CODE", "DATA", "DFN", "EM",
  "I", "KBD", "MARK", "Q", "RP", "RT", "RUBY", "S", "SAMP", "SMALL", "SPAN",
  "STRONG", "SUB", "SUP", "TIME", "U", "VAR", "WBR", "FONT", "INS", "DEL",
  "NOBR", "TT", "BIG", "LABEL", "OUTPUT",
]);

/** Nearest ancestor element that is a block (non-inline) boundary. Units
 * sharing the same one belong to the same passage and translate together. */
function nearestBlockAncestor(node: CollectedNode): Element | null {
  // Attribute labels are short UI chrome — treat each host element as its own
  // block so they don't get glued onto neighbouring prose.
  if (node.target.type === "attr") return node.target.element;

  let el = node.target.node.parentElement;
  while (el && INLINE_TAGS.has(el.tagName)) el = el.parentElement;
  return el;
}

/**
 * Group document-ordered nodes into runs that share a block ancestor, so each
 * run can be translated as one coherent passage. Only consecutive same-block
 * nodes group (collectTextNodes returns document order, so a block's fragments
 * are contiguous).
 */
function groupNodesByBlock(nodes: CollectedNode[]): CollectedNode[][] {
  const groups: CollectedNode[][] = [];
  let current: CollectedNode[] = [];
  let currentBlock: Element | null = null;

  for (const n of nodes) {
    const block = nearestBlockAncestor(n);
    if (current.length > 0 && block === currentBlock) {
      current.push(n);
    } else {
      if (current.length > 0) groups.push(current);
      current = [n];
      currentBlock = block;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** The single string sent to the API for a group: fragments joined by the
 * separator (a lone fragment is sent as-is, with no separator). */
function compositeText(group: CollectedNode[]): string {
  if (group.length === 1) return group[0].originalText.trim();
  return group.map((n) => n.originalText.trim()).join(PAGE_SEGMENT_SEPARATOR);
}

function attrKey(target: Extract<TranslateTarget, { type: "attr" }>): string {
  return target.attr;
}

/** Priority for first-paint: UI attrs & short labels before long prose, top of page first. */
function nodePriority(node: CollectedNode): number {
  // Lower = earlier.
  let score = 0;
  if (node.target.type === "attr") score -= 200;
  const len = node.originalText.trim().length;
  if (len <= 24) score -= 80;
  else if (len <= 64) score -= 40;
  else if (len > 200) score += 40;

  const el = targetElement(node.target);
  if (el) {
    const top = el.getBoundingClientRect().top + window.scrollY;
    // Prefer content higher on the page (rough document order fallback).
    score += Math.min(Math.max(top, 0), 20000) / 100;
    const tag = el.tagName;
    if (tag === "H1" || tag === "H2" || tag === "BUTTON" || tag === "LABEL") score -= 30;
    if (tag === "INPUT") score -= 50;
  }
  return score;
}

/**
 * Order block-groups for first-paint priority. Runs AFTER grouping: sorting
 * individual nodes first would break groupNodesByBlock's contiguity premise
 * and scatter a paragraph's fragments across unrelated requests. Nodes inside
 * a group keep document order, so the model sees the passage as written.
 * Scores are computed once per node before sorting — nodePriority reads
 * layout (getBoundingClientRect), and calling it inside the comparator would
 * force O(n·log n) reflow reads.
 */
function sortGroupsByPriority(groups: CollectedNode[][]): CollectedNode[][] {
  const scored = groups.map((group) => {
    let score = Infinity;
    for (const n of group) score = Math.min(score, nodePriority(n));
    return { group, score };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.group);
}

export class PageTranslator {
  private nodeMap: Map<string, CollectedNode> = new Map();
  private translationCache: Map<string, string> = new Map();
  private translatedTexts: Set<string> = new Set();
  /** Text nodes already handled this session. */
  private processedTextNodes: WeakSet<Text> = new WeakSet();
  /** Attribute targets already handled: element → set of attr names. */
  private processedAttrs: WeakMap<Element, Set<string>> = new WeakMap();
  private progressEl: HTMLElement | null = null;
  private progressHideTimer: ReturnType<typeof setTimeout> | null = null;
  private mutationTranslator: MutationTranslator;
  private targetLang: string;
  private batchSize: number;
  private concurrency: number;
  private adaptive: AdaptiveConcurrency;
  private enableRealtime: boolean;
  private wholePage: boolean;
  private enableStreaming: boolean;
  private enableSiteLexicon: boolean;
  private collectOptions: TextCollectOptions;
  private aborted = false;
  private initialDone = false;
  private pageKey = "";
  private statusCallback?: (status: PageTranslateStatus) => void;
  private lang: UiLanguage = "zh-CN";
  private debouncedScrollScan: () => void;
  private onScrollBound: (() => void) | null = null;
  private debouncedDrain: () => void;
  private onResizeBound: (() => void) | null = null;
  // Nodes collected but not yet translated, awaiting scroll into view.
  private deferred: Map<string, CollectedNode> = new Map();
  // Adaptive grouping kill-switch: flipped on after repeated separator-preserve
  // failures so the session degrades gracefully to per-node translation.
  private groupingDisabled = false;
  private groupFailureStreak = 0;
  /** Learned short UI phrases for this host (sourceNorm → translation). */
  private siteLexicon: Map<string, string> = new Map();
  /** Pairs to persist after a successful apply (deduped by source key). */
  private pendingSiteLearn: Map<string, { source: string; translation: string }> =
    new Map();
  /** Learned keys applied this session, pending a usage-stats touch. */
  private pendingSiteTouch: Set<string> = new Set();
  /** Keys already touched this session (avoid re-sending on every lookup). */
  private sessionTouched: Set<string> = new Set();
  private siteLearnFlushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: {
    targetLang: string;
    batchSize?: number;
    concurrency?: number;
    enableRealtime?: boolean;
    translateWholePage?: boolean;
    translatePageChrome?: boolean;
    translateUiControls?: boolean;
    enableStreaming?: boolean;
    enableSiteLexicon?: boolean;
    lang?: UiLanguage;
    onStatus?: (status: PageTranslateStatus) => void;
  }) {
    this.targetLang = opts.targetLang || "Simplified Chinese";
    this.batchSize = opts.batchSize || 6000;
    this.concurrency = opts.concurrency || 4;
    this.adaptive = new AdaptiveConcurrency({ max: this.concurrency, min: 1 });
    this.enableRealtime = opts.enableRealtime ?? true;
    this.wholePage = opts.translateWholePage ?? false;
    this.enableStreaming = opts.enableStreaming ?? true;
    this.enableSiteLexicon = opts.enableSiteLexicon ?? true;
    this.collectOptions = {
      translatePageChrome: opts.translatePageChrome ?? false,
      translateUiControls: opts.translateUiControls ?? false,
    };
    this.statusCallback = opts.onStatus;
    this.lang = opts.lang || "zh-CN";

    this.mutationTranslator = new MutationTranslator(
      (nodes) => {
        this.translateNodes(nodes);
      },
      this.collectOptions
    );

    this.debouncedScrollScan = debounce(() => this.scanForNewNodes(), SCROLL_DEBOUNCE_MS);
    this.debouncedDrain = debounce(() => this.drainDeferred(), DRAIN_DEBOUNCE_MS);
  }

  private isProcessed(node: CollectedNode): boolean {
    if (node.target.type === "text") {
      return this.processedTextNodes.has(node.target.node);
    }
    const attrs = this.processedAttrs.get(node.target.element);
    return attrs?.has(attrKey(node.target)) ?? false;
  }

  private markProcessed(node: CollectedNode): void {
    if (node.target.type === "text") {
      this.processedTextNodes.add(node.target.node);
      this.mutationTranslator.markProcessed(node.target.node);
      return;
    }
    let attrs = this.processedAttrs.get(node.target.element);
    if (!attrs) {
      attrs = new Set();
      this.processedAttrs.set(node.target.element, attrs);
    }
    attrs.add(attrKey(node.target));
    this.mutationTranslator.markProcessed(node.target.element);
  }

  async start(): Promise<void> {
    this.aborted = false;
    this.initialDone = false;
    this.groupingDisabled = false;
    this.groupFailureStreak = 0;
    this.pendingSiteLearn.clear();
    this.pageKey = currentPageKey();
    this.showProgress({ phase: "collecting", total: 0, completed: 0, failed: 0 });

    // Load per-host learned UI phrases (instant, zero API).
    await this.loadSiteLexicon();

    const nodes = collectTextNodes(document.body, this.collectOptions);
    if (nodes.length === 0) {
      this.showProgress({ phase: "done", total: 0, completed: 0, failed: 0 });
      return;
    }

    for (const n of nodes) {
      this.nodeMap.set(n.id, n);
      this.markProcessed(n);
    }

    if (this.enableRealtime) {
      // Start MutationTranslator immediately to catch dynamically added nodes.
      this.mutationTranslator.start();
    }
    // Scroll/resize detection drives both the deferred-queue drain and
    // lazy-loaded content detection.
    this.startScrollDetection();

    // Viewport-first: translate what the user can see now (plus ~1 screen of
    // margin); defer the rest until it scrolls into view, so we don't spend
    // tokens on parts of a long page the user may never read. When the user
    // opts into whole-page translation, everything is translated up front.
    const margin = viewportMargin();
    const visible: CollectedNode[] = [];
    for (const n of nodes) {
      if (this.wholePage || collectedInViewport(n, margin)) {
        visible.push(n);
      } else {
        this.deferred.set(n.id, n);
      }
    }

    // Fallback: if nothing measured as visible (e.g. layout not settled yet on
    // a deep-linked anchor), translate the first screenful rather than nothing.
    let initialNodes = visible;
    if (initialNodes.length === 0) {
      initialNodes = nodes.slice(0, MAX_BATCH_GROUPS * this.concurrency);
      for (const n of initialNodes) this.deferred.delete(n.id);
    }

    // Instant UI lexicon first so buttons/nav labels paint before any API wait.
    const collectedCount = initialNodes.length;
    initialNodes = this.applyLexiconHits(initialNodes);
    const lexiconDone = collectedCount - initialNodes.length;

    this.showProgress({
      phase: "translating",
      total: collectedCount,
      completed: lexiconDone,
      failed: 0,
    });

    await this.runPrioritizedBatches(initialNodes, {
      total: collectedCount,
      completed: lexiconDone,
      failed: 0,
    });

    if (this.aborted) return;

    this.initialDone = true;
    this.flushSiteLexiconLearn();
  }

  /** Load learned short labels for this hostname + target language. */
  private async loadSiteLexicon(): Promise<void> {
    this.siteLexicon.clear();
    if (!this.enableSiteLexicon) return;
    try {
      const host = location.hostname;
      const res = await chrome.runtime.sendMessage({
        type: "GET_SITE_LEXICON",
        payload: { host, targetLang: this.targetLang },
      });
      if (res?.success && res.map && typeof res.map === "object") {
        for (const [k, v] of Object.entries(res.map as Record<string, string>)) {
          if (k && typeof v === "string") this.siteLexicon.set(k, v);
        }
      }
    } catch {
      // Offline / SW restart — continue without site lexicon.
    }
  }

  /** Global UI lexicon first, then per-site learned map. */
  private lookupInstant(text: string): string | null {
    const global = lookupUiLexicon(text, this.targetLang);
    if (global) return global;

    for (const key of siteLexiconKeys(text)) {
      const hit = this.siteLexicon.get(key);
      if (!hit) continue;
      // Keep the store's lastUsedAt fresh so eviction is LRU by use.
      this.queueSiteTouch(key);
      const trimmed = text.trim();
      if (/[:：]\s*$/.test(trimmed) && !/[:：]\s*$/.test(hit)) {
        return hit + (trimmed.includes("：") ? "：" : ":");
      }
      return hit;
    }
    return null;
  }

  /** Queue a usage-stats touch for a learned key (deduped per session). */
  private queueSiteTouch(key: string): void {
    if (!this.enableSiteLexicon) return;
    if (this.sessionTouched.has(key)) return;
    this.sessionTouched.add(key);
    this.pendingSiteTouch.add(key);
    this.scheduleSiteFlush();
  }

  /** Queue a short UI pair for persistent site learning. */
  private queueSiteLearn(source: string, translation: string): void {
    if (!this.enableSiteLexicon) return;
    if (!isLearnableUiPair(source, translation)) return;
    const key = normalizeUiKey(source.replace(/[:：]\s*$/, ""));
    if (!key) return;
    // Keep in-memory map hot for the rest of this session.
    this.siteLexicon.set(key, translation.trim());
    this.pendingSiteLearn.set(key, {
      source: source.trim(),
      translation: translation.trim(),
    });
    this.scheduleSiteFlush();
  }

  private scheduleSiteFlush(): void {
    if (this.siteLearnFlushTimer) return;
    this.siteLearnFlushTimer = setTimeout(() => {
      this.siteLearnFlushTimer = null;
      this.flushSiteLexiconLearn();
    }, 2000);
  }

  private flushSiteLexiconLearn(): void {
    if (this.siteLearnFlushTimer) {
      clearTimeout(this.siteLearnFlushTimer);
      this.siteLearnFlushTimer = null;
    }
    if (!this.enableSiteLexicon) {
      this.pendingSiteLearn.clear();
      this.pendingSiteTouch.clear();
      return;
    }
    if (this.pendingSiteLearn.size > 0) {
      const pairs = Array.from(this.pendingSiteLearn.values());
      this.pendingSiteLearn.clear();
      chrome.runtime
        .sendMessage({
          type: "LEARN_SITE_LEXICON",
          payload: {
            host: location.hostname,
            targetLang: this.targetLang,
            pairs,
          },
        })
        .catch(() => {});
    }
    if (this.pendingSiteTouch.size > 0) {
      const sources = Array.from(this.pendingSiteTouch);
      this.pendingSiteTouch.clear();
      chrome.runtime
        .sendMessage({
          type: "TOUCH_SITE_LEXICON",
          payload: {
            host: location.hostname,
            targetLang: this.targetLang,
            sources,
          },
        })
        .catch(() => {});
    }
  }

  /**
   * Translate a prioritized set of nodes (the initial viewport pass) with the
   * configured concurrency, driving the main progress bar and finishing with a
   * "done" status. `seed` carries progress already earned (e.g. lexicon hits).
   */
  private async runPrioritizedBatches(
    nodes: CollectedNode[],
    seed?: { total: number; completed: number; failed: number }
  ): Promise<void> {
    const total = seed?.total ?? nodes.length;
    let completed = seed?.completed ?? 0;
    let failed = seed?.failed ?? 0;

    if (nodes.length === 0) {
      if (!this.aborted) {
        this.showProgress({ phase: "done", total, completed, failed });
      }
      return;
    }

    const groups = this.buildPrioritizedGroups(nodes);
    const batches = this.createBatches(groups);

    const result = await this.runAdaptiveQueue(batches, (c, f) => {
      this.showProgress({
        phase: "translating",
        total,
        completed: completed + c,
        failed: failed + f,
      });
    });
    completed += result.completed;
    failed += result.failed;

    if (this.aborted) return;

    this.showProgress({ phase: "done", total, completed, failed });
  }

  /**
   * Translate a set of deferred nodes that just scrolled into view. Uses the
   * subtle scroll hint rather than taking over the main progress bar.
   */
  private async runDeferredBatches(nodes: CollectedNode[]): Promise<void> {
    const remaining = this.applyLexiconHits(nodes);
    if (remaining.length === 0) return;

    const groups = this.buildPrioritizedGroups(remaining);
    const batches = this.createBatches(groups);
    await this.runAdaptiveQueue(batches);
  }

  /**
   * Drain a batch queue with adaptive parallelism: starts at the user max,
   * shrinks on rate-limit / transient errors, climbs back after success streaks.
   */
  private runAdaptiveQueue(
    batches: CollectedNode[][][],
    onProgress?: (completed: number, failed: number) => void
  ): Promise<{ completed: number; failed: number }> {
    if (batches.length === 0) {
      return Promise.resolve({ completed: 0, failed: 0 });
    }

    let completed = 0;
    let failed = 0;
    let next = 0;
    let active = 0;

    return new Promise((resolve) => {
      const finishIfDone = () => {
        // Cancellation (restore / SPA navigation) stops new batches from being
        // queued, so "all queued" can never come true — resolve as soon as
        // in-flight work drains or the awaiting start() hangs forever.
        const cancelled = !this.isActiveOnCurrentPage();
        if (active === 0 && (next >= batches.length || cancelled)) {
          resolve({ completed, failed });
        }
      };

      const pump = () => {
        if (!this.isActiveOnCurrentPage()) {
          // Don't start new work; wait for in-flight to settle.
          finishIfDone();
          return;
        }

        while (active < this.adaptive.current && next < batches.length) {
          const batch = batches[next++];
          active += 1;

          this.translateBatch(batch)
            .then((result) => {
              completed += result.completed;
              failed += result.failed;
              this.adaptive.note(result.outcome);
              onProgress?.(completed, failed);
            })
            .catch(() => {
              // translateBatch already swallows API errors into failed counts;
              // this is a safety net for unexpected throws.
              this.adaptive.note("transient");
            })
            .finally(() => {
              active -= 1;
              if (next < batches.length && this.isActiveOnCurrentPage()) {
                pump();
              } else {
                finishIfDone();
              }
            });
        }

        finishIfDone();
      };

      pump();
    });
  }

  /**
   * Apply local UI lexicon + site-learned hits instantly (no API).
   * Returns nodes that still need model translation.
   */
  private applyLexiconHits(nodes: CollectedNode[]): CollectedNode[] {
    const remaining: CollectedNode[] = [];
    for (const n of nodes) {
      const src = n.originalText.trim();
      const hit = this.lookupInstant(src);
      if (hit && hit !== src) {
        this.applyTranslation(n, hit, { learn: false });
        // Cache under the composite key used by translateBatch (trimmed text).
        this.translationCache.set(src, hit);
        continue;
      }
      remaining.push(n);
    }
    return remaining;
  }

  /**
   * Move deferred nodes that have scrolled into view out of the queue and
   * translate them. Called (debounced) on scroll and resize.
   */
  private drainDeferred(): void {
    if (!this.isActiveOnCurrentPage()) return;
    if (this.deferred.size === 0) return;

    const margin = viewportMargin();
    const nowVisible: CollectedNode[] = [];
    for (const [id, n] of this.deferred) {
      if (collectedInViewport(n, margin)) {
        nowVisible.push(n);
        this.deferred.delete(id);
      }
    }

    if (nowVisible.length > 0) {
      this.showScrollHint(nowVisible.length);
      this.runDeferredBatches(nowVisible);
    }
  }

  restore(): void {
    this.aborted = true;
    this.initialDone = false;
    this.flushSiteLexiconLearn();
    this.mutationTranslator.stop();
    this.mutationTranslator.reset();
    this.stopScrollDetection();

    for (const [, info] of this.nodeMap) {
      writeTargetText(info.target, info.originalText);
    }

    this.nodeMap.clear();
    this.deferred.clear();
    this.translationCache.clear();
    this.translatedTexts.clear();
    this.processedTextNodes = new WeakSet();
    this.processedAttrs = new WeakMap();
    this.removeProgress();
  }

  abort(): void {
    this.aborted = true;
    this.flushSiteLexiconLearn();
    this.mutationTranslator.stop();
    this.stopScrollDetection();
    this.removeProgress();
  }

  /** Start listening for scroll/resize to translate content as it enters view. */
  private startScrollDetection(): void {
    this.onScrollBound = () => {
      // Draining the deferred queue is core to viewport-first translation and
      // always runs. Scanning for lazy-loaded *new* DOM is the realtime feature.
      this.debouncedDrain();
      if (this.enableRealtime) this.debouncedScrollScan();
    };
    window.addEventListener("scroll", this.onScrollBound, { passive: true });

    this.onResizeBound = () => this.debouncedDrain();
    window.addEventListener("resize", this.onResizeBound, { passive: true });
  }

  /** Stop scroll/resize detection. */
  private stopScrollDetection(): void {
    if (this.onScrollBound) {
      window.removeEventListener("scroll", this.onScrollBound);
      this.onScrollBound = null;
    }
    if (this.onResizeBound) {
      window.removeEventListener("resize", this.onResizeBound);
      this.onResizeBound = null;
    }
  }

  /**
   * Scan the DOM for text nodes that haven't been translated yet.
   * This catches lazy-loaded content that wasn't in the DOM during
   * the initial pass and wasn't picked up by the MutationObserver.
   */
  private scanForNewNodes(): void {
    if (!this.isActiveOnCurrentPage()) return;

    const allNodes = collectTextNodes(document.body, this.collectOptions);
    const newNodes: CollectedNode[] = [];

    for (const n of allNodes) {
      // Skip targets this translator has already handled.
      if (this.isProcessed(n)) continue;

      const text = n.originalText.trim();
      if (this.translatedTexts.has(text)) {
        this.markProcessed(n);
        this.nodeMap.set(n.id, n);
        continue;
      }

      // Check if this exact text was already translated (same content, different node)
      const cachedTranslation = this.translationCache.get(text);
      if (cachedTranslation) {
        // Same text as something already translated — apply cached translation
        this.markProcessed(n);
        this.applyTranslation(n, cachedTranslation);
        this.nodeMap.set(n.id, n);
        continue;
      }

      // Check if the target's current text looks like it's already translated
      // (i.e., it was changed by something else).
      const currentText = readTargetText(n.target).trim();
      if (currentText !== text) {
        this.markProcessed(n);
        this.nodeMap.set(n.id, n);
        continue;
      }

      // Truly new untranslated node
      newNodes.push(n);
      this.nodeMap.set(n.id, n);
    }

    if (newNodes.length > 0) {
      if (this.initialDone) {
        this.showScrollHint(newNodes.length);
      }
      this.translateNodes(newNodes);
    }
  }

  /** Group nodes by block for sentence context — unless grouping was adaptively
   * disabled this session, in which case each node is its own (singleton) group. */
  private buildGroups(nodes: CollectedNode[]): CollectedNode[][] {
    return this.groupingDisabled ? nodes.map((n) => [n]) : groupNodesByBlock(nodes);
  }

  /** Group in document order (the contiguity groupNodesByBlock relies on),
   * then order whole groups for first-paint priority. */
  private buildPrioritizedGroups(nodes: CollectedNode[]): CollectedNode[][] {
    return sortGroupsByPriority(this.buildGroups(nodes));
  }

  /** Record a multi-fragment group whose separator split failed; trip the
   * kill-switch after too many in a row. */
  private noteGroupFailure(): void {
    this.groupFailureStreak++;
    if (this.groupFailureStreak >= GROUP_FAILURE_LIMIT) {
      this.groupingDisabled = true;
    }
  }

  /** Pack block-groups into batches under the char budget and group-count cap.
   * Short UI-only groups pack denser so one request covers many buttons. */
  private createBatches(groups: CollectedNode[][]): CollectedNode[][][] {
    const batches: CollectedNode[][][] = [];
    let currentBatch: CollectedNode[][] = [];
    let currentSize = 0;
    let currentAllShort = true;

    for (const group of groups) {
      const groupLen = group.reduce((sum, n) => sum + n.originalText.trim().length, 0);
      const groupIsShort = groupLen <= SHORT_GROUP_CHAR_LIMIT;
      const countCap =
        currentAllShort && groupIsShort ? MAX_SHORT_BATCH_GROUPS : MAX_BATCH_GROUPS;
      const exceedsTextBudget = currentSize + groupLen > this.batchSize;
      const exceedsCountBudget = currentBatch.length >= countCap;
      if ((exceedsTextBudget || exceedsCountBudget) && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentSize = 0;
        currentAllShort = true;
      }
      currentBatch.push(group);
      currentSize += groupLen;
      if (!groupIsShort) currentAllShort = false;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }

  /**
   * Apply a translated composite to a group's nodes. For a multi-fragment group
   * the composite is split on the separator and each segment maps back to its
   * node 1:1 — inline elements are never moved, so they're preserved. Returns
   * false WITHOUT mutating when the split doesn't line up (wrong segment count,
   * or a dropped segment), so the caller can fall back to per-node translation
   * rather than risk garbling the passage.
   */
  private applyGroup(group: CollectedNode[], translated: string): boolean {
    if (group.length === 1) {
      this.applyTranslation(group[0], translated);
      return true;
    }

    const segments = translated.split(PAGE_SEGMENT_SEPARATOR);
    if (segments.length !== group.length) return false;
    for (let i = 0; i < group.length; i++) {
      if (group[i].originalText.trim() !== "" && segments[i].trim() === "") {
        return false;
      }
    }

    for (let i = 0; i < group.length; i++) {
      // Mid-sentence fragments of a passage are context-bound — learning
      // them as standalone site-lexicon entries would replay e.g. "here"→
      // "此处" out of context on every later page of this host.
      this.applyTranslation(group[i], segments[i], { learn: false });
    }
    return true;
  }

  /**
   * Apply one streamed/final item id → text onto all groups that share that source.
   * A later event for the same id with different text is a correction (the model
   * fixed itself in the final JSON) — re-applied in place, but not re-counted.
   * Returns how many nodes were successfully written.
   */
  private applyStreamedItem(
    itemId: string,
    text: string,
    items: { id: string; text: string }[],
    uncachedByText: Map<string, CollectedNode[][]>,
    applied: Map<string, string>
  ): { nodes: number; needFallback: CollectedNode[][] } {
    if (applied.get(itemId) === text) {
      return { nodes: 0, needFallback: [] };
    }
    const isCorrection = applied.has(itemId);
    const source = items.find((item) => item.id === itemId);
    if (!source) return { nodes: 0, needFallback: [] };

    const groups = uncachedByText.get(source.text);
    if (!groups) return { nodes: 0, needFallback: [] };

    let nodes = 0;
    const needFallback: CollectedNode[][] = [];
    let cachedOnce = false;

    for (const group of groups) {
      if (this.applyGroup(group, text)) {
        if (!cachedOnce) {
          this.translationCache.set(source.text, text);
          cachedOnce = true;
        }
        nodes += group.length;
        if (group.length > 1) this.groupFailureStreak = 0;
      } else if (!isCorrection) {
        // A correction that fails to split leaves the earlier applied text in
        // place — don't queue a fallback for content that already renders.
        needFallback.push(group);
        if (group.length > 1) this.noteGroupFailure();
      }
    }

    applied.set(itemId, text);
    // Corrections rewrite already-counted nodes — counting again would
    // overstate progress.
    return { nodes: isCorrection ? 0 : nodes, needFallback };
  }

  /**
   * Translate a batch via streaming port when available (items paint as the
   * model emits them). Falls back to one-shot TRANSLATE_BATCH on port failure.
   */
  private async translateBatch(
    batch: CollectedNode[][]
  ): Promise<{ completed: number; failed: number; outcome: BatchOutcome }> {
    if (!this.isActiveOnCurrentPage()) {
      return { completed: 0, failed: 0, outcome: "fail" };
    }

    const uncachedByText: Map<string, CollectedNode[][]> = new Map();
    let completed = 0;

    for (const group of batch) {
      const composite = compositeText(group);
      const cached = this.translationCache.get(composite);
      if (cached !== undefined && this.applyGroup(group, cached)) {
        completed += group.length;
      } else {
        const existing = uncachedByText.get(composite);
        if (existing) existing.push(group);
        else uncachedByText.set(composite, [group]);
      }
    }

    if (uncachedByText.size === 0) {
      return { completed, failed: 0, outcome: "success" };
    }

    const items = Array.from(uncachedByText, ([text, groups]) => ({
      id: groups[0][0].id,
      text,
    }));
    const uncachedCount = Array.from(uncachedByText.values()).reduce(
      (sum, groups) => sum + groups.reduce((s, g) => s + g.length, 0),
      0
    );

    // Prefer streaming when enabled; fall back to one-shot on failure.
    if (this.enableStreaming) {
      try {
        return await this.translateBatchStreaming(
          items,
          uncachedByText,
          uncachedCount,
          completed
        );
      } catch {
        // Port unavailable / SW restart — one-shot path.
      }
    }

    return this.translateBatchOneShot(
      items,
      uncachedByText,
      uncachedCount,
      completed
    );
  }

  private translateBatchStreaming(
    items: { id: string; text: string }[],
    uncachedByText: Map<string, CollectedNode[][]>,
    uncachedCount: number,
    completedSeed: number
  ): Promise<{ completed: number; failed: number; outcome: BatchOutcome }> {
    return new Promise((resolve, reject) => {
      let port: chrome.runtime.Port;
      try {
        port = chrome.runtime.connect({ name: TRANSLATE_BATCH_STREAM_PORT });
      } catch (err) {
        reject(err);
        return;
      }

      let completed = completedSeed;
      let translatedCount = 0;
      const applied = new Map<string, string>();
      const needFallback: CollectedNode[][] = [];
      let settled = false;

      const settle = (result: {
        completed: number;
        failed: number;
        outcome: BatchOutcome;
      }) => {
        if (settled) return;
        settled = true;
        try {
          port.disconnect();
        } catch {
          // ignore
        }
        resolve(result);
      };

      port.onDisconnect.addListener(() => {
        if (settled) return;
        // Unexpected disconnect mid-stream — if we got nothing, reject to fall back.
        if (translatedCount === 0) {
          settled = true;
          reject(new Error("port disconnected"));
          return;
        }
        settle({
          completed,
          failed: Math.max(0, uncachedCount - translatedCount),
          outcome: "transient",
        });
      });

      port.onMessage.addListener((event: TranslateBatchStreamEvent) => {
        if (!this.isActiveOnCurrentPage()) {
          settle({ completed, failed: 0, outcome: "fail" });
          return;
        }

        if (event.type === "item") {
          const r = this.applyStreamedItem(
            event.id,
            event.text,
            items,
            uncachedByText,
            applied
          );
          completed += r.nodes;
          translatedCount += r.nodes;
          needFallback.push(...r.needFallback);
          return;
        }

        if (event.type === "done") {
          // Apply any items only present in the final payload.
          for (const item of event.items || []) {
            const r = this.applyStreamedItem(
              item.id,
              item.text,
              items,
              uncachedByText,
              applied
            );
            completed += r.nodes;
            translatedCount += r.nodes;
            needFallback.push(...r.needFallback);
          }

          const doneOutcome: BatchOutcome = event.success
            ? "success"
            : classifyBatchOutcome(event.errorCode, event.error);

          // Rate limits and transient provider failures were already retried
          // with backoff in the service worker — re-sending per-group here
          // would hammer a struggling endpoint. Report honestly and let
          // adaptive concurrency slow the fleet down instead.
          if (doneOutcome === "rate_limit" || doneOutcome === "transient") {
            settle({
              completed,
              failed: Math.max(0, uncachedCount - translatedCount),
              outcome: doneOutcome,
            });
            return;
          }

          const runFallback = async () => {
            let fallbackWorst: BatchOutcome | null = null;
            for (const group of needFallback) {
              if (!this.isActiveOnCurrentPage()) break;
              const fb = await this.translateBatch(group.map((n) => [n]));
              completed += fb.completed;
              translatedCount += fb.completed;
              if (fb.outcome === "rate_limit") {
                fallbackWorst = "rate_limit";
              } else if (fb.outcome === "transient" && fallbackWorst !== "rate_limit") {
                fallbackWorst = "transient";
              }
            }

            // Honest outcome: "success" only when nothing is left untranslated.
            // A batch that half-applied from cache while the request 401'd
            // must not feed "success" into adaptive concurrency.
            const failed = Math.max(0, uncachedCount - translatedCount);
            const outcome: BatchOutcome =
              fallbackWorst ??
              (failed > 0
                ? doneOutcome === "success"
                  ? "fail"
                  : doneOutcome
                : "success");

            settle({ completed, failed, outcome });
          };

          runFallback().catch(() => {
            settle({
              completed,
              failed: Math.max(0, uncachedCount - translatedCount),
              outcome: "transient",
            });
          });
        }
      });

      try {
        port.postMessage({
          type: "TRANSLATE_BATCH_STREAM",
          payload: { items, targetLang: this.targetLang },
        });
      } catch (err) {
        settled = true;
        reject(err);
      }
    });
  }

  private async translateBatchOneShot(
    items: { id: string; text: string }[],
    uncachedByText: Map<string, CollectedNode[][]>,
    uncachedCount: number,
    completedSeed: number
  ): Promise<{ completed: number; failed: number; outcome: BatchOutcome }> {
    let completed = completedSeed;
    let retries = 0;
    let lastOutcome: BatchOutcome = "fail";

    while (retries <= MAX_RETRIES) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "TRANSLATE_BATCH",
          payload: { items, targetLang: this.targetLang },
        });

        if (!this.isActiveOnCurrentPage()) {
          return { completed, failed: 0, outcome: lastOutcome };
        }

        if (response?.success && response.items) {
          let translatedCount = 0;
          const needFallback: CollectedNode[][] = [];
          const applied = new Map<string, string>();

          for (const translated of response.items) {
            const r = this.applyStreamedItem(
              translated.id,
              translated.text,
              items,
              uncachedByText,
              applied
            );
            completed += r.nodes;
            translatedCount += r.nodes;
            needFallback.push(...r.needFallback);
          }

          let fallbackWorst: BatchOutcome | null = null;
          for (const group of needFallback) {
            if (!this.isActiveOnCurrentPage()) break;
            const fb = await this.translateBatch(group.map((n) => [n]));
            completed += fb.completed;
            translatedCount += fb.completed;
            if (fb.outcome === "rate_limit") {
              fallbackWorst = "rate_limit";
            } else if (fb.outcome === "transient" && fallbackWorst !== "rate_limit") {
              fallbackWorst = "transient";
            }
          }

          // Honest outcome: "success" only when nothing is left untranslated.
          const failed = Math.max(0, uncachedCount - translatedCount);
          const outcome: BatchOutcome =
            fallbackWorst ?? (failed > 0 ? "fail" : "success");
          return { completed, failed, outcome };
        } else {
          lastOutcome = classifyBatchOutcome(response?.errorCode, response?.error);
          // A structured code means the service worker already ran its own
          // backoff retries — looping here again only multiplies the load.
          // Only legacy/uncoded failures keep the single outer retry.
          if (response?.errorCode) break;
          retries++;
        }
      } catch {
        if (!this.isActiveOnCurrentPage()) {
          return { completed, failed: 0, outcome: lastOutcome };
        }
        lastOutcome = "transient";
        retries++;
      }
    }

    return { completed, failed: uncachedCount, outcome: lastOutcome };
  }

  private async translateNodes(nodes: CollectedNode[]): Promise<void> {
    if (!this.isActiveOnCurrentPage()) return;

    const pendingNodes: CollectedNode[] = [];
    for (const node of nodes) {
      if (this.isProcessed(node)) continue;

      this.markProcessed(node);
      this.nodeMap.set(node.id, node);

      if (this.translatedTexts.has(node.originalText.trim())) continue;
      pendingNodes.push(node);
    }

    if (pendingNodes.length === 0) return;

    const remaining = this.applyLexiconHits(pendingNodes);
    if (remaining.length === 0) return;

    const groups = this.buildPrioritizedGroups(remaining);
    const batches = this.createBatches(groups);
    await this.runAdaptiveQueue(batches);
  }

  private applyTranslation(
    node: CollectedNode,
    translated: string,
    opts?: { learn?: boolean }
  ): void {
    writeTargetText(node.target, translated);
    const translatedText = translated.trim();
    if (translatedText) {
      this.translatedTexts.add(translatedText);
    }
    // Learn short UI labels from model output (and attribute buttons).
    if (opts?.learn !== false) {
      const src = node.originalText.trim();
      if (src.length <= SITE_LEXICON_MAX_CHARS) {
        this.queueSiteLearn(src, translatedText || translated);
      }
    }
  }

  private showProgress(status: PageTranslateStatus): void {
    this.statusCallback?.(status);

    if (!this.progressEl) {
      injectThemeVars();
      this.progressEl = document.createElement("div");
      document.body.appendChild(this.progressEl);
    }
    this.progressEl.className = `${AST_PREFIX}-progress`;

    if (status.phase !== "done") {
      this.clearProgressHideTimer();
    }

    let text = "";
    let progress = 0;

    switch (status.phase) {
      case "collecting":
        text = t(this.lang, "page.collecting");
        break;
      case "translating":
        progress = status.total > 0 ? (status.completed / status.total) * 100 : 0;
        text = status.failed > 0
          ? t(this.lang, "page.translatingWithFail", { done: status.completed, total: status.total, failed: status.failed })
          : t(this.lang, "page.translating", { done: status.completed, total: status.total });
        break;
      case "done":
        text = status.failed > 0
          ? t(this.lang, "page.completedWithFail", { failed: status.failed })
          : t(this.lang, "page.completed");
        progress = 100;
        this.scheduleProgressRemoval(3000);
        break;
      case "error":
        text = `${t(this.lang, "page.failed")}: ${status.error || t(this.lang, "error.unknown")}`;
        break;
    }

    this.progressEl.innerHTML = `
      <div class="${AST_PREFIX}-spinner"></div>
      <div>
        <div>${escapeHtml(text)}</div>
        ${status.phase === "translating" ? `
        <div class="${AST_PREFIX}-progress-bar">
          <div class="${AST_PREFIX}-progress-fill" style="width:${progress}%"></div>
        </div>` : ""}
      </div>
      ${status.phase === "translating" || status.phase === "collecting" ? `
      <button class="${AST_PREFIX}-progress-stop" title="${t(this.lang, "popup.restorePage")}">✕</button>
      ` : ""}
    `;

    // Wire up stop button
    if (status.phase === "translating" || status.phase === "collecting") {
      const stopBtn = this.progressEl.querySelector(`.${AST_PREFIX}-progress-stop`);
      stopBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.restore();
      });
    }
  }

  /** Show a brief, subtle hint when scroll-based translation detects new content. */
  private showScrollHint(count: number): void {
    if (!this.progressEl) {
      injectThemeVars();
      this.progressEl = document.createElement("div");
      document.body.appendChild(this.progressEl);
    }
    this.progressEl.className = `${AST_PREFIX}-progress ${AST_PREFIX}-scroll-hint`;
    this.progressEl.innerHTML = `
      <div class="${AST_PREFIX}-spinner"></div>
      <div>${t(this.lang, "page.scrollHint", { count })}</div>
    `;
    this.scheduleProgressRemoval(2000);
  }

  private scheduleProgressRemoval(ms: number): void {
    this.clearProgressHideTimer();
    this.progressHideTimer = setTimeout(() => this.removeProgress(), ms);
  }

  private clearProgressHideTimer(): void {
    if (this.progressHideTimer) {
      clearTimeout(this.progressHideTimer);
      this.progressHideTimer = null;
    }
  }

  private removeProgress(): void {
    this.clearProgressHideTimer();
    this.progressEl?.remove();
    this.progressEl = null;
  }

  private isActiveOnCurrentPage(): boolean {
    return !this.aborted && this.pageKey === currentPageKey();
  }
}
