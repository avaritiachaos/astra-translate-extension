export interface MangaFailure {
  code?: string;
  message?: string;
  needsSetup?: boolean;
}
export type MangaRecoveryAction = "retry" | "skip" | "settings" | "pause";
const configurationErrors = new Set([
  "MODEL_NOT_FOUND",
  "API_KEY_MISSING",
  "AUTH_ERROR",
  "MANGA_PROVIDER_INVALID",
  "MANGA_FORMAT_UNSUPPORTED",
  "MANGA_ENDPOINT_MISSING",
  "MANGA_SETTINGS_INVALID",
]);
const transientErrors = new Set([
  "TIMEOUT",
  "NETWORK_ERROR",
  "NETWORK",
  "SERVER_ERROR",
  "RATE_LIMIT",
  "CAPTURE_CHANGED",
]);

/** One automatic retry per page; no repeated charges for a stable failed page. */
export class MangaRecoveryBudget {
  private retried = new Set<string>();
  private failed = new Set<string>();
  private consecutive = 0;
  decide(page: string, failure: MangaFailure): MangaRecoveryAction {
    if (failure.needsSetup || configurationErrors.has(failure.code ?? ""))
      return "settings";
    if (transientErrors.has(failure.code ?? "") && !this.retried.has(page)) {
      this.retried.add(page);
      this.trim(this.retried);
      return "retry";
    }
    if (!this.failed.has(page)) {
      this.failed.add(page);
      this.trim(this.failed);
      this.consecutive++;
    }
    return this.consecutive >= 3 ? "pause" : "skip";
  }
  success() {
    this.consecutive = 0;
  }
  reset() {
    this.retried.clear();
    this.failed.clear();
    this.consecutive = 0;
  }
  private trim(set: Set<string>) {
    while (set.size > 120) set.delete(set.values().next().value!);
  }
}
