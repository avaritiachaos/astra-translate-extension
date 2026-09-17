import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MangaAdaptiveConcurrency } from "./mangaAdaptiveConcurrency.ts";

describe("MangaAdaptiveConcurrency", () => {
  it("initializes with configured concurrency", () => {
    const adaptive = new MangaAdaptiveConcurrency({ max: 6, min: 1 });
    assert.equal(adaptive.limit, 6);
    assert.equal(adaptive.canRun(0), true);
    assert.equal(adaptive.canRun(5), true);
    assert.equal(adaptive.canRun(6), false);
  });

  it("halves concurrency and applies cooldown on rate limit", () => {
    const adaptive = new MangaAdaptiveConcurrency({
      max: 6,
      min: 1,
      initialBackoffMs: 2000,
    });
    const now = 10000;
    const delay = adaptive.onRateLimit(undefined, now);
    assert.equal(delay, 2000);
    assert.equal(adaptive.limit, 3);
    assert.equal(adaptive.isCoolingDown(now + 1000), true);
    assert.equal(adaptive.canRun(0, now + 1000), false);
    assert.equal(adaptive.isCoolingDown(now + 2001), false);
    assert.equal(adaptive.canRun(2, now + 2001), true);
    assert.equal(adaptive.canRun(3, now + 2001), false);
  });

  it("honors Retry-After header hint when provided", () => {
    const adaptive = new MangaAdaptiveConcurrency({ max: 4, min: 1 });
    const now = 50000;
    const delay = adaptive.onRateLimit(5000, now);
    assert.equal(delay, 5000);
    assert.equal(adaptive.cooldownRemainingMs(now + 2000), 3000);
  });

  it("climbs back towards max after consecutive successes", () => {
    const adaptive = new MangaAdaptiveConcurrency({
      max: 4,
      min: 1,
      climbAfterSuccesses: 2,
    });
    adaptive.onRateLimit();
    assert.equal(adaptive.limit, 2);

    adaptive.onSuccess();
    assert.equal(adaptive.limit, 2); // 1 success, need 2

    adaptive.onSuccess();
    assert.equal(adaptive.limit, 3); // Climbed to 3!

    adaptive.onSuccess();
    assert.equal(adaptive.limit, 3);

    adaptive.onSuccess();
    assert.equal(adaptive.limit, 4); // Climbed back to max 4!

    adaptive.onSuccess();
    adaptive.onSuccess();
    assert.equal(adaptive.limit, 4); // Never exceeds max
  });

  it("updates max dynamically when user changes settings", () => {
    const adaptive = new MangaAdaptiveConcurrency({ max: 6 });
    assert.equal(adaptive.limit, 6);
    adaptive.setMax(3);
    assert.equal(adaptive.limit, 3);
    adaptive.setMax(8);
    // limit stays 3 until climbed or reset
    adaptive.reset();
    assert.equal(adaptive.limit, 8);
  });
});
