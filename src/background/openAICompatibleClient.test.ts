import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRequestParts, openAIChat, openAIChatStream } from "./openAICompatibleClient.ts";
import type { UserProviderSettings } from "../shared/types.ts";

const BASE_SETTINGS: UserProviderSettings = {
  providerId: "google-gemini",
  providerName: "Google Gemini (AI Studio)",
  apiFormat: "openai-compatible",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  endpoint: "/chat/completions",
  model: "gemini-3.7-flash",
  apiKey: "test-api-key",
  temperature: 0.3,
  disableThinking: false,
  timeoutMs: 30000,
};

describe("openAICompatibleClient buildRequestParts", () => {
  it("uses low reasoning_effort by default for Gemini 3 translation requests", () => {
    const parts = buildRequestParts(
      BASE_SETTINGS, // model: "gemini-3.7-flash"
      [{ role: "user", content: "Translate this" }],
      false,
      "zh-CN"
    );

    assert.equal(parts.body.reasoning_effort, "low");
    assert.deepEqual(parts.optionalKeys, ["reasoning_effort"]);
  });

  it("uses none reasoning_effort for Gemini 2.5 Flash translation requests", () => {
    const parts = buildRequestParts(
      { ...BASE_SETTINGS, model: "gemini-2.5-flash" },
      [{ role: "user", content: "Translate this" }],
      false,
      "zh-CN"
    );

    assert.equal(parts.body.reasoning_effort, "none");
    assert.deepEqual(parts.optionalKeys, ["reasoning_effort"]);
  });

  it("disables thinking for DeepSeek translation requests", () => {
    const parts = buildRequestParts(
      {
        ...BASE_SETTINGS,
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
      },
      [{ role: "user", content: "Translate this" }],
      false,
      "zh-CN"
    );

    assert.deepEqual(parts.body.thinking, { type: "disabled" });
    assert.deepEqual(parts.optionalKeys, ["thinking"]);
  });

  it("respects extra.optionalBody for Chat requests without overriding", () => {
    const parts = buildRequestParts(
      BASE_SETTINGS,
      [{ role: "user", content: "Chat question" }],
      true,
      "zh-CN",
      { optionalBody: { reasoning_effort: "high" } }
    );

    assert.equal(parts.body.reasoning_effort, "high");
    assert.deepEqual(parts.optionalKeys, ["reasoning_effort"]);
  });

  it("disables reasoning_effort for custom provider when disableThinking is true", () => {
    const parts = buildRequestParts(
      {
        ...BASE_SETTINGS,
        providerId: "custom-openai-compatible",
        model: "custom-model",
        disableThinking: true,
      },
      [{ role: "user", content: "Translate this" }],
      false,
      "zh-CN"
    );

    assert.equal(parts.body.thinking, false);
    assert.deepEqual(parts.optionalKeys, ["thinking"]);
  });

  it("safely falls back to low reasoning_effort for Gemini 3 custom provider (CPA)", () => {
    const parts = buildRequestParts(
      {
        ...BASE_SETTINGS,
        providerId: "custom-openai-compatible",
        model: "gemini-3.8-flash-high",
        disableThinking: true,
      },
      [{ role: "user", content: "Translate this" }],
      false,
      "zh-CN"
    );

    assert.equal(parts.body.reasoning_effort, "low");
    assert.deepEqual(parts.optionalKeys, ["reasoning_effort"]);
  });
});


const imageMessages = [{ role: "user" as const, content: [
  { type: "text" as const, text: "Read this image" },
  { type: "image_url" as const, image_url: { url: "data:image/png;base64,AA==" } },
] }];
const jsonResponse = (content: unknown, finish_reason?: string) => new Response(
  JSON.stringify({ choices: [{ message: { content }, finish_reason }] }),
  { headers: { "Content-Type": "application/json" } }
);
const streamResponse = (payload: string) => new Response(payload, { headers: { "Content-Type": "text/event-stream" } });

describe("provider transport failure boundaries", () => {
  it("never drops required images or schema after repeated 400 errors", async (ctx) => {
    const bodies: any[] = [];
    ctx.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return new Response("invalid image", { status: 400 });
    });
    await assert.rejects(openAIChat(BASE_SETTINGS, imageMessages, "en-US", {
      optionalBody: { thinking: false }, responseFormat: { type: "json_object" }, maxRetries: 0,
    }), (error: any) => error.statusCode === 400);
    assert.equal(bodies.length, 2);
    for (const body of bodies) {
      assert.deepEqual(body.messages, imageMessages);
      assert.deepEqual(body.response_format, { type: "json_object" });
    }
    assert.equal(bodies[1].thinking, undefined);
  });

  it("accepts a JSON response when a gateway ignores stream:true", async (ctx) => {
    ctx.mock.method(globalThis, "fetch", async () => jsonResponse([{ type: "text", text: "answer" }]));
    const deltas: string[] = [];
    assert.equal(await openAIChatStream(BASE_SETTINGS, imageMessages, (s) => deltas.push(s)), "answer");
    assert.deepEqual(deltas, ["answer"]);
  });

  it("handles split UTF-8, multi-line events and finish_reason without DONE", async (ctx) => {
    const bytes = new TextEncoder().encode('data: {"choices":\r\ndata: [{"delta":{"content":"中文"}}]}\r\n\r\ndata: {"choices":[{"finish_reason":"stop"}]}');
    ctx.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
      start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); },
    }), { headers: { "Content-Type": "text/event-stream" } }));
    assert.equal(await openAIChatStream(BASE_SETTINGS, imageMessages, () => {}), "中文");
  });

  it("rejects an EOF after partial content without retrying or claiming success", async (ctx) => {
    let calls = 0;
    ctx.mock.method(globalThis, "fetch", async () => {
      calls++; return streamResponse('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    });
    await assert.rejects(openAIChatStream(BASE_SETTINGS, imageMessages, () => {}),
      (error: any) => error.code === "RESPONSE_TRUNCATED");
    assert.equal(calls, 1);
  });

  it("rejects token-limit truncation even when the stream sends DONE", async (ctx) => {
    ctx.mock.method(globalThis, "fetch", async () => streamResponse('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'));
    await assert.rejects(openAIChatStream(BASE_SETTINGS, imageMessages, () => {}),
      (error: any) => error.code === "RESPONSE_TRUNCATED");
  });

  it("does not retry authentication errors", async (ctx) => {
    let calls = 0;
    ctx.mock.method(globalThis, "fetch", async () => { calls++; return new Response("", { status: 401 }); });
    await assert.rejects(openAIChat(BASE_SETTINGS, imageMessages), (error: any) => error.code === "AUTH_ERROR");
    assert.equal(calls, 1);
  });

  it("cancels a Retry-After wait before any repeated request", async (ctx) => {
    const abort = new AbortController();
    let calls = 0;
    ctx.mock.method(globalThis, "fetch", async () => {
      calls++; setTimeout(() => abort.abort(), 5);
      return new Response("", { status: 429, headers: { "Retry-After": "60" } });
    });
    await assert.rejects(openAIChat(BASE_SETTINGS, imageMessages, "en-US", { signal: abort.signal }),
      (error: any) => error.code === "CANCELLED");
    assert.equal(calls, 1);
  });

  it("aborts non-streaming requests and does not retry cancellation", async (ctx) => {
    const abort = new AbortController();
    let calls = 0;
    ctx.mock.method(globalThis, "fetch", (_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      calls++; init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      queueMicrotask(() => abort.abort());
    }));
    await assert.rejects(openAIChat(BASE_SETTINGS, imageMessages, "en-US", { signal: abort.signal }),
      (error: any) => error.code === "CANCELLED");
    assert.equal(calls, 1);
  });

  it("enforces the total deadline while waiting for retry", async (ctx) => {
    let calls = 0;
    ctx.mock.method(globalThis, "fetch", async () => {
      calls++; return new Response("", { status: 503, headers: { "Retry-After": "60" } });
    });
    await assert.rejects(openAIChat(BASE_SETTINGS, imageMessages, "en-US", { deadlineMs: 10 }),
      (error: any) => error.code === "TIMEOUT");
    assert.equal(calls, 1);
  });
});


it("distinguishes explicitly unsupported structured formats from bad image errors",async(ctx)=>{
  let reason="Unsupported response_format: json_schema";
  ctx.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({error:{message:reason}}),{status:400}));
  await assert.rejects(openAIChat(BASE_SETTINGS,imageMessages,"en-US",{optionalBody:{},maxRetries:0}), (error:any)=>error.code==="FORMAT_UNSUPPORTED");
  reason="Invalid image data while using response_format=json_schema";
  await assert.rejects(openAIChat(BASE_SETTINGS,imageMessages,"en-US",{optionalBody:{},maxRetries:0}), (error:any)=>error.code==="HTTP_ERROR");
});

describe("actionable model routing errors", () => {
  it("recognizes the actual CPA model_not_found error without retrying away image/schema fields", async ctx => {
    let calls = 0;
    ctx.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      calls++;
      const body = JSON.parse(init.body as string);
      assert.deepEqual(body.messages, imageMessages);
      assert.deepEqual(body.response_format, { type: "json_object" });
      return Response.json({ error: { message: "unknown provider for model gemini-3.8-flash", type: "invalid_request_error", code: "model_not_found", param: "model" } }, { status: 400 });
    });
    await assert.rejects(openAIChat({ ...BASE_SETTINGS, model: "gemini-3.8-flash" }, imageMessages, "zh-CN", {
      optionalBody: { thinking: false }, responseFormat: { type: "json_object" }, maxRetries: 0,
    }), (error: any) => error.code === "MODEL_NOT_FOUND" && error.message.includes("gemini-3.8-flash") && error.message.includes("可用模型"));
    assert.equal(calls, 1);
  });
  it("recognizes a model error on HTTP 404 without turning a missing route into a model error", async ctx => {
    const mock = ctx.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "model_not_found", message: "not available" } }, { status: 404 }));
    await assert.rejects(openAIChat(BASE_SETTINGS, imageMessages, "en-US", { optionalBody: {}, maxRetries: 0 }), (error: any) => error.code === "MODEL_NOT_FOUND");
    mock.mock.mockImplementation(async () => new Response("404 page not found", { status: 404 }));
    await assert.rejects(openAIChat(BASE_SETTINGS, imageMessages, "en-US", { optionalBody: {}, maxRetries: 0 }), (error: any) => error.code !== "MODEL_NOT_FOUND");
  });
  it("does not expose raw provider errors containing keys or prompts", async ctx => {
    ctx.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "model_not_found", message: "test-api-key Bearer secret-proxy-key data:image/png;base64,PRIVATE" } }, { status: 400 }));
    await assert.rejects(openAIChat(BASE_SETTINGS, imageMessages, "en-US", { optionalBody: {}, maxRetries: 0 }), (error: any) => {
      assert.equal(error.code, "MODEL_NOT_FOUND");
      assert.equal(/test-api-key|secret-proxy-key|PRIVATE/.test(error.message), false);
      return true;
    });
  });
  it("recognizes a plain CPA model-routing error", async ctx => {
    ctx.mock.method(globalThis, "fetch", async () => new Response("unknown provider for model missing", { status: 400 }));
    await assert.rejects(openAIChat(BASE_SETTINGS, imageMessages, "en-US", { optionalBody: {}, maxRetries: 0 }), (error: any) => error.code === "MODEL_NOT_FOUND");
  });

  it("accepts Gemini uppercase STOP and Claude end_turn finish_reason in streaming", async ctx => {
    ctx.mock.method(globalThis, "fetch", async () => streamResponse('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"STOP"}]}\n\ndata: [DONE]\n\n'));
    assert.equal(await openAIChatStream(BASE_SETTINGS, imageMessages, () => {}), "ok");

    ctx.mock.method(globalThis, "fetch", async () => streamResponse('data: {"choices":[{"delta":{"content":"ok2"},"finish_reason":"end_turn"}]}\n\ndata: [DONE]\n\n'));
    assert.equal(await openAIChatStream(BASE_SETTINGS, imageMessages, () => {}), "ok2");
  });

  it("surfaces model safety / content filter blocking clearly", async ctx => {
    ctx.mock.method(globalThis, "fetch", async () => streamResponse('data: {"choices":[{"delta":{},"finish_reason":"SAFETY"}]}\n\ndata: [DONE]\n\n'));
    await assert.rejects(
      openAIChatStream(BASE_SETTINGS, imageMessages, () => {}),
      (error: any) => error.code === "CONTENT_FILTER"
    );
  });

  it("surfaces upstream error chunks in stream instead of hiding as parse error", async ctx => {
    ctx.mock.method(globalThis, "fetch", async () => streamResponse('data: {"error":{"message":"Resource has been exhausted (quota)","code":429}}\n\n'));
    await assert.rejects(
      openAIChatStream(BASE_SETTINGS, imageMessages, () => {}),
      (error: any) => error.code === "STREAM_ERROR" && error.message.includes("quota")
    );
  });
});

