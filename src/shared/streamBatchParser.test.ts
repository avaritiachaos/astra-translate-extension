import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  StreamBatchItemParser,
  topLevelJsonObjects,
} from "./streamBatchParser.ts";

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

  it("re-emits an id when a later completion has different text (last wins)", () => {
    const p = new StreamBatchItemParser();
    const full = '{"items":[{"id":"x","text":"1"},{"id":"x","text":"2"}]}';
    const items = p.push(full);
    assert.deepEqual(items, [
      { id: "x", text: "1" },
      { id: "x", text: "2" },
    ]);
  });

  it("does not re-emit identical completions", () => {
    const p = new StreamBatchItemParser();
    const full = '{"items":[{"id":"x","text":"1"},{"id":"x","text":"1"}]}';
    assert.deepEqual(p.push(full), [{ id: "x", text: "1" }]);
  });

  it("handles escaped quotes in text", () => {
    const p = new StreamBatchItemParser();
    const items = p.push('{"items":[{"id":"1","text":"say \\"hi\\""}]}');
    assert.equal(items.length, 1);
    assert.equal(items[0].text, 'say "hi"');
  });

  it("survives a delta split inside an escape sequence", () => {
    const p = new StreamBatchItemParser();
    assert.deepEqual(p.push('{"items":[{"id":"1","text":"a\\'), []);
    const items = p.push('"b"}]}');
    assert.deepEqual(items, [{ id: "1", text: 'a"b' }]);
  });

  it("handles braces inside text values", () => {
    const p = new StreamBatchItemParser();
    const items = p.push('{"items":[{"id":"1","text":"用 {x} 和 } 符号"}]}');
    assert.deepEqual(items, [{ id: "1", text: "用 {x} 和 } 符号" }]);
  });

  it("ignores {id,text}-shaped objects outside an items array", () => {
    const p = new StreamBatchItemParser();
    // e.g. the model narrates with a stray object before answering
    const items = p.push(
      '先看这个 {"id":"n1","text":"Hello"} 然后 {"items":[{"id":"n1","text":"你好"}]}'
    );
    assert.deepEqual(items, [{ id: "n1", text: "你好" }]);
  });

  it("echoed input followed by the real answer: real answer re-emitted last", () => {
    const p = new StreamBatchItemParser();
    const echo = '{"targetLang":"zh","items":[{"id":"n1","text":"Hello"}]}';
    const answer = '{"items":[{"id":"n1","text":"你好"}]}';
    const items = p.push(`输入是：${echo}\n翻译结果：${answer}`);
    assert.deepEqual(items, [
      { id: "n1", text: "Hello" },
      { id: "n1", text: "你好" },
    ]);
  });

  it("nested objects inside an item are not separate items", () => {
    const p = new StreamBatchItemParser();
    const items = p.push(
      '{"items":[{"id":"1","text":"ok","meta":{"id":"junk","text":"junk"}}]}'
    );
    assert.deepEqual(items, [{ id: "1", text: "ok" }]);
  });

  it("rejects items with non-string id or text", () => {
    const p = new StreamBatchItemParser();
    const items = p.push(
      '{"items":[{"id":1,"text":"a"},{"id":"b"},{"id":"c","text":"好"}]}'
    );
    assert.deepEqual(items, [{ id: "c", text: "好" }]);
  });

  it("markdown-fenced response still parses", () => {
    const p = new StreamBatchItemParser();
    const items = p.push('```json\n{"items":[{"id":"1","text":"好"}]}\n```');
    assert.deepEqual(items, [{ id: "1", text: "好" }]);
  });

  it("is single-pass: many small deltas still emit correctly", () => {
    const p = new StreamBatchItemParser();
    const full =
      '{"items":[' +
      Array.from({ length: 50 }, (_, i) => `{"id":"n${i}","text":"т${i}"}`).join(",") +
      "]}";
    const out: unknown[] = [];
    for (const ch of full) out.push(...p.push(ch));
    assert.equal(out.length, 50);
    assert.deepEqual(p.finish(), []);
  });
});

describe("topLevelJsonObjects", () => {
  it("returns each balanced top-level object", () => {
    const objs = topLevelJsonObjects('x {"a":1} y {"b":"}"} z');
    assert.deepEqual(objs, ['{"a":1}', '{"b":"}"}']);
  });

  it("finds the answer envelope after an echoed input", () => {
    const raw =
      '输入：{"targetLang":"zh","items":[{"id":"1","text":"Hi"}]}\n' +
      '输出：{"items":[{"id":"1","text":"你好"}]}';
    const objs = topLevelJsonObjects(raw);
    assert.equal(objs.length, 2);
    assert.deepEqual(JSON.parse(objs[1]), { items: [{ id: "1", text: "你好" }] });
  });

  it("an unbalanced prose quote does not swallow the JSON", () => {
    const objs = topLevelJsonObjects('it"s here: {"items":[]}');
    assert.deepEqual(objs, ['{"items":[]}']);
  });
});
