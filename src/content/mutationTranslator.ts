// ============================================================
// Astra Translate – Mutation Observer Translator
// ============================================================

import type { CollectedNode, TextCollectOptions } from "./textWalker";
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
  private collectOptions: TextCollectOptions;
  private processedNodes: WeakSet<Node> = new WeakSet();
  private debouncedProcess: () => void;
  private pendingNodes: Set<Node> = new Set();
  private active = false;

  constructor(
    onNewNodes: (nodes: CollectedNode[]) => void,
    collectOptions?: TextCollectOptions
  ) {
    this.onNewNodes = onNewNodes;
    this.collectOptions = collectOptions ?? {};
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
              // Collect text nodes (and optional UI attrs) from newly added subtree
              const el = node as HTMLElement;
              const textNodes = collectTextNodes(el, this.collectOptions);
              for (const tn of textNodes) {
                const host =
                  tn.target.type === "text" ? tn.target.node : tn.target.element;
                if (!this.processedNodes.has(host)) {
                  this.pendingNodes.add(host);
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

    // Re-collect properly (text + optional UI attrs) from each host.
    const collected: CollectedNode[] = [];
    const seen = new Set<string>();

    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const textNode = node as Text;
        if (!textNode.parentElement) continue;
        // Collect from parent so we pick up sibling attrs if needed; filter to this text.
        const fromParent = collectTextNodes(
          textNode.parentElement,
          this.collectOptions
        );
        for (const c of fromParent) {
          if (c.target.type === "text" && c.target.node === textNode) {
            if (!seen.has(c.id)) {
              seen.add(c.id);
              collected.push(c);
            }
          }
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (!el.isConnected) continue;
        const fromEl = collectTextNodes(el, this.collectOptions);
        for (const c of fromEl) {
          if (!seen.has(c.id)) {
            seen.add(c.id);
            collected.push(c);
          }
        }
      }
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
