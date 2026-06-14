// ============================================================
// Astra Translate – Page Translator
// ============================================================

import type { CollectedNode } from "./textWalker";
import type { PageTranslateStatus } from "../shared/types";
import { collectTextNodes } from "./textWalker";
import { MutationTranslator } from "./mutationTranslator";
import { injectThemeVars } from "./selectionBubble";
import { t, type UiLanguage } from "../shared/i18n";
import { debounce } from "../shared/utils";
import { PAGE_SEGMENT_SEPARATOR } from "../shared/constants";

const AST_PREFIX = "ast";
const MAX_RETRIES = 1;
const SCROLL_DEBOUNCE_MS = 1500;
// Shorter debounce for draining the viewport queue so scrolled-in content
// translates promptly without thrashing layout on every scroll tick.
const DRAIN_DEBOUNCE_MS = 250;
const MAX_BATCH_NODES = 8;
// If the model fails to preserve segment separators this many times in a row
// (e.g. a provider that strips them), stop grouping for the rest of the session.
const GROUP_FAILURE_LIMIT = 5;

function currentPageKey(): string {
  return `${window.location.origin}${window.location.pathname}${window.location.search}`;
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

/** Is the text node's containing element within (or near) the viewport? */
function nodeInViewport(node: Text, margin: number): boolean {
  const el = node.parentElement;
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

/** Nearest ancestor element that is a block (non-inline) boundary. Text nodes
 * sharing the same one belong to the same passage and translate together. */
function nearestBlockAncestor(node: Text): Element | null {
  let el = node.parentElement;
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
    const block = nearestBlockAncestor(n.node);
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
  if (group.length === 1) return group[0].originalText;
  return group.map((n) => n.originalText).join(PAGE_SEGMENT_SEPARATOR);
}

export class PageTranslator {
  private nodeMap: Map<string, CollectedNode> = new Map();
  private translationCache: Map<string, string> = new Map();
  private translatedTexts: Set<string> = new Set();
  private processedTextNodes: WeakSet<Text> = new WeakSet();
  private originalTexts: WeakMap<Text, string> = new WeakMap();
  private progressEl: HTMLElement | null = null;
  private progressHideTimer: ReturnType<typeof setTimeout> | null = null;
  private mutationTranslator: MutationTranslator;
  private targetLang: string;
  private batchSize: number;
  private concurrency: number;
  private enableRealtime: boolean;
  private wholePage: boolean;
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

  constructor(opts: {
    targetLang: string;
    batchSize?: number;
    concurrency?: number;
    enableRealtime?: boolean;
    translateWholePage?: boolean;
    lang?: UiLanguage;
    onStatus?: (status: PageTranslateStatus) => void;
  }) {
    this.targetLang = opts.targetLang || "Simplified Chinese";
    this.batchSize = opts.batchSize || 4000;
    this.concurrency = opts.concurrency || 2;
    this.enableRealtime = opts.enableRealtime ?? true;
    this.wholePage = opts.translateWholePage ?? false;
    this.statusCallback = opts.onStatus;
    this.lang = opts.lang || "zh-CN";

    this.mutationTranslator = new MutationTranslator((nodes) => {
      this.translateNodes(nodes);
    });

    this.debouncedScrollScan = debounce(() => this.scanForNewNodes(), SCROLL_DEBOUNCE_MS);
    this.debouncedDrain = debounce(() => this.drainDeferred(), DRAIN_DEBOUNCE_MS);
  }

  async start(): Promise<void> {
    this.aborted = false;
    this.initialDone = false;
    this.groupingDisabled = false;
    this.groupFailureStreak = 0;
    this.pageKey = currentPageKey();
    this.showProgress({ phase: "collecting", total: 0, completed: 0, failed: 0 });

    const nodes = collectTextNodes(document.body);
    if (nodes.length === 0) {
      this.showProgress({ phase: "done", total: 0, completed: 0, failed: 0 });
      return;
    }

    for (const n of nodes) {
      this.nodeMap.set(n.id, n);
      this.processedTextNodes.add(n.node);
      this.originalTexts.set(n.node, n.node.textContent || "");
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
      if (this.wholePage || nodeInViewport(n.node, margin)) {
        visible.push(n);
      } else {
        this.deferred.set(n.id, n);
      }
    }

    // Fallback: if nothing measured as visible (e.g. layout not settled yet on
    // a deep-linked anchor), translate the first screenful rather than nothing.
    let initialNodes = visible;
    if (initialNodes.length === 0) {
      initialNodes = nodes.slice(0, MAX_BATCH_NODES * this.concurrency);
      for (const n of initialNodes) this.deferred.delete(n.id);
    }

    this.showProgress({ phase: "translating", total: initialNodes.length, completed: 0, failed: 0 });

    await this.runPrioritizedBatches(initialNodes);

    if (this.aborted) return;

    this.initialDone = true;
  }

  /**
   * Translate a prioritized set of nodes (the initial viewport pass) with the
   * configured concurrency, driving the main progress bar and finishing with a
   * "done" status.
   */
  private async runPrioritizedBatches(nodes: CollectedNode[]): Promise<void> {
    const total = nodes.length;
    const groups = this.buildGroups(nodes);
    const batches = this.createBatches(groups);
    let completed = 0;
    let failed = 0;

    const queue = [...batches];
    const workers: Promise<void>[] = [];

    for (let i = 0; i < this.concurrency; i++) {
      workers.push(
        (async () => {
          while (queue.length > 0 && this.isActiveOnCurrentPage()) {
            const batch = queue.shift()!;
            const result = await this.translateBatch(batch);
            completed += result.completed;
            failed += result.failed;
            this.showProgress({ phase: "translating", total, completed, failed });
          }
        })()
      );
    }

    await Promise.all(workers);

    if (this.aborted) return;

    this.showProgress({ phase: "done", total, completed, failed });
  }

  /**
   * Translate a set of deferred nodes that just scrolled into view. Uses the
   * subtle scroll hint rather than taking over the main progress bar.
   */
  private async runDeferredBatches(nodes: CollectedNode[]): Promise<void> {
    const groups = this.buildGroups(nodes);
    const batches = this.createBatches(groups);
    const queue = [...batches];
    const workers: Promise<void>[] = [];

    for (let i = 0; i < this.concurrency; i++) {
      workers.push(
        (async () => {
          while (queue.length > 0 && this.isActiveOnCurrentPage()) {
            await this.translateBatch(queue.shift()!);
          }
        })()
      );
    }

    await Promise.all(workers);
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
      if (nodeInViewport(n.node, margin)) {
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
    this.mutationTranslator.stop();
    this.mutationTranslator.reset();
    this.stopScrollDetection();

    for (const [, info] of this.nodeMap) {
      const original = this.originalTexts.get(info.node);
      if (original !== undefined) {
        info.node.textContent = original;
      }
    }

    this.nodeMap.clear();
    this.deferred.clear();
    this.translationCache.clear();
    this.translatedTexts.clear();
    this.processedTextNodes = new WeakSet();
    this.removeProgress();
  }

  abort(): void {
    this.aborted = true;
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

    const allNodes = collectTextNodes(document.body);
    const newNodes: CollectedNode[] = [];

    for (const n of allNodes) {
      // Skip text nodes this translator has already handled.
      if (this.processedTextNodes.has(n.node)) continue;

      const text = n.originalText;
      if (this.translatedTexts.has(text)) {
        this.processedTextNodes.add(n.node);
        this.nodeMap.set(n.id, n);
        continue;
      }

      // Check if this exact text was already translated (same content, different node)
      const cachedTranslation = this.translationCache.get(text);
      if (cachedTranslation) {
        // Same text as something already translated — apply cached translation
        this.processedTextNodes.add(n.node);
        this.applyTranslation(n, cachedTranslation);
        this.nodeMap.set(n.id, n);
        continue;
      }

      // Check if the node's current text looks like it's already translated
      // (i.e., it matches a known translation)
      const currentText = n.node.textContent?.trim() || "";
      if (currentText !== text) {
        // Text was already changed (possibly translated by mutation translator)
        this.processedTextNodes.add(n.node);
        this.nodeMap.set(n.id, n);
        continue;
      }

      // Truly new untranslated node
      newNodes.push(n);
      this.nodeMap.set(n.id, n);
      this.originalTexts.set(n.node, n.node.textContent || "");
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

  /** Record a multi-fragment group whose separator split failed; trip the
   * kill-switch after too many in a row. */
  private noteGroupFailure(): void {
    this.groupFailureStreak++;
    if (this.groupFailureStreak >= GROUP_FAILURE_LIMIT) {
      this.groupingDisabled = true;
    }
  }

  /** Pack block-groups into batches under the char budget and group-count cap. */
  private createBatches(groups: CollectedNode[][]): CollectedNode[][][] {
    const batches: CollectedNode[][][] = [];
    let currentBatch: CollectedNode[][] = [];
    let currentSize = 0;

    for (const group of groups) {
      const groupLen = group.reduce((sum, n) => sum + n.originalText.length, 0);
      const exceedsTextBudget = currentSize + groupLen > this.batchSize;
      const exceedsCountBudget = currentBatch.length >= MAX_BATCH_NODES;
      if ((exceedsTextBudget || exceedsCountBudget) && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentSize = 0;
      }
      currentBatch.push(group);
      currentSize += groupLen;
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
      this.applyTranslation(group[i], segments[i]);
    }
    return true;
  }

  private async translateBatch(batch: CollectedNode[][]): Promise<{ completed: number; failed: number }> {
    if (!this.isActiveOnCurrentPage()) return { completed: 0, failed: 0 };

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
      return { completed, failed: 0 };
    }

    const items = Array.from(uncachedByText, ([text, groups]) => ({ id: groups[0][0].id, text }));
    const uncachedCount = Array.from(uncachedByText.values()).reduce(
      (sum, groups) => sum + groups.reduce((s, g) => s + g.length, 0),
      0
    );

    let retries = 0;

    while (retries <= MAX_RETRIES) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "TRANSLATE_BATCH",
          payload: { items, targetLang: this.targetLang },
        });

        if (!this.isActiveOnCurrentPage()) return { completed, failed: 0 };

        if (response?.success && response.items) {
          let translatedCount = 0;
          const needFallback: CollectedNode[][] = [];

          for (const translated of response.items) {
            const source = items.find((item) => item.id === translated.id);
            if (!source) continue;

            const groups = uncachedByText.get(source.text);
            if (!groups) continue;

            let cachedOnce = false;
            for (const group of groups) {
              if (this.applyGroup(group, translated.text)) {
                if (!cachedOnce) {
                  this.translationCache.set(source.text, translated.text);
                  cachedOnce = true;
                }
                completed += group.length;
                translatedCount += group.length;
                if (group.length > 1) this.groupFailureStreak = 0;
              } else {
                // Separator split didn't line up — retry these nodes one by one.
                needFallback.push(group);
                if (group.length > 1) this.noteGroupFailure();
              }
            }
          }

          for (const group of needFallback) {
            if (!this.isActiveOnCurrentPage()) break;
            const fb = await this.translateBatch(group.map((n) => [n]));
            completed += fb.completed;
            translatedCount += fb.completed;
          }

          const failed = Math.max(0, uncachedCount - translatedCount);
          return { completed, failed };
        } else {
          retries++;
        }
      } catch {
        if (!this.isActiveOnCurrentPage()) return { completed, failed: 0 };
        retries++;
      }
    }

    return { completed, failed: uncachedCount };
  }

  private async translateNodes(nodes: CollectedNode[]): Promise<void> {
    if (!this.isActiveOnCurrentPage()) return;

    const pendingNodes: CollectedNode[] = [];
    for (const node of nodes) {
      if (this.processedTextNodes.has(node.node)) continue;

      this.processedTextNodes.add(node.node);
      this.nodeMap.set(node.id, node);
      if (!this.originalTexts.has(node.node)) {
        this.originalTexts.set(node.node, node.node.textContent || "");
      }

      if (this.translatedTexts.has(node.originalText)) continue;
      pendingNodes.push(node);
    }

    if (pendingNodes.length === 0) return;

    const groups = this.buildGroups(pendingNodes);
    const batches = this.createBatches(groups);
    for (const batch of batches) {
      if (!this.isActiveOnCurrentPage()) return;
      await this.translateBatch(batch);
    }
  }

  private applyTranslation(node: CollectedNode, translated: string): void {
    if (!this.originalTexts.has(node.node)) {
      this.originalTexts.set(node.node, node.node.textContent || "");
    }
    node.node.textContent = translated;
    const translatedText = translated.trim();
    if (translatedText) {
      this.translatedTexts.add(translatedText);
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
        <div>${text}</div>
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

    this.progressEl.className = `${AST_PREFIX}-progress ${AST_PREFIX}-progress-scroll`;
    this.progressEl.innerHTML = `
      <div class="${AST_PREFIX}-spinner"></div>
      <div>${t(this.lang, "page.translating", { done: 0, total: count })}</div>
    `;

    this.scheduleProgressRemoval(2500);
  }

  private isActiveOnCurrentPage(): boolean {
    if (this.aborted) return false;
    if (this.pageKey && this.pageKey !== currentPageKey()) {
      this.abort();
      return false;
    }
    return true;
  }

  private clearProgressHideTimer(): void {
    if (this.progressHideTimer) {
      clearTimeout(this.progressHideTimer);
      this.progressHideTimer = null;
    }
  }

  private scheduleProgressRemoval(ms: number): void {
    this.clearProgressHideTimer();
    this.progressHideTimer = setTimeout(() => this.removeProgress(), ms);
  }

  private removeProgress(): void {
    this.clearProgressHideTimer();
    this.progressEl?.remove();
    this.progressEl = null;
  }
}
