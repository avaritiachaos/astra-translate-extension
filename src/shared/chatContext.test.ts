import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatContext,
  renderTurnContent,
  hasHistoricalImages,
  getAntiHallucinationNotice,
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
      ctx.map((m) => (typeof m.content === "string" ? m.content[0] : "")),
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
    assert.ok(rendered.indexOf("这段讲了什么？") > rendered.indexOf("Some page body text."));
  });

  it("attachments count toward the char budget at rendered size", () => {
    const attached: ChatContextTurn = {
      role: "user",
      content: "q1",
      attachment: { title: "T", url: "u", selected: false, text: "x".repeat(300) },
    };
    const ctx = buildChatContext(
      [attached, turn("assistant", "a".repeat(60)), turn("user", "b".repeat(60))],
      { maxChars: 400 }
    );
    assert.deepEqual(
      ctx.map((m) => (typeof m.content === "string" ? m.content[0] : "")),
      ["a", "b"]
    );
  });

  it("wraps web search sources around the question for the model", () => {
    const rendered = renderTurnContent({
      role: "user",
      content: "DeepSeek 现在怎么定价？",
      searchSources: [
        {
          title: "DeepSeek Pricing",
          url: "https://example.com/pricing",
          snippet: "flash is $0.14 / M tokens",
        },
      ],
    });
    assert.ok(rendered.includes("Web search results"));
    assert.ok(rendered.includes("[1] DeepSeek Pricing"));
    assert.ok(rendered.includes("https://example.com/pricing"));
    assert.ok(rendered.includes("flash is $0.14"));
  });

  it("combines page attachment and search sources", () => {
    const rendered = renderTurnContent({
      role: "user",
      content: "总结一下",
      attachment: {
        title: "Docs",
        url: "https://example.com",
        selected: false,
        text: "page body",
      },
      searchSources: [
        { title: "News", url: "https://news.example", snippet: "latest" },
      ],
    });
    assert.ok(rendered.includes("extracted page content"));
    assert.ok(rendered.includes("Web search results"));
    assert.ok(rendered.includes("page body"));
    assert.ok(rendered.includes("News"));
  });
});

describe("buildChatContext - Multimodal & Anti-Hallucination", () => {
  const sampleImg1 = {
    id: "img1",
    mimeType: "image/jpeg",
    dataUrl: "data:image/jpeg;base64,ABC123SAMPLE",
    name: "screenshot.jpg",
    width: 1920,
    height: 1080,
  };

  const sampleImg2 = {
    id: "img2",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,XYZ789SAMPLE",
    name: "chart.png",
    width: 800,
    height: 600,
  };

  it("formats image turn as ChatContentPart[] for vision models", () => {
    const turns: ChatContextTurn[] = [
      {
        role: "user",
        content: "请帮我分析这张图",
        images: [sampleImg1],
      },
    ];

    const ctx = buildChatContext(turns, { isVisionModel: true });
    assert.equal(ctx.length, 1);
    assert.equal(Array.isArray(ctx[0].content), true);

    const parts = ctx[0].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    assert.equal(parts[0].type, "text");
    assert.equal(parts[0].text, "请帮我分析这张图");
    assert.equal(parts[1].type, "image_url");
    assert.equal(parts[1].image_url?.url, "data:image/jpeg;base64,ABC123SAMPLE");
  });

  it("degrades images into text placeholders for text-only models (e.g. DeepSeek)", () => {
    const turns: ChatContextTurn[] = [
      {
        role: "user",
        content: "这是报错截图",
        images: [sampleImg1],
      },
    ];

    const ctx = buildChatContext(turns, { isVisionModel: false });
    assert.equal(ctx.length, 1);
    assert.equal(typeof ctx[0].content, "string");
    assert.ok(ctx[0].content.includes("[User attached image 1 \"screenshot.jpg\" (1920x1080)]"));
    assert.ok(ctx[0].content.includes("这是报错截图"));
  });

  it("applies vision sliding window (retains latest 2 turns raw, degrades older turns)", () => {
    const turns: ChatContextTurn[] = [
      // Turn 1 (Oldest with image) -> should degrade to text placeholder
      { role: "user", content: "第一张图", images: [sampleImg1] },
      { role: "assistant", content: "这是图1的解答" },
      // Turn 2 (with image) -> should stay raw image_url
      { role: "user", content: "第二张图", images: [sampleImg2] },
      { role: "assistant", content: "这是图2的解答" },
      // Turn 3 (Newest with image) -> should stay raw image_url
      { role: "user", content: "第三张图", images: [sampleImg1] },
    ];

    const ctx = buildChatContext(turns, { isVisionModel: true, maxVisionTurns: 2 });
    assert.equal(ctx.length, 5);

    // Turn 1 (index 0) was degraded to string to save tokens
    assert.equal(typeof ctx[0].content, "string");
    assert.ok((ctx[0].content as string).includes("[User attached image 1"));

    // Turn 2 (index 2) was preserved as raw multi-modal parts
    assert.equal(Array.isArray(ctx[2].content), true);

    // Turn 3 (index 4) was preserved as raw multi-modal parts
    assert.equal(Array.isArray(ctx[4].content), true);
  });

  it("detects historical images correctly", () => {
    assert.equal(hasHistoricalImages([turn("user", "hello")]), false);
    assert.equal(hasHistoricalImages([{ role: "user", content: "hi", images: [sampleImg1] }]), true);
  });

  it("provides anti-hallucination notices in multiple languages", () => {
    const zh = getAntiHallucinationNotice("zh-CN");
    const en = getAntiHallucinationNotice("en-US");
    const ja = getAntiHallucinationNotice("ja-JP");

    assert.ok(zh.includes("视觉上下文提示"));
    assert.ok(zh.includes("纯文本模式"));
    assert.ok(en.includes("Visual Context Notice"));
    assert.ok(ja.includes("視覚コンテキストに関する注意"));
  });
});
