import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AdaptiveConcurrency,
  classifyBatchError,
} from "./adaptiveConcurrency.ts";

describe("AdaptiveConcurrency", () => {
  it("starts at max", () => {
    const c = new AdaptiveConcurrency({ max: 4 });
    assert.equal(c.current, 4);
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

  it("climbs back after a success streak", () => {
    const c = new AdaptiveConcurrency({ max: 4 });
    c.note("rate_limit"); // → 2
    c.note("success");
    c.note("success");
    c.note("success"); // streak 3 → climb to 3
    assert.equal(c.current, 3);
  });

  it("does not climb past max", () => {
    const c = new AdaptiveConcurrency({ max: 2 });
    for (let i = 0; i < 20; i++) c.note("success");
    assert.equal(c.current, 2);
  });
});

describe("classifyBatchError", () => {
  it("detects rate limits across locales", () => {
    assert.equal(classifyBatchError("Rate limit exceeded"), "rate_limit");
    assert.equal(classifyBatchError("请求频率受限，请稍后再试。"), "rate_limit");
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
