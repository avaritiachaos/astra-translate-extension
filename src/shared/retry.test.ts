import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeBackoffMs,
  isRetryableHttpStatus,
  parseRetryAfterMs,
} from "./retry.ts";

describe("retry helpers", () => {
  it("flags rate-limit and server errors as retryable", () => {
    assert.equal(isRetryableHttpStatus(429), true);
    assert.equal(isRetryableHttpStatus(503), true);
    assert.equal(isRetryableHttpStatus(401), false);
    assert.equal(isRetryableHttpStatus(400), false);
  });

  it("parses Retry-After seconds", () => {
    assert.equal(parseRetryAfterMs("2"), 2000);
    assert.equal(parseRetryAfterMs("0"), 0);
    assert.equal(parseRetryAfterMs(""), null);
    assert.equal(parseRetryAfterMs(null), null);
  });

  it("parses Retry-After HTTP-date", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfterMs(future);
    assert.ok(ms != null && ms > 1000 && ms < 10000);
  });

  it("honours retryAfterMs over exponential base", () => {
    const ms = computeBackoffMs(0, { retryAfterMs: 1500, maxMs: 8000 });
    assert.ok(ms >= 1500 && ms < 2000);
  });

  it("honours a server Retry-After longer than the generic backoff cap", () => {
    // A 30s server hint must NOT be clamped down to the 8s exponential cap —
    // that retry would land back inside the rate-limit window.
    const ms = computeBackoffMs(0, { retryAfterMs: 30_000, maxMs: 8000 });
    assert.ok(ms >= 30_000 && ms < 30_500);
  });

  it("caps absurd Retry-After hints at retryAfterCapMs", () => {
    const ms = computeBackoffMs(0, { retryAfterMs: 10 * 60_000, maxMs: 8000 });
    assert.ok(ms <= 60_000);
    const custom = computeBackoffMs(0, {
      retryAfterMs: 10 * 60_000,
      retryAfterCapMs: 5000,
    });
    assert.equal(custom, 5000);
  });

  it("never returns a zero-delay tight retry", () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      for (let i = 0; i < 50; i++) {
        const ms = computeBackoffMs(attempt, { baseMs: 400, maxMs: 8000 });
        assert.ok(ms >= 200, `attempt ${attempt} produced ${ms}ms`);
      }
    }
  });

  it("ignores invalid Retry-After header values", () => {
    assert.equal(parseRetryAfterMs("abc"), null);
    // Decimal seconds are nonstandard but must not be misread as a date.
    assert.equal(parseRetryAfterMs("1.5"), 1500);
    // A date in the past means "retry now", not an error.
    const past = new Date(Date.now() - 5000).toUTCString();
    assert.equal(parseRetryAfterMs(past), 0);
  });

  it("treats Cloudflare 52x as retryable but 501 as permanent", () => {
    assert.equal(isRetryableHttpStatus(520), true);
    assert.equal(isRetryableHttpStatus(524), true);
    assert.equal(isRetryableHttpStatus(501), false);
  });

  it("caps exponential backoff", () => {
    const ms = computeBackoffMs(20, { baseMs: 400, maxMs: 1000, retryAfterMs: null });
    assert.ok(ms >= 0 && ms <= 1000);
  });
});
