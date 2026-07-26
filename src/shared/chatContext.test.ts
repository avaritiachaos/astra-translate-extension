import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatContext,
  renderTurnContent,
  CHAT_MAX_CONTEXT_TURNS,
  type ChatContextTurn,
} from "./chatContext.ts";

function turn(
  role: "user" | "assistant",
  content: string,
  error?: boolean
): ChatContextTurn {
  return error ? { role, content, error } : { role, content };
}

describe("buildChatContext", () => {
  it("returns provider-ready messages oldest-first", () => {
    const ctx = buildChatContext([
      turn("user", "hi"),
      turn("assistant", "hello"),
      turn("user", "how are you"),
    ]);
    assert.deepEqual(ctx, [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "how are you" },
    ]);
  });

  it("strips bookkeeping fields from the output", () => {
    const ctx = buildChatContext([
      { role: "user", content: "q", ...( { ts: 123 } as object) } as ChatContextTurn,
    ]);
    assert.deepEqual(Object.keys(ctx[0]).sort(), ["content", "role"]);
  });

  it("skips error turns entirely", () => {
    const ctx = buildChatContext([
      turn("user", "q1"),
      turn("assistant", "rate limited", true),
      turn("user", "q2"),
    ]);
    assert.deepEqual(
      ctx.map((m) => m.content),
      ["q1", "q2"]
    );
  });

  it("caps the number of turns, keeping the newest", () => {
    const turns: ChatContextTurn[] = [];
    for (let i = 0; i < 10; i++) turns.push(turn("user", `m${i}`));
    const ctx = buildChatContext(turns, { maxTurns: 4 });
    assert.deepEqual(
      ctx.map((m) => m.content),
      ["m6", "m7", "m8", "m9"]
    );
  });

  it("caps total chars, keeping the newest", () => {
    const ctx = buildChatContext(
      [turn("user", "a".repeat(60)), turn("assistant", "b".repeat(60)), turn("user", "c".repeat(60))],
      { maxChars: 130 }
    );
    // 60+60 fits; adding the third 60 would exceed 130.
    assert.deepEqual(
      ctx.map((m) => m.content[0]),
      ["b", "c"]
    );
  });

  it("always includes the newest turn even when oversized", () => {
    const big = "x".repeat(500);
    const ctx = buildChatContext([turn("user", "old"), turn("user", big)], {
      maxChars: 100,
    });
    assert.equal(ctx.length, 1);
    assert.equal(ctx[0].content, big);
  });

  it("uses the default caps when no limits given", () => {
    const turns: ChatContextTurn[] = [];
    for (let i = 0; i < CHAT_MAX_CONTEXT_TURNS + 10; i++) {
      turns.push(turn(i % 2 === 0 ? "user" : "assistant", `t${i}`));
    }
    const ctx = buildChatContext(turns);
    assert.equal(ctx.length, CHAT_MAX_CONTEXT_TURNS);
    assert.equal(ctx[ctx.length - 1].content, `t${turns.length - 1}`);
  });

  it("wraps an attachment around the question for the model", () => {
    const rendered = renderTurnContent({
      role: "user",
      content: "这段讲了什么？",
      attachment: {
        title: "Example Docs",
        url: "https://example.com/docs",
        selected: false,
        text: "Some page body text.",
      },
    });
    assert.ok(rendered.includes("extracted page content"));
    assert.ok(rendered.includes("Example Docs"));
    assert.ok(rendered.includes("https://example.com/docs"));
    assert.ok(rendered.includes("Some page body text."));
    // The question comes after the context block.
    assert.ok(rendered.indexOf("这段讲了什么？") > rendered.indexOf("Some page body text."));
    assert.ok(
      renderTurnContent({
        role: "user",
        content: "q",
        attachment: { title: "", url: "", selected: true, text: "sel" },
      }).includes("selected text")
    );
  });

  it("attachments count toward the char budget at rendered size", () => {
    const attached: ChatContextTurn = {
      role: "user",
      content: "q1",
      attachment: { title: "T", url: "u", selected: false, text: "x".repeat(300) },
    };
    // Rendered size of the attached turn (~350+) blows a 400-char budget once
    // the newest turn (60 chars) is in — so only the newest turn survives.
    const ctx = buildChatContext(
      [attached, turn("assistant", "a".repeat(60)), turn("user", "b".repeat(60))],
      { maxChars: 400 }
    );
    assert.deepEqual(
      ctx.map((m) => m.content[0]),
      ["a", "b"]
    );
  });
});
