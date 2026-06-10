// ============================================================
// Astra Translate – Mutation Observer Translator
// ============================================================

import type { CollectedNode } from "./textWalker";
import { collectTextNodes } from "./textWalker";
import { debounce } from "../shared/utils";

const DEBOUNCE_MS = 800;

/**
 * Watches for new text nodes added to the page and triggers incremental
 * translation. Used for "real-time" page translation mode.
 */
export class MutationTranslator {
  private observer: MutationObserver | null = null;
  private onNewNodes: (nodes: CollectedNode[]) => void;
  private processedNodes: WeakSet<Node> = new WeakSet();
  private debouncedProcess: () => void;
  private pendingNodes: Set<Node> = new Set();
  private active = false;

  constructor(onNewNodes: (nodes: CollectedNode[]) => void) {
    this.onNewNodes = onNewNodes;
    this.debouncedProcess = debounce(() => this.processPending.bind(this)(), DEBOUNCE_MS);
  }

  /** Start observing DOM mutations. */
  start(): void {
    if (this.active) return;
    this.active = true;

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
              if (!this.processedNodes.has(node)) {
                this.pendingNodes.add(node);
              }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              // Collect text nodes from newly added subtree
              const el = node as HTMLElement;
              const textNodes = collectTextNodes(el);
              for (const tn of textNodes) {
                if (!this.processedNodes.has(tn.node)) {
                  this.pendingNodes.add(tn.node);
                }
              }
            }
          }
        }
      }

      if (this.pendingNodes.size > 0) {
        this.debouncedProcess();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /** Process pending new nodes. */
  private processPending(): void {
    if (this.pendingNodes.size === 0) return;

    const nodes = Array.from(this.pendingNodes);
    this.pendingNodes.clear();

    // Mark as processed
    for (const node of nodes) {
      this.processedNodes.add(node);
    }

    // Collect translatable text from these nodes
    const collected: CollectedNode[] = [];
    for (const node of nodes) {
      if (!node.parentElement) continue;
      const text = (node as Text).textContent?.trim() || "";
      if (!text || text.length < 2) continue;

      collected.push({
        id: Math.random().toString(36).slice(2, 10),
        node: node as Text,
        originalText: text,
      });
    }

    if (collected.length > 0) {
      this.onNewNodes(collected);
    }
  }

  /** Mark a node as already translated so it won't be re-processed. */
  markProcessed(node: Node): void {
    this.processedNodes.add(node);
  }

  /** Stop observing. */
  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.pendingNodes.clear();
    this.active = false;
  }

  /** Check if currently active. */
  isActive(): boolean {
    return this.active;
  }

  /** Reset processed state (for restore). */
  reset(): void {
    this.processedNodes = new WeakSet();
    this.pendingNodes.clear();
  }
}
