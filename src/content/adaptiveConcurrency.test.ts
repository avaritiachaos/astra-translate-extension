import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AdaptiveConcurrency,
  classifyBatchError,
  classifyBatchOutcome,
} from "./adaptiveConcurrency.ts";

describe("AdaptiveConcurrency", () => {
  it("starts at max", () => {
    const c = new AdaptiveConcurrency({ max: 4 });
    assert.equal(c.current, 4);
  });

  it("clamps a misconfigured min above max", () => {
    const c = new AdaptiveConcurrency({ max: 2, min: 5 });
    assert.equal(c.current, 2);
    c.note("transient");
    // A backoff must never *raise* concurrency above max.
    assert.equal(c.current, 2);
  });

  it("halves on rate limit", () => {
    const c = new AdaptiveConcurrency({ max: 4 });
    c.note("rate_limit");
    assert.equal(c.current, 2);
    c.note("rate_limit");
    assert.equal(c.current, 1);
    c.note("rate_limit");
    assert.equal(c.current, 1);
  });

  it("drops by one on transient errors", () => {
    const c = new AdaptiveConcurrency({ max: 4 });
    c.note("transient");
    assert.equal(c.current, 3);
  });

  it("respects the min floor on transient errors", () => {
    const c = new AdaptiveConcurrency({ max: 4, min: 2 });
    for (let i = 0; i < 5; i++) c.note("transient");
    assert.equal(c.current, 2);
  });

  it("fail leaves concurrency unchanged but resets the streak", () => {
    const c = new AdaptiveConcurrency({ max: 4 });
    c.note("rate_limit"); // → 2
    c.note("success");
    c.note("success");
    c.note("fail"); // streak reset, value unchanged
    assert.equal(c.current, 2);
    c.note("success");
    c.note("success");
    assert.equal(c.current, 2); // streak only 2 — no climb yet
    c.note("success");
    assert.equal(c.current, 3);
  });

  it("climbs back after a success streak", () => {
    const c = new AdaptiveConcurrency({ max: 4 });
    c.note("rate_limit"); // → 2
    c.note("success");
    c.note("success");
    c.note("success"); // streak 3 → climb to 3
    assert.equal(c.current, 3);
  });

  it("needs a fresh streak for each climb step", () => {
    const c = new AdaptiveConcurrency({ max: 4 });
    c.note("rate_limit"); // → 2
    for (let i = 0; i < 3; i++) c.note("success"); // → 3
    assert.equal(c.current, 3);
    c.note("success");
    c.note("success");
    assert.equal(c.current, 3); // only 2 into the next streak
    c.note("success");
    assert.equal(c.current, 4);
  });

  it("does not climb past max", () => {
    const c = new AdaptiveConcurrency({ max: 2 });
    for (let i = 0; i < 20; i++) c.note("success");
    assert.equal(c.current, 2);
  });
});

describe("classifyBatchOutcome (structured code first)", () => {
  it("maps provider codes directly", () => {
    assert.equal(classifyBatchOutcome("RATE_LIMIT"), "rate_limit");
    assert.equal(classifyBatchOutcome("TIMEOUT"), "transient");
    assert.equal(classifyBatchOutcome("NETWORK_ERROR"), "transient");
    assert.equal(classifyBatchOutcome("SERVER_ERROR"), "transient");
    assert.equal(classifyBatchOutcome("AUTH_ERROR"), "fail");
    assert.equal(classifyBatchOutcome("API_KEY_MISSING"), "fail");
    assert.equal(classifyBatchOutcome("PARSE_ERROR"), "fail");
  });

  it("the code wins over a misleading message", () => {
    assert.equal(
      classifyBatchOutcome("AUTH_ERROR", "please retry rate limit"),
      "fail"
    );
  });

  it("falls back to message keywords when no code", () => {
    assert.equal(classifyBatchOutcome(undefined, "Rate limit exceeded"), "rate_limit");
    assert.equal(classifyBatchOutcome("", "网络连接失败"), "transient");
  });
});

describe("classifyBatchError", () => {
  it("detects rate limits across locales", () => {
    assert.equal(classifyBatchError("Rate limit exceeded"), "rate_limit");
    assert.equal(classifyBatchError("请求频率受限，请稍后再试。"), "rate_limit");
    assert.equal(classifyBatchError("リクエスト頻度の制限に達しました。"), "rate_limit");
  });

  it('does not treat words merely containing "rate" as rate limits', () => {
    assert.equal(classifyBatchError("Failed to generate response"), "fail");
    assert.equal(classifyBatchError("content flagged by moderation"), "fail");
    assert.equal(classifyBatchError("corporate proxy rejected"), "fail");
  });

  it("classifies the real localized 5xx / network strings as transient", () => {
    // These mirror i18n error.serverUnavailable / error.network verbatim.
    assert.equal(classifyBatchError("服务商暂时不可用，请稍后再试。"), "transient");
    assert.equal(
      classifyBatchError("翻訳サービスが一時的に利用できません。後でもう一度お試しください。"),
      "transient"
    );
    assert.equal(
      classifyBatchError("ネットワーク接続に失敗しました。ネットワークを確認してください。"),
      "transient"
    );
    assert.equal(classifyBatchError("Failed to fetch"), "transient");
  });

  it("detects transient network/timeout", () => {
    assert.equal(classifyBatchError("Request timed out"), "transient");
    assert.equal(classifyBatchError("网络连接失败"), "transient");
  });

  it("defaults unknown errors to fail", () => {
    assert.equal(classifyBatchError("Invalid JSON"), "fail");
    assert.equal(classifyBatchError(undefined), "fail");
  });
});
