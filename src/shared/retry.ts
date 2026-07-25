// ============================================================
// Astra Translate – Retry / backoff helpers
// ============================================================

/** Sleep for `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with equal jitter.
 * attempt 0 → ~baseMs/2 … baseMs, then doubles each time, capped at maxMs.
 * A server-provided Retry-After is honoured up to its own (larger) cap —
 * it must not be clamped down to the generic backoff ceiling, otherwise
 * every retry lands back inside the server's rate-limit window.
 */
export function computeBackoffMs(
  attempt: number,
  opts?: {
    baseMs?: number;
    maxMs?: number;
    retryAfterMs?: number | null;
    /** Ceiling for server Retry-After hints (default 60s). */
    retryAfterCapMs?: number;
  }
): number {
  const baseMs = opts?.baseMs ?? 400;
  const maxMs = opts?.maxMs ?? 8000;
  const retryAfterCapMs = opts?.retryAfterCapMs ?? 60_000;
  const retryAfter = opts?.retryAfterMs;

  if (retryAfter != null && retryAfter > 0) {
    // Honour server hint, but add a little jitter so parallel retries don't sync.
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(retryAfterCapMs, retryAfter + jitter);
  }

  const exp = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempt)));
  // Equal jitter: uniform in [exp/2, exp] — never a zero-delay tight retry.
  const half = exp / 2;
  return Math.floor(half + Math.random() * half);
}

/**
 * Parse HTTP Retry-After header (seconds or HTTP-date) into milliseconds.
 * Returns null when missing / unparsable.
 */
export function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;

  // Integer or decimal seconds. Decimal is nonstandard but seen in the wild —
  // and must not fall through to Date.parse, which reads "1.5" as a date.
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const sec = Number(trimmed);
    if (!Number.isFinite(sec) || sec < 0) return null;
    return Math.round(sec * 1000);
  }

  // HTTP-date
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - Date.now());
}

/** HTTP statuses that are worth retrying for translation requests.
 * Includes the Cloudflare 52x gateway range (transient in practice);
 * excludes permanent errors like 501 Not Implemented. */
export function isRetryableHttpStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    (status >= 520 && status <= 529)
  );
}
