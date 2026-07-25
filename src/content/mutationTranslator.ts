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
      // Record only — the (expensive) collection walk happens once per
      // debounce window in processPending, not synchronously per mutation.
      for (const mutation of mutations) {
        if (mutation.type !== "childList") continue;
        for (const node of mutation.addedNodes) {
          if (
            node.nodeType !== Node.TEXT_NODE &&
            node.nodeType !== Node.ELEMENT_NODE
          ) {
            continue;
          }
          if (!this.processedNodes.has(node)) {
            this.pendingNodes.add(node);
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

    const pending = Array.from(this.pendingNodes);
    this.pendingNodes.clear();

    // Reduce to a minimal set of collection roots: a text node is hosted by
    // its parent, and roots nested inside another pending root collapse into
    // that ancestor — each added subtree gets walked exactly once.
    const rootSet = new Set<HTMLElement>();
    for (const node of pending) {
      if (this.processedNodes.has(node)) continue;
      const el =
        node.nodeType === Node.TEXT_NODE
          ? (node as Text).parentElement
          : (node as HTMLElement);
      if (el && el.isConnected) rootSet.add(el);
    }
    const allRoots = Array.from(rootSet);
    const roots = allRoots.filter(
      (el) => !allRoots.some((other) => other !== el && other.contains(el))
    );

    const collected: CollectedNode[] = [];
    for (const root of roots) {
      collected.push(...collectTextNodes(root, this.collectOptions));
    }

    // A parent walk can sweep up untouched siblings; downstream translation
    // skips targets it has already processed, so those dedupe there.
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
