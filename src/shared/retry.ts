// ============================================================
// Astra Translate – Retry / backoff helpers
// ============================================================

/** Sleep for `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with full jitter.
 * attempt 0 → ~baseMs … 2*baseMs, then doubles each time, capped at maxMs.
 */
export function computeBackoffMs(
  attempt: number,
  opts?: { baseMs?: number; maxMs?: number; retryAfterMs?: number | null }
): number {
  const baseMs = opts?.baseMs ?? 400;
  const maxMs = opts?.maxMs ?? 8000;
  const retryAfter = opts?.retryAfterMs;

  if (retryAfter != null && retryAfter > 0) {
    // Honour server hint, but add a little jitter so parallel retries don't sync.
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(maxMs, retryAfter + jitter);
  }

  const exp = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempt)));
  // Full jitter: uniform in [0, exp]
  return Math.floor(Math.random() * (exp + 1));
}

/**
 * Parse HTTP Retry-After header (seconds or HTTP-date) into milliseconds.
 * Returns null when missing / unparsable.
 */
export function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;

  // Integer seconds
  if (/^\d+$/.test(trimmed)) {
    const sec = parseInt(trimmed, 10);
    if (!Number.isFinite(sec) || sec < 0) return null;
    return sec * 1000;
  }

  // HTTP-date
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - Date.now());
}

/** HTTP statuses that are worth retrying for translation requests. */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}
