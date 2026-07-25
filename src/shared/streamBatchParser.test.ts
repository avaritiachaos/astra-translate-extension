import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StreamBatchItemParser } from "./streamBatchParser.ts";

describe("StreamBatchItemParser", () => {
  it("emits items as soon as each object completes", () => {
    const p = new StreamBatchItemParser();
    assert.deepEqual(p.push('{"items":['), []);
    assert.deepEqual(p.push('{"id":"a","text":"你好"}'), [
      { id: "a", text: "你好" },
    ]);
    assert.deepEqual(p.push(',{"id":"b","tex'), []);
    assert.deepEqual(p.push('t":"世界"}]'), [{ id: "b", text: "世界" }]);
    assert.deepEqual(p.finish(), []);
  });

  it("does not re-emit the same id", () => {
    const p = new StreamBatchItemParser();
    const full = '{"items":[{"id":"x","text":"1"},{"id":"x","text":"2"}]}';
    const items = p.push(full);
    assert.equal(items.length, 1);
    assert.equal(items[0].text, "1");
  });

  it("handles escaped quotes in text", () => {
    const p = new StreamBatchItemParser();
    const items = p.push('{"items":[{"id":"1","text":"say \\"hi\\""}]}');
    assert.equal(items.length, 1);
    assert.equal(items[0].text, 'say "hi"');
  });
});
