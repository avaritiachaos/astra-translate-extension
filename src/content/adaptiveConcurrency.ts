// ============================================================
// Astra Translate – Adaptive concurrency for page translation
// ============================================================
// Starts at the user-configured max, backs off on rate-limit /
// transient failures, and slowly climbs back after a streak of wins.
// (No shared imports — unit-testable under Node's strip-types runner.)

export type BatchOutcome = "success" | "rate_limit" | "transient" | "fail";

export interface AdaptiveConcurrencyOptions {
  /** User-configured ceiling (and starting point). */
  max: number;
  /** Floor — never go below this. Default 1. */
  min?: number;
}

/**
 * Mutable concurrency controller shared by page-translation workers.
 * Thread-safe enough for single-threaded JS: workers read `current` before
 * each task; outcomes update the shared counter between tasks.
 */
export class AdaptiveConcurrency {
  readonly max: number;
  readonly min: number;
  private value: number;
  private successStreak = 0;
  /** Consecutive successes needed before we try climbing again. */
  private readonly climbAfter = 3;

  constructor(opts: AdaptiveConcurrencyOptions) {
    this.max = Math.max(1, opts.max | 0);
    this.min = Math.max(1, opts.min ?? 1);
    this.value = Math.min(this.max, Math.max(this.min, this.max));
  }

  /** Current allowed parallel workers / in-flight batches. */
  get current(): number {
    return this.value;
  }

  /**
   * Record the outcome of one batch request.
   * - rate_limit → hard drop to min (or half, at least min)
   * - transient  → soft drop by 1
   * - success    → after a streak, climb by 1 toward max
   * - fail       → no concurrency change (content/model error)
   */
  note(outcome: BatchOutcome): void {
    switch (outcome) {
      case "rate_limit":
        this.successStreak = 0;
        // Aggressive cut: rate limits mean we're over budget.
        this.value = Math.max(this.min, Math.floor(this.value / 2));
        break;
      case "transient":
        this.successStreak = 0;
        this.value = Math.max(this.min, this.value - 1);
        break;
      case "success":
        this.successStreak += 1;
        if (this.successStreak >= this.climbAfter && this.value < this.max) {
          this.value += 1;
          this.successStreak = 0;
        }
        break;
      case "fail":
        // Permanent-ish failure for this batch — leave concurrency alone.
        this.successStreak = 0;
        break;
    }
  }
}

/**
 * Classify a batch response error string into an adaptive outcome.
 * Content-script side only sees the message text from the service worker.
 */
export function classifyBatchError(error?: string): BatchOutcome {
  if (!error) return "fail";
  const e = error.toLowerCase();
  if (
    e.includes("rate") ||
    e.includes("429") ||
    e.includes("频率") ||
    e.includes("頻度") ||
    e.includes("too many")
  ) {
    return "rate_limit";
  }
  if (
    e.includes("timeout") ||
    e.includes("timed out") ||
    e.includes("network") ||
    e.includes("503") ||
    e.includes("502") ||
    e.includes("504") ||
    e.includes("unavailable") ||
    e.includes("超时") ||
    e.includes("网络") ||
    e.includes("タイムアウト")
  ) {
    return "transient";
  }
  return "fail";
}
