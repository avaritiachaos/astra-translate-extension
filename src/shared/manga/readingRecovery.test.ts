import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MangaRecoveryBudget } from "./readingRecovery.ts";

describe("bounded manga automatic recovery", () => {
  it("retries one transient error, then skips that page without a retry loop", () => {
    const budget = new MangaRecoveryBudget();
    assert.equal(budget.decide("a", { code: "NETWORK_ERROR" }), "retry");
    for (let n = 0; n < 5; n++)
      assert.equal(budget.decide("a", { code: "NETWORK_ERROR" }), "skip");
  });
  it("distinguishes a new page from a repeated failure on the same page", () => {
    const budget = new MangaRecoveryBudget();
    assert.equal(budget.decide("a", { code: "MANGA_INVALID_RESULT" }), "skip");
    assert.equal(budget.decide("a", { code: "MANGA_INVALID_RESULT" }), "skip");
    assert.equal(budget.decide("b", { code: "MANGA_INVALID_RESULT" }), "skip");
    assert.equal(budget.decide("c", { code: "MANGA_INVALID_RESULT" }), "pause");
  });
  it("clears consecutive page failures after a successful page", () => {
    const budget = new MangaRecoveryBudget();
    budget.decide("a", {});
    budget.decide("b", {});
    budget.success();
    assert.equal(budget.decide("c", {}), "skip");
    assert.equal(budget.decide("d", {}), "skip");
    assert.equal(budget.decide("e", {}), "pause");
  });
  it("does not silently retry model or credential errors", () => {
    for (const code of [
      "API_KEY_MISSING",
      "AUTH_ERROR",
      "MODEL_NOT_FOUND",
      "MANGA_SETTINGS_INVALID",
      "MANGA_ENDPOINT_MISSING",
    ]) {
      assert.equal(new MangaRecoveryBudget().decide("a", { code }), "settings");
    }
    assert.equal(
      new MangaRecoveryBudget().decide("a", { needsSetup: true }),
      "settings",
    );
  });
  it("recognizes transient transport and screenshot errors but not invalid content", () => {
    for (const code of [
      "TIMEOUT",
      "NETWORK_ERROR",
      "SERVER_ERROR",
      "RATE_LIMIT",
      "CAPTURE_CHANGED",
    ])
      assert.equal(new MangaRecoveryBudget().decide(code, { code }), "retry");
    for (const code of [
      "MANGA_INVALID_RESULT",
      "MANGA_TOO_LARGE",
      "MANGA_VISION_FAILED",
      "HTTP_ERROR",
    ])
      assert.equal(new MangaRecoveryBudget().decide(code, { code }), "skip");
  });
  it("only resets attempt history after an explicit reading session change", () => {
    const budget = new MangaRecoveryBudget();
    budget.decide("a", { code: "TIMEOUT" });
    budget.success();
    assert.equal(budget.decide("a", { code: "TIMEOUT" }), "skip");
    budget.reset();
    assert.equal(budget.decide("a", { code: "TIMEOUT" }), "retry");
  });
});
