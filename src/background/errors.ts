// ============================================================
// Astra Translate – Error Handling
// ============================================================

import { t, type UiLanguage } from "../shared/i18n";

export class AstraError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "AstraError";
    this.code = code;
  }
}

export class ApiKeyMissingError extends AstraError {
  constructor(lang: UiLanguage = "zh-CN") {
    super(t(lang, "error.apiKeyNotConfigured"), "API_KEY_MISSING");
  }
}

export class ProviderRequestError extends AstraError {
  statusCode?: number;
  /** When true, callers may safely retry (rate limit / transient server / network). */
  retryable: boolean;
  constructor(
    message: string,
    code: string,
    statusCode?: number,
    retryable = false
  ) {
    super(message, code);
    this.name = "ProviderRequestError";
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

/** True for transient failures where another attempt is likely to succeed. */
export function isRetryableProviderError(err: unknown): boolean {
  if (err instanceof ProviderRequestError) return err.retryable;
  return false;
}

/**
 * Map an HTTP status code to a user-friendly error using i18n.
 */
export function mapHttpError(status: number, lang: UiLanguage = "zh-CN"): ProviderRequestError {
  switch (true) {
    case status === 401 || status === 403:
      return new ProviderRequestError(t(lang, "error.unauthorized"), "AUTH_ERROR", status, false);
    case status === 408:
      return new ProviderRequestError(t(lang, "error.timeout"), "TIMEOUT", status, true);
    case status === 429:
      return new ProviderRequestError(t(lang, "error.rateLimit"), "RATE_LIMIT", status, true);
    case status >= 500:
      return new ProviderRequestError(t(lang, "error.serverUnavailable"), "SERVER_ERROR", status, true);
    default:
      return new ProviderRequestError(t(lang, "error.httpError", { status }), "HTTP_ERROR", status, false);
  }
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && /fetch/i.test(err.message);
}
