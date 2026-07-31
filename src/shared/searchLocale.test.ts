import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bingSearchUrl,
  duckDuckGoSearchUrl,
  googleSearchUrl,
  searchLocaleFor,
} from "./searchLocale.ts";
import { buildChatSearchQuery } from "./chatSearch.ts";

describe("search locale", () => {
  it("maps each UI language to matching search preferences", () => {
    assert.deepEqual(searchLocaleFor("zh-CN"), {
      acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.7",
      duckDuckGoRegion: "cn-zh",
      googleLanguage: "zh-CN",
      bingMarket: "zh-CN",
    });
    assert.deepEqual(searchLocaleFor("en-US"), {
      acceptLanguage: "en-US,en;q=0.9,zh;q=0.5",
      duckDuckGoRegion: "us-en",
      googleLanguage: "en",
      bingMarket: "en-US",
    });
    assert.deepEqual(searchLocaleFor("ja-JP"), {
      acceptLanguage: "ja-JP,ja;q=0.9,en;q=0.7",
      duckDuckGoRegion: "jp-jp",
      googleLanguage: "ja",
      bingMarket: "ja-JP",
    });
  });

  it("puts language preferences into both search URLs", () => {
    const ddg = new URL(duckDuckGoSearchUrl("latest weather", "ja-JP"));
    assert.equal(ddg.searchParams.get("q"), "latest weather");
    assert.equal(ddg.searchParams.get("kl"), "jp-jp");

    const google = new URL(googleSearchUrl("latest weather", "en-US", 5));
    assert.equal(google.searchParams.get("q"), "latest weather");
    assert.equal(google.searchParams.get("hl"), "en");
    assert.equal(google.searchParams.get("num"), "5");

    const bing = new URL(bingSearchUrl("latest weather", "zh-CN"));
    assert.equal(bing.searchParams.get("q"), "latest weather");
    assert.equal(bing.searchParams.get("mkt"), "zh-CN");
  });
});

describe("buildChatSearchQuery", () => {
  it("adds a title when it has a meaningful budget", () => {
    assert.equal(buildChatSearchQuery("what changed", "Release notes"), "what changed Release notes");
  });

  it("does not append a duplicate or a nearly-truncated title", () => {
    assert.equal(buildChatSearchQuery("what changed Release notes", "Release notes"), "what changed Release notes");
    const base = "q".repeat(391);
    assert.equal(buildChatSearchQuery(base, "Release notes"), base);
  });

  it("uses the full question before any title hint", () => {
    const input = "q".repeat(450);
    assert.equal(buildChatSearchQuery(input, "Release notes"), "q".repeat(400));
  });
});
