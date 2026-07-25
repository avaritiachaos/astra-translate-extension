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
  /** Floor — never go below this. Default 1, clamped to at most `max`. */
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
    // Floor can never exceed the ceiling — a misconfigured min would
    // otherwise let a backoff *raise* concurrency above max.
    this.min = Math.min(this.max, Math.max(1, opts.min ?? 1));
    this.value = this.max;
  }

  /** Current allowed parallel workers / in-flight batches. */
  get current(): number {
    return this.value;
  }

  /**
   * Record the outcome of one batch request.
   * - rate_limit → halve (never below min)
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
 * Classify a batch failure into an adaptive outcome.
 * Prefers the structured provider code carried by the batch response / stream
 * done event; falls back to message-text keywords only for legacy responses
 * without a code.
 */
export function classifyBatchOutcome(
  code?: string,
  error?: string
): BatchOutcome {
  switch (code) {
    case "RATE_LIMIT":
      return "rate_limit";
    case "TIMEOUT":
    case "NETWORK_ERROR":
    case "SERVER_ERROR":
      return "transient";
    case undefined:
    case "":
      return classifyBatchError(error);
    default:
      // AUTH_ERROR / API_KEY_MISSING / PARSE_ERROR / HTTP_ERROR / UNKNOWN …
      return "fail";
  }
}

/**
 * Legacy fallback: classify a batch error message by keywords. The phrases
 * below mirror the actual i18n error strings (zh-CN / en-US / ja-JP) plus
 * browser-native network failures. Never match bare "rate" — common words
 * like "generate" and "moderate" contain it.
 */
export function classifyBatchError(error?: string): BatchOutcome {
  if (!error) return "fail";
  const e = error.toLowerCase();
  if (
    e.includes("rate limit") ||
    e.includes("rate-limit") ||
    e.includes("ratelimit") ||
    e.includes("429") ||
    e.includes("频率") ||
    e.includes("限流") ||
    e.includes("頻度") ||
    e.includes("レート") ||
    e.includes("too many")
  ) {
    return "rate_limit";
  }
  if (
    e.includes("timeout") ||
    e.includes("timed out") ||
    e.includes("network") ||
    e.includes("failed to fetch") ||
    e.includes("503") ||
    e.includes("502") ||
    e.includes("504") ||
    e.includes("unavailable") ||
    e.includes("不可用") ||
    e.includes("超时") ||
    e.includes("网络") ||
    e.includes("タイムアウト") ||
    e.includes("ネットワーク") ||
    e.includes("利用できません")
  ) {
    return "transient";
  }
  return "fail";
}
