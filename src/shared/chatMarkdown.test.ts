import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseChatMarkdown, parseSpans, replaceLatexSymbols } from "./chatMarkdown.ts";

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

  it("converts latex arrow and comparison symbols in text", () => {
    const spans = parseSpans("短（みじかい / mijikai） $\\rightarrow$ 谐音：“密集的卡”");
    assert.deepEqual(spans, [
      { type: "text", content: "短（みじかい / mijikai） → 谐音：“密集的卡”" },
    ]);
  });

  it("converts bare \\rightarrow and math symbols", () => {
    const spans = parseSpans("A \\rightarrow B and x \\le y \\approx z");
    assert.deepEqual(spans, [
      { type: "text", content: "A → B and x ≤ y ≈ z" },
    ]);
  });

  it("converts latex symbols inside bold", () => {
    const spans = parseSpans("**A $\\rightarrow$ B**");
    assert.deepEqual(spans, [
      { type: "bold", content: "A → B" },
    ]);
  });

  it("never converts latex symbols inside inline code", () => {
    const spans = parseSpans("use `$\\rightarrow$` command");
    assert.deepEqual(spans, [
      { type: "text", content: "use " },
      { type: "code", content: "$\\rightarrow$" },
      { type: "text", content: " command" },
    ]);
  });

  it("preserves currency dollar signs without mangling", () => {
    const spans = parseSpans("Price is $100 or $200");
    assert.deepEqual(spans, [
      { type: "text", content: "Price is $100 or $200" },
    ]);
  });

  it("preserves Windows paths without mangling", () => {
    assert.equal(replaceLatexSymbols("C:\\to\\file"), "C:\\to\\file");
  });
});
