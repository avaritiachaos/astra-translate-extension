export const MANGA_HIDDEN_WORK_GRACE_MS = 250;

/** Allow brief reflow/fullscreen transitions, not invisible in-flight pages. */
export class MangaViewportLease {
  private hiddenSince?: number;
  update(working: boolean, visible: boolean, now: number): { cancel: boolean; delay?: number } {
    if (!working || visible) { this.hiddenSince = undefined; return { cancel: false }; }
    this.hiddenSince ??= now;
    const remaining = MANGA_HIDDEN_WORK_GRACE_MS - (now - this.hiddenSince);
    return remaining <= 0 ? { cancel: true } : { cancel: false, delay: remaining };
  }
}

/** Image decode cannot be aborted, but a superseded page must not hold its caller. */
export function whileMangaWanted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(new DOMException("Superseded manga page", "AbortError")); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    // Attach both handlers even if already aborted, so a late decode rejection
    // never becomes an unhandled rejection after the view is disposed.
    work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}
