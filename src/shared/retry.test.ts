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

  it("caps exponential backoff", () => {
    const ms = computeBackoffMs(20, { baseMs: 400, maxMs: 1000, retryAfterMs: null });
    assert.ok(ms >= 0 && ms <= 1000);
  });
});
