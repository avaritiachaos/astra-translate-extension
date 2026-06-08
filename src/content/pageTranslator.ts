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

export class PageTranslator {
  private nodeMap: Map<string, CollectedNode> = new Map();
  private translationCache: Map<string, string> = new Map();
  private originalTexts: WeakMap<Text, string> = new WeakMap();
  private progressEl: HTMLElement | null = null;
  private scrollHintEl: HTMLElement | null = null;
  private scrollHintTimer: ReturnType<typeof setTimeout> | null = null;
  private mutationTranslator: MutationTranslator;
  private targetLang: string;
  private batchSize: number;
  private concurrency: number;
  private aborted = false;
  private initialDone = false;
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
    this.showProgress({ phase: "collecting", total: 0, completed: 0, failed: 0 });

    const nodes = collectTextNodes(document.body);
    if (nodes.length === 0) {
      this.showProgress({ phase: "done", total: 0, completed: 0, failed: 0 });
      return;
    }

    for (const n of nodes) {
      this.nodeMap.set(n.id, n);
      this.originalTexts.set(n.node, n.node.textContent || "");
    }

    this.showProgress({ phase: "translating", total: nodes.length, completed: 0, failed: 0 });

    // Start MutationTranslator immediately to catch dynamically added nodes
    this.mutationTranslator.start();

    // Start scroll-based detection for lazy-loaded content
    this.startScrollDetection();

    const batches = this.createBatches(nodes);
    let completed = 0;
    let failed = 0;

    const queue = [...batches];
    const workers: Promise<void>[] = [];

    for (let i = 0; i < this.concurrency; i++) {
      workers.push(
        (async () => {
          while (queue.length > 0 && !this.aborted) {
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
    if (this.aborted) return;

    const allNodes = collectTextNodes(document.body);
    const newNodes: CollectedNode[] = [];

    for (const n of allNodes) {
      // Skip nodes we already know about
      if (this.nodeMap.has(n.id)) continue;

      const text = n.originalText;
      // Check if this exact text was already translated (same content, different node)
      const cachedTranslation = this.translationCache.get(text);
      if (cachedTranslation) {
        // Same text as something already translated — apply cached translation
        this.originalTexts.set(n.node, n.node.textContent || "");
        n.node.textContent = cachedTranslation;
        this.nodeMap.set(n.id, n);
        continue;
      }

      // Check if the node's current text looks like it's already translated
      // (i.e., it matches a known translation)
      const currentText = n.node.textContent?.trim() || "";
      if (currentText !== text) {
        // Text was already changed (possibly translated by mutation translator)
        this.nodeMap.set(n.id, n);
        continue;
      }

      // Truly new untranslated node
      newNodes.push(n);
      this.nodeMap.set(n.id, n);
      this.originalTexts.set(n.node, n.node.textContent || "");
    }

    if (newNodes.length > 0) {
      this.showScrollHint(newNodes.length);
      this.translateNodes(newNodes);
    }
  }

  private createBatches(nodes: CollectedNode[]): CollectedNode[][] {
    const batches: CollectedNode[][] = [];
    let currentBatch: CollectedNode[] = [];
    let currentSize = 0;

    for (const node of nodes) {
      const textLen = node.originalText.length;
      if (currentSize + textLen > this.batchSize && currentBatch.length > 0) {
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
    const uncached: CollectedNode[] = [];
    let cachedCount = 0;

    for (const node of batch) {
      const cached = this.translationCache.get(node.originalText);
      if (cached) {
        this.applyTranslation(node, cached);
        cachedCount++;
      } else {
        uncached.push(node);
      }
    }

    if (uncached.length === 0) {
      return { completed: cachedCount, failed: 0 };
    }

    const items = uncached.map((n) => ({ id: n.id, text: n.originalText }));

    let retries = 0;

    while (retries <= MAX_RETRIES) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "TRANSLATE_BATCH",
          payload: { items, targetLang: this.targetLang },
        });

        if (response?.success && response.items) {
          let completed = cachedCount;
          let failed = 0;

          for (const translated of response.items) {
            const original = batch.find((n) => n.id === translated.id);
            if (original) {
              this.translationCache.set(original.originalText, translated.text);
              this.applyTranslation(original, translated.text);
              completed++;
            }
          }

          return { completed, failed };
        } else {
          retries++;
        }
      } catch {
        retries++;
      }
    }

    return { completed: cachedCount, failed: uncached.length };
  }

  private async translateNodes(nodes: CollectedNode[]): Promise<void> {
    const batches = this.createBatches(nodes);
    for (const batch of batches) {
      if (this.aborted) return;
      await this.translateBatch(batch);
    }
  }

  private applyTranslation(node: CollectedNode, translated: string): void {
    if (!this.originalTexts.has(node.node)) {
      this.originalTexts.set(node.node, node.node.textContent || "");
    }
    node.node.textContent = translated;
  }

  private showProgress(status: PageTranslateStatus): void {
    this.statusCallback?.(status);

    if (!this.progressEl) {
      injectThemeVars();
      this.progressEl = document.createElement("div");
      this.progressEl.className = `${AST_PREFIX}-progress`;
      document.body.appendChild(this.progressEl);
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
        setTimeout(() => this.removeProgress(), 3000);
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
    if (!this.scrollHintEl) {
      injectThemeVars();
      this.scrollHintEl = document.createElement("div");
      this.scrollHintEl.className = `${AST_PREFIX}-scroll-hint`;
      document.body.appendChild(this.scrollHintEl);
    }

    this.scrollHintEl.textContent = `⟳ ${t(this.lang, "page.translating", { done: 0, total: count })}`;
    this.scrollHintEl.style.opacity = "1";

    if (this.scrollHintTimer) clearTimeout(this.scrollHintTimer);
    this.scrollHintTimer = setTimeout(() => {
      if (this.scrollHintEl) {
        this.scrollHintEl.style.opacity = "0";
        setTimeout(() => {
          this.scrollHintEl?.remove();
          this.scrollHintEl = null;
        }, 400);
      }
    }, 2500);
  }

  private removeProgress(): void {
    this.progressEl?.remove();
    this.progressEl = null;
    if (this.scrollHintTimer) clearTimeout(this.scrollHintTimer);
    this.scrollHintEl?.remove();
    this.scrollHintEl = null;
  }
}
