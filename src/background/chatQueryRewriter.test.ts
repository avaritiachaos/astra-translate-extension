import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sanitizeModelQueryOutput, resolveSearchQuery } from "./chatQueryRewriter.ts";
import type { AstraSettings, ChatTurn } from "../shared/types.ts";

describe("sanitizeModelQueryOutput", () => {
  it("recognizes NONE and its variations as shouldSearch = false", () => {
    assert.deepEqual(sanitizeModelQueryOutput("NONE"), { shouldSearch: false });
    assert.deepEqual(sanitizeModelQueryOutput("none"), { shouldSearch: false });
    assert.deepEqual(sanitizeModelQueryOutput("无"), { shouldSearch: false });
    assert.deepEqual(sanitizeModelQueryOutput("不需要搜索"), { shouldSearch: false });
    assert.deepEqual(sanitizeModelQueryOutput(""), { shouldSearch: false });
  });

  it("strips prefixes, quotes, markdown fences and noise", () => {
    assert.deepEqual(
      sanitizeModelQueryOutput('Search Query: "Google Antigravity 官方"'),
      { shouldSearch: true, query: "Google Antigravity 官方" }
    );
    assert.deepEqual(
      sanitizeModelQueryOutput('搜索词：```\nGoogle Antigravity 官方\n```'),
      { shouldSearch: true, query: "Google Antigravity 官方" }
    );
    assert.deepEqual(
      sanitizeModelQueryOutput('Keywords: Google Antigravity release date???'),
      { shouldSearch: true, query: "Google Antigravity release date" }
    );
  });
});

describe("resolveSearchQuery", () => {
  const dummySettings: AstraSettings = {
    apiKey: "",
    baseUrl: "https://api.openai.com",
    endpoint: "/v1/chat/completions",
    model: "gpt-4o",
    apiFormat: "openai-compatible",
    providerId: "openai",
  };

  it("falls back to rule-based cleaner when no apiKey is configured", async () => {
    const currentTurn: ChatTurn = {
      role: "user",
      content: "你自己去查一下看看是不是官方tmd？？？",
      ts: Date.now(),
    };
    const res = await resolveSearchQuery(dummySettings, [], currentTurn);
    assert.equal(res.shouldSearch, true);
    assert.equal(res.query, "官方");
    assert.equal(res.isFallback, true);
  });

  it("retries previous topic when user complains about bad search results", async () => {
    const history: ChatTurn[] = [
      {
        role: "user",
        content: "antigravity不就是官方的吗",
        ts: Date.now() - 2000,
      },
      {
        role: "assistant",
        content: "不是官方的",
        ts: Date.now() - 1000,
      },
    ];
    const complaintTurn: ChatTurn = {
      role: "user",
      content: "我不是给你开联网了吗？你查的什么玩意儿啊",
      ts: Date.now(),
    };
    const res = await resolveSearchQuery(dummySettings, history, complaintTurn);
    assert.equal(res.shouldSearch, true);
    assert.equal(res.query, "antigravity不就是官方的吗");
    assert.equal(res.isFallback, true);
  });

  it("handles model call seamlessly when model returns clean keywords", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "Google Antigravity 官方",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    try {
      const activeSettings: AstraSettings = {
        ...dummySettings,
        apiKey: "sk-test-valid-key",
      };
      const currentTurn: ChatTurn = {
        role: "user",
        content: "你自己去查一下看看是不是官方tmd",
        ts: Date.now(),
      };
      const res = await resolveSearchQuery(activeSettings, [], currentTurn);
      assert.equal(res.shouldSearch, true);
      assert.equal(res.query, "Google Antigravity 官方");
      assert.equal(res.isFallback, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles model returning NONE to skip web search", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "NONE",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    try {
      const activeSettings: AstraSettings = {
        ...dummySettings,
        apiKey: "sk-test-valid-key",
      };
      const currentTurn: ChatTurn = {
        role: "user",
        content: "谢谢你的帮助！",
        ts: Date.now(),
      };
      const res = await resolveSearchQuery(activeSettings, [], currentTurn);
      assert.equal(res.shouldSearch, false);
      assert.equal(res.isFallback, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("gracefully falls back to rule-based cleaner when model throws or times out", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Network timeout");
    };

    try {
      const activeSettings: AstraSettings = {
        ...dummySettings,
        apiKey: "sk-test-valid-key",
      };
      const currentTurn: ChatTurn = {
        role: "user",
        content: "你自己去查一下看看是不是官方tmd",
        ts: Date.now(),
      };
      const res = await resolveSearchQuery(activeSettings, [], currentTurn);
      assert.equal(res.shouldSearch, true);
      assert.equal(res.query, "官方");
      assert.equal(res.isFallback, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
