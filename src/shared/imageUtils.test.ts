import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateScaledDimensions,
  formatByteSize,
} from "./imageUtils.ts";

describe("imageUtils - calculateScaledDimensions", () => {
  it("leaves dimensions unchanged when smaller than maxDim", () => {
    const res = calculateScaledDimensions(800, 600, 1568);
    assert.deepEqual(res, { width: 800, height: 600 });
  });

  it("scales down width-dominated landscape images proportionally", () => {
    const res = calculateScaledDimensions(3136, 1568, 1568);
    assert.deepEqual(res, { width: 1568, height: 784 });
  });

  it("scales down height-dominated portrait images proportionally", () => {
    const res = calculateScaledDimensions(1000, 3000, 1500);
    assert.deepEqual(res, { width: 500, height: 1500 });
  });

  it("handles square images", () => {
    const res = calculateScaledDimensions(2000, 2000, 1000);
    assert.deepEqual(res, { width: 1000, height: 1000 });
  });

  it("handles non-positive dimensions gracefully", () => {
    const res = calculateScaledDimensions(0, 0, 1568);
    assert.deepEqual(res, { width: 1568, height: 1568 });
  });
});

describe("imageUtils - formatByteSize", () => {
  it("formats bytes, kilobytes, megabytes", () => {
    assert.equal(formatByteSize(500), "500 B");
    assert.equal(formatByteSize(2048), "2 KB");
    assert.equal(formatByteSize(1024 * 1024 * 1.5), "1.5 MB");
  });
});
