import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sliceForRegenerate, type RegenerateTurn } from "./chatRegenerate.ts";

function turn(
  role: "user" | "assistant",
  content: string,
  extra?: Partial<RegenerateTurn>
): RegenerateTurn {
  return { role, content, ...extra };
}

describe("sliceForRegenerate", () => {
  it("drops the trailing assistant reply and returns the question", () => {
    const result = sliceForRegenerate([
      turn("user", "q1"),
      turn("assistant", "a1"),
      turn("user", "q2"),
      turn("assistant", "a2"),
    ]);
    assert.ok(result);
    assert.equal(result.source.content, "q2");
    assert.deepEqual(
      result.turns.map((t) => t.content),
      ["q1", "a1", "q2"]
    );
  });

  it("regenerates over a failed reply too", () => {
    const result = sliceForRegenerate([
      turn("user", "q"),
      turn("assistant", "rate limited", { error: true }),
    ]);
    assert.ok(result);
    assert.equal(result.source.content, "q");
    assert.equal(result.turns.length, 1);
  });

  it("preserves attachment and web-search flags of the reused question", () => {
    const attachment = { title: "T", url: "u", selected: false, text: "body" };
    const result = sliceForRegenerate([
      turn("user", "q", { attachment, webSearch: true }),
      turn("assistant", "a"),
    ]);
    assert.ok(result);
    assert.equal(result.source.attachment, attachment);
    assert.equal(result.source.webSearch, true);
  });

  it("regenerates a question whose reply never arrived", () => {
    const result = sliceForRegenerate([turn("user", "q1"), turn("assistant", "a1"), turn("user", "q2")]);
    assert.ok(result);
    assert.equal(result.source.content, "q2");
    assert.deepEqual(
      result.turns.map((t) => t.content),
      ["q1", "a1", "q2"]
    );
  });

  it("walks back over several trailing assistant turns", () => {
    const result = sliceForRegenerate([
      turn("user", "q"),
      turn("assistant", "a1"),
      turn("assistant", "a2"),
    ]);
    assert.ok(result);
    assert.equal(result.source.content, "q");
    assert.deepEqual(
      result.turns.map((t) => t.content),
      ["q"]
    );
  });

  it("returns null when there is nothing to regenerate", () => {
    assert.equal(sliceForRegenerate([]), null);
    assert.equal(sliceForRegenerate([turn("assistant", "orphan")]), null);
  });

  it("does not mutate the input", () => {
    const turns = [turn("user", "q"), turn("assistant", "a")];
    sliceForRegenerate(turns);
    assert.equal(turns.length, 2);
  });
});
