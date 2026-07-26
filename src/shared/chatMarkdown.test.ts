import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseChatMarkdown, parseSpans } from "./chatMarkdown.ts";

describe("parseChatMarkdown", () => {
  it("plain text is a single para block", () => {
    const blocks = parseChatMarkdown("hello\nworld");
    assert.deepEqual(blocks, [
      { type: "para", spans: [{ type: "text", content: "hello\nworld" }] },
    ]);
  });

  it("extracts fenced code blocks with language", () => {
    const blocks = parseChatMarkdown("before\n```py\nprint(1)\n```\nafter");
    assert.equal(blocks.length, 3);
    assert.deepEqual(blocks[1], { type: "codeblock", lang: "py", content: "print(1)" });
    assert.equal(blocks[0].type, "para");
    assert.equal(blocks[2].type, "para");
  });

  it("an unclosed fence still renders as a code block (streaming)", () => {
    const blocks = parseChatMarkdown("text\n```js\nconst a = 1;");
    assert.deepEqual(blocks[1], { type: "codeblock", lang: "js", content: "const a = 1;" });
  });

  it("backticks inside a fence stay literal", () => {
    const blocks = parseChatMarkdown("```\nuse `x` here\n```");
    assert.deepEqual(blocks, [
      { type: "codeblock", lang: "", content: "use `x` here" },
    ]);
  });
});

describe("parseSpans", () => {
  it("splits inline code and bold", () => {
    assert.deepEqual(parseSpans("run `npm i` **now** ok"), [
      { type: "text", content: "run " },
      { type: "code", content: "npm i" },
      { type: "text", content: " " },
      { type: "bold", content: "now" },
      { type: "text", content: " ok" },
    ]);
  });

  it("bold markers inside inline code stay literal", () => {
    assert.deepEqual(parseSpans("`a ** b`"), [{ type: "code", content: "a ** b" }]);
  });

  it("unpaired markers stay literal text", () => {
    assert.deepEqual(parseSpans("2 ** 8 and `tick"), [
      { type: "text", content: "2 ** 8 and `tick" },
    ]);
  });

  it("markers never cross line breaks", () => {
    const spans = parseSpans("**a\nb** and `c\nd`");
    assert.ok(spans.every((s) => s.type === "text"));
  });
});
