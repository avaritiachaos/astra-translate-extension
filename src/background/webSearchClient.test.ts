import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDuckDuckGoHtml, parseGoogleHtml } from "./webSearchParser.ts";

describe("built-in web search parsers", () => {
  it("parses and sanitizes DuckDuckGo HTML results", () => {
    const results = parseDuckDuckGoHtml(`
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1">A &amp; B</a>
      <a class="result__snippet">Useful <b>summary</b> here.</a>
      <a class="result__a" href="https://example.org">Second result</a>
      <div class="result__snippet">Another result.</div>
      <a class="result__a" href="javascript:alert(1)">Unsafe</a>
      <div class="result__snippet">Must not appear.</div>
    `);

    assert.equal(results.length, 2);
    assert.deepEqual(results[0], {
      title: "A & B",
      url: "https://example.com/a?x=1",
      snippet: "Useful summary here.",
      source: "duckduckgo",
      isExternal: true,
    });
    assert.equal(results[1].source, "duckduckgo");
    assert.equal(results[1].isExternal, true);
  });

  it("deduplicates URLs and bounds untrusted fields", () => {
    const long = "x".repeat(500);
    const results = parseDuckDuckGoHtml(`
      <a class="result__a" href="https://example.com">${long}</a>
      <div class="result__snippet">${long}</div>
      <a class="result__a" href="https://example.com">Duplicate</a>
      <div class="result__snippet">Duplicate snippet</div>
    `);

    assert.equal(results.length, 1);
    assert.equal(results[0].title.length, 120);
    assert.equal(results[0].snippet.length, 280);
  });

  it("parses Google redirect links as fallback results", () => {
    const results = parseGoogleHtml(`
      <a href="/url?q=https%3A%2F%2Fexample.net%2Fdocs&amp;sa=U"><h3>Example docs</h3></a>
      <div class="VwiC3b">A small result snippet.</div>
    `);

    assert.equal(results.length, 1);
    assert.deepEqual(results[0], {
      title: "Example docs",
      url: "https://example.net/docs",
      snippet: "A small result snippet.",
      source: "google",
      isExternal: true,
    });
  });

  it("returns no fallback results when the Google markup is unrecognised", () => {
    // The caller treats this empty result as a transparent, ungrounded model
    // answer after DuckDuckGo is also empty; it is not a fabricated source.
    assert.deepEqual(parseGoogleHtml("<main>captcha or changed markup</main>"), []);
  });
});
