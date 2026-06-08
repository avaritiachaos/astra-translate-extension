// ============================================================
// Astra Translate – Page Translator
// ============================================================

import type { CollectedNode } from "./textWalker";
import type { PageTranslateStatus } from "../shared/types";
import { collectTextNodes } from "./textWalker";
import { MutationTranslator } from "./mutationTranslator";
import { injectThemeVars } from "./selectionBubble";
import { t, type UiLanguage } from "../shared/i18n";

const AST_PREFIX = "ast";
const MAX_RETRIES = 1;

export class PageTranslator {
  private nodeMap: Map<string, CollectedNode> = new Map();
  private translationCache: Map<string, string> = new Map();
  private originalTexts: WeakMap<Text, string> = new WeakMap();
  private progressEl: HTMLElement | null = null;
  private mutationTranslator: MutationTranslator;
  private targetLang: string;
  private batchSize: number;
  private concurrency: number;
  private aborted = false;
  private statusCallback?: (status: PageTranslateStatus) => void;
  private lang: UiLanguage = "zh-CN";

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
  }

  async start(): Promise<void> {
    this.aborted = false;
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

    this.mutationTranslator.start();

    this.showProgress({
      phase: "done",
      total: nodes.length,
      completed,
      failed,
    });
  }

  restore(): void {
    this.aborted = true;
    this.mutationTranslator.stop();
    this.mutationTranslator.reset();

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
    this.removeProgress();
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

  private removeProgress(): void {
    this.progressEl?.remove();
    this.progressEl = null;
  }
}
