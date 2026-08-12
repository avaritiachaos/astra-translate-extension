import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPrivatePageElement } from "./pageExtract.ts";

describe("page-context privacy boundary", () => {
  it("excludes all form controls, including password inputs", () => {
    for (const tagName of ["input", "textarea", "select", "option"]) {
      assert.equal(isPrivatePageElement({ tagName }), true, tagName);
    }
  });

  it("excludes contenteditable regions", () => {
    assert.equal(
      isPrivatePageElement({ tagName: "div", isContentEditable: true }),
      true
    );
  });

  it("keeps ordinary article elements eligible", () => {
    assert.equal(isPrivatePageElement({ tagName: "article" }), false);
    assert.equal(isPrivatePageElement({ tagName: "p" }), false);
  });
});
