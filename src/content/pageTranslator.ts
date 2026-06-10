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

const AST_PREFIX = "ast";
const MAX_RETRIES = 1;
const SCROLL_DEBOUNCE_MS = 1500;
const MAX_BATCH_NODES = 8;

function currentPageKey(): string {
  return `${window.location.origin}${window.location.pathname}${window.location.search}`;
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
  private aborted = false;
  private initialDone = false;
  private pageKey = "";
  private statusCallback?: (status: PageTranslateStatus) => void;
  private lang: UiLanguage = "zh-CN";
  private debouncedScrollScan: () => void;
  private onScrollBound: (() => void) | null = null;

  constructor(opts: {
    targetLang: string;
    batchSize?: number;
    concurrency?: number;
    enableRealtime?: boolean;
    lang?: UiLanguage;
    onStatus?: (status: PageTranslateStatus) => void;
  }) {
    this.targetLang = opts.targetLang || "Simplified Chinese";
    this.batchSize = opts.batchSize || 4000;
    this.concurrency = opts.concurrency || 2;
    this.enableRealtime = opts.enableRealtime ?? true;
    this.statusCallback = opts.onStatus;
    this.lang = opts.lang || "zh-CN";

    this.mutationTranslator = new MutationTranslator((nodes) => {
      this.translateNodes(nodes);
    });

    this.debouncedScrollScan = debounce(() => this.scanForNewNodes(), SCROLL_DEBOUNCE_MS);
  }

  async start(): Promise<void> {
    this.aborted = false;
    this.initialDone = false;
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

    this.showProgress({ phase: "translating", total: nodes.length, completed: 0, failed: 0 });

    if (this.enableRealtime) {
      // Start MutationTranslator immediately to catch dynamically added nodes.
      this.mutationTranslator.start();

      // Start scroll-based detection for lazy-loaded content.
      this.startScrollDetection();
    }

    const batches = this.createBatches(nodes);
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
            this.showProgress({
              phase: "translating",
              total: nodes.length,
              completed,
              failed,
            });
          }
        })()
      );
    }

    await Promise.all(workers);

    if (this.aborted) return;

    this.initialDone = true;

    this.showProgress({
      phase: "done",
      total: nodes.length,
      completed,
      failed,
    });
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

  /** Start listening for scroll events to detect lazy-loaded content. */
  private startScrollDetection(): void {
    this.onScrollBound = () => this.debouncedScrollScan();
    window.addEventListener("scroll", this.onScrollBound, { passive: true });
  }

  /** Stop scroll detection. */
  private stopScrollDetection(): void {
    if (this.onScrollBound) {
      window.removeEventListener("scroll", this.onScrollBound);
      this.onScrollBound = null;
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

  private createBatches(nodes: CollectedNode[]): CollectedNode[][] {
    const batches: CollectedNode[][] = [];
    let currentBatch: CollectedNode[] = [];
    let currentSize = 0;

    for (const node of nodes) {
      const textLen = node.originalText.length;
      const exceedsTextBudget = currentSize + textLen > this.batchSize;
      const exceedsNodeBudget = currentBatch.length >= MAX_BATCH_NODES;
      if ((exceedsTextBudget || exceedsNodeBudget) && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentSize = 0;
      }
      currentBatch.push(node);
      currentSize += textLen;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }

  private async translateBatch(batch: CollectedNode[]): Promise<{ completed: number; failed: number }> {
    if (!this.isActiveOnCurrentPage()) return { completed: 0, failed: 0 };

    const uncachedByText: Map<string, CollectedNode[]> = new Map();
    let cachedCount = 0;

    for (const node of batch) {
      const cached = this.translationCache.get(node.originalText);
      if (cached) {
        this.applyTranslation(node, cached);
        cachedCount++;
      } else {
        const existing = uncachedByText.get(node.originalText);
        if (existing) {
          existing.push(node);
        } else {
          uncachedByText.set(node.originalText, [node]);
        }
      }
    }

    if (uncachedByText.size === 0) {
      return { completed: cachedCount, failed: 0 };
    }

    const items = Array.from(uncachedByText, ([text, nodes]) => ({ id: nodes[0].id, text }));
    const uncachedCount = Array.from(uncachedByText.values()).reduce(
      (sum, nodes) => sum + nodes.length,
      0
    );

    let retries = 0;

    while (retries <= MAX_RETRIES) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "TRANSLATE_BATCH",
          payload: { items, targetLang: this.targetLang },
        });

        if (!this.isActiveOnCurrentPage()) return { completed: cachedCount, failed: 0 };

        if (response?.success && response.items) {
          let completed = cachedCount;
          let translatedCount = 0;

          for (const translated of response.items) {
            const source = items.find((item) => item.id === translated.id);
            if (!source) continue;

            const originals = uncachedByText.get(source.text);
            if (originals) {
              this.translationCache.set(source.text, translated.text);
              for (const original of originals) {
                this.applyTranslation(original, translated.text);
                completed++;
                translatedCount++;
              }
            }
          }

          const failed = Math.max(0, uncachedCount - translatedCount);
          return { completed, failed };
        } else {
          retries++;
        }
      } catch {
        if (!this.isActiveOnCurrentPage()) return { completed: cachedCount, failed: 0 };
        retries++;
      }
    }

    return { completed: cachedCount, failed: uncachedCount };
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

    const batches = this.createBatches(pendingNodes);
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
