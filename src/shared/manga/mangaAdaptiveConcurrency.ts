// ============================================================
// Astra Translate - Adaptive concurrency & rate limit controller for Manga
// ============================================================

export interface MangaAdaptiveConcurrencyOptions {
  /** User-configured ceiling and starting point (1 - 8) */
  max: number;
  /** Floor - never drop below this. Default 1. */
  min?: number;
  /** Initial cooldown backoff in ms. Default 2500ms. */
  initialBackoffMs?: number;
  /** Maximum cooldown backoff in ms. Default 15000ms. */
  maxBackoffMs?: number;
  /** Number of consecutive successes before climbing concurrency. Default 2. */
  climbAfterSuccesses?: number;
}

export class MangaAdaptiveConcurrency {
  max: number;
  readonly min: number;
  private currentConcurrency: number;
  private successes = 0;
  private backoffMs: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly climbAfter: number;
  private cooldownUntil = 0;

  constructor(opts: MangaAdaptiveConcurrencyOptions) {
    this.max = Math.max(1, opts.max | 0);
    this.min = Math.min(this.max, Math.max(1, opts.min ?? 1));
    this.currentConcurrency = this.max;
    this.initialBackoffMs = opts.initialBackoffMs ?? 2500;
    this.maxBackoffMs = opts.maxBackoffMs ?? 15000;
    this.backoffMs = this.initialBackoffMs;
    this.climbAfter = opts.climbAfterSuccesses ?? 2;
  }

  get limit(): number {
    return this.currentConcurrency;
  }

  setMax(newMax: number): void {
    const valid = Math.max(1, newMax | 0);
    this.max = valid;
    this.currentConcurrency = Math.min(this.currentConcurrency, valid);
  }

  isCoolingDown(now = Date.now()): boolean {
    return this.cooldownUntil > now;
  }

  cooldownRemainingMs(now = Date.now()): number {
    return Math.max(0, this.cooldownUntil - now);
  }

  canRun(runningCount: number, now = Date.now()): boolean {
    if (this.isCoolingDown(now)) return false;
    return runningCount < this.currentConcurrency;
  }

  /**
   * Handle rate limit (429):
   * 1. Halve current concurrency down to min.
   * 2. Calculate cooldown delay and set cooldown window.
   * 3. Increase exponential backoff for subsequent hits.
   * @returns delayMs applied for cooldown.
   */
  onRateLimit(retryAfterMs?: number, now = Date.now()): number {
    this.successes = 0;
    this.currentConcurrency = Math.max(this.min, Math.floor(this.currentConcurrency / 2));

    const delay = Number.isFinite(retryAfterMs) && retryAfterMs! > 0
      ? Math.min(this.maxBackoffMs, Math.max(1000, retryAfterMs!))
      : this.backoffMs;

    this.cooldownUntil = now + delay;
    this.backoffMs = Math.min(this.maxBackoffMs, Math.floor(this.backoffMs * 1.5));
    return delay;
  }

  /**
   * Record a successful completion.
   * After a streak of consecutive successes, climb concurrency up towards max.
   */
  onSuccess(): void {
    this.successes += 1;
    if (this.successes >= this.climbAfter && this.currentConcurrency < this.max) {
      this.currentConcurrency += 1;
      this.successes = 0;
    }
    if (this.currentConcurrency >= this.max) {
      this.backoffMs = this.initialBackoffMs;
    }
  }

  reset(): void {
    this.currentConcurrency = this.max;
    this.successes = 0;
    this.backoffMs = this.initialBackoffMs;
    this.cooldownUntil = 0;
  }
}
