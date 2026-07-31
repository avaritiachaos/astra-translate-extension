import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseBingHtml, parseDuckDuckGoHtml, parseGoogleHtml } from "./webSearchParser.ts";

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
    // answer after the other engines are also empty; it is not a fabricated
    // source.
    assert.deepEqual(parseGoogleHtml("<main>captcha or changed markup</main>"), []);
  });

  it("parses Bing b_algo blocks, including /ck/a redirect links", () => {
    // "a1" + base64url("https://example.com/doc")
    const tracked = "a1" + Buffer.from("https://example.com/doc").toString("base64url");
    const results = parseBingHtml(`
      <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;u=${tracked}&amp;ntb=1">Bing doc</a></h2>
        <div class="b_caption"><p>Bing snippet text.</p></div></li>
      <li class="b_algo"><h2><a href="https://example.org/direct">Direct link</a></h2></li>
    `);

    assert.equal(results.length, 2);
    assert.deepEqual(results[0], {
      title: "Bing doc",
      url: "https://example.com/doc",
      snippet: "Bing snippet text.",
      source: "bing",
      isExternal: true,
    });
    assert.equal(results[1].url, "https://example.org/direct");
  });

  it("decodes HTML entities exactly once", () => {
    const results = parseDuckDuckGoHtml(`
      <a class="result__a" href="https://example.com">Tom &amp;amp; Jerry &#39;quoted&#39;</a>
      <div class="result__snippet">literal &amp;lt;tag&amp;gt; stays escaped</div>
    `);

    assert.equal(results[0].title, "Tom &amp; Jerry 'quoted'");
    assert.equal(results[0].snippet, "literal &lt;tag&gt; stays escaped");
  });
});
