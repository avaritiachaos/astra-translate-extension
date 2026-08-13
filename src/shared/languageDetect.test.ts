// ============================================================
// Astra Translate – languageDetect classifier tests
// ============================================================
// Run with:  node --test src/shared/languageDetect.test.ts
// Uses Node's built-in test runner + native TS type stripping (Node >= 22).
// No test framework dependency is added to the project.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isProbablyUrl,
  isProbablyEmail,
  isProbablyFilePath,
  isProbablyCodeLike,
  isProbablyHashOrToken,
  isHardNonTranslatable,
  isSoftIdentifier,
  classifySelectedText,
  isLikelyIdentityTranslation,
} from "./languageDetect.ts";
import type { AstraSettings } from "./types.ts";

// Minimal settings slice for classifySelectedText (defaults from storage.ts).
const SETTINGS: Pick<
  AstraSettings,
  | "dictionaryModeEnabled"
  | "smartTargetMaxChars"
  | "smartTargetMaxWords"
  | "smartTargetMaxCjkChars"
> = {
  dictionaryModeEnabled: true,
  smartTargetMaxChars: 40,
  smartTargetMaxWords: 8,
  smartTargetMaxCjkChars: 20,
};

// ------------------------------------------------------------
// Regression: the v4.0.0 bug.
// A paragraph of English prose containing a parenthetical URL plus an
// ordinary word ("new") was misclassified as code-like, so the whole text
// was returned untranslated. This must stay translatable.
// ------------------------------------------------------------
const BUG_PARAGRAPH =
  "API Error: Claude Code is unable to respond to this request, which " +
  "appears to violate our Usage Policy (https://www.anthropic.com/legal/aup). " +
  "Please double press esc to edit your last message or start a new session " +
  "for Claude Code to assist with a different task.";

test("regression: prose paragraph with parenthetical URL + 'new' is translatable", () => {
  assert.equal(isProbablyCodeLike(BUG_PARAGRAPH), false);
  assert.equal(isHardNonTranslatable(BUG_PARAGRAPH), false);
  assert.equal(classifySelectedText(BUG_PARAGRAPH, "manual", SETTINGS), "translate");
});

// The v4.0.1 bug: the same shape but LONGER — a second URL with a "?token=…"
// query string adds a third code symbol ("="), so the raw count of >= 3 tripped
// and the whole error message was refused translation. Density, not count, is the
// real signal: this paragraph is ~0.006 symbols/char, far below any real snippet.
const CYBER_PARAGRAPH =
  "API Error: Claude Code is unable to respond to this request, which appears " +
  "to violate our Usage Policy (https://www.anthropic.com/legal/aup). This request " +
  "triggered cyber-related safeguards. To request an adjustment pursuant to our " +
  "Cyber Verification Program based on how you use Claude, fill out " +
  "https://claude.com/form/cyber-use-case?token=8d5glJ-pNoJTXZ5jAkiCshhAcWhq6KetKL1 " +
  "To learn more about the program or provide feedback, visit o… Please double press " +
  "esc to edit your last message or start a new session for Claude Code to assist " +
  "with a different task.";

test("regression: long error message with two URLs + 'new' is translatable", () => {
  assert.equal(isProbablyCodeLike(CYBER_PARAGRAPH), false);
  assert.equal(isHardNonTranslatable(CYBER_PARAGRAPH), false);
  assert.equal(classifySelectedText(CYBER_PARAGRAPH, "manual", SETTINGS), "translate");
});

test("regression: short prose with a keyword + single paren is not code", () => {
  // "new" + "(...)" but it is plainly a sentence.
  assert.equal(isProbablyCodeLike("Please start a new session (it helps)."), false);
  // "class" + paren, also prose.
  assert.equal(isProbablyCodeLike("She joined a new class (the morning one)."), false);
});

// ------------------------------------------------------------
// isProbablyCodeLike — real code must still be caught.
// ------------------------------------------------------------
test("isProbablyCodeLike: detects real inline code", () => {
  assert.equal(isProbablyCodeLike("const x = foo();"), true);
  assert.equal(isProbablyCodeLike("if (x) { return y; }"), true);
  assert.equal(isProbablyCodeLike("x => x + 1"), true); // fat arrow is a strong signal
  assert.equal(isProbablyCodeLike("const a = b(); let c = d(); return a + c;"), true);
});

test("isProbablyCodeLike: detects shell commands", () => {
  assert.equal(isProbablyCodeLike("npm install react"), true);
  assert.equal(isProbablyCodeLike("git commit -m 'msg'"), true);
  assert.equal(isProbablyCodeLike("docker run -it ubuntu"), true);
});

test("isProbablyCodeLike: plain prose is not code", () => {
  assert.equal(isProbablyCodeLike("This is a normal English sentence."), false);
  assert.equal(isProbablyCodeLike("请把这段话翻译成中文。"), false);
});

// ------------------------------------------------------------
// URL / email / path / hash detectors.
// ------------------------------------------------------------
test("isProbablyUrl", () => {
  assert.equal(isProbablyUrl("https://example.com/foo"), true);
  assert.equal(isProbablyUrl("www.example.com"), true);
  assert.equal(isProbablyUrl("just visit example.com later"), false); // not a standalone URL
});

test("isProbablyEmail", () => {
  assert.equal(isProbablyEmail("user@example.com"), true);
  assert.equal(isProbablyEmail("email me at user@example.com please"), false); // whole-string only
});

test("isProbablyFilePath", () => {
  assert.equal(isProbablyFilePath("/usr/local/bin"), true);
  assert.equal(isProbablyFilePath("C:\\Users\\rain"), true);
  assert.equal(isProbablyFilePath("./src/index.ts"), true);
  assert.equal(isProbablyFilePath("astra-translate-extension"), false); // no slash → not a path
});

test("isProbablyHashOrToken", () => {
  assert.equal(isProbablyHashOrToken("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isProbablyHashOrToken("d41d8cd98f00b204e9800998ecf8427e"), true);
  assert.equal(isProbablyHashOrToken("hello"), false);
});

// ------------------------------------------------------------
// Soft identifiers.
// ------------------------------------------------------------
test("isSoftIdentifier", () => {
  assert.equal(isSoftIdentifier("avaritiachaos"), true);
  assert.equal(isSoftIdentifier("astra-translate-extension"), true);
  assert.equal(isSoftIdentifier("GPT-5"), true);
  assert.equal(isSoftIdentifier("the"), false); // common word
  assert.equal(isSoftIdentifier("hello world"), false); // has space
});

// ------------------------------------------------------------
// classifySelectedText routing.
// ------------------------------------------------------------
test("classifySelectedText: hard-non-translatable for URL in every mode", () => {
  assert.equal(classifySelectedText("https://example.com", "manual", SETTINGS), "hard-non-translatable");
  assert.equal(classifySelectedText("https://example.com", "selection", SETTINGS), "hard-non-translatable");
  assert.equal(classifySelectedText("https://example.com", "page", SETTINGS), "hard-non-translatable");
});

test("classifySelectedText: soft identifier → dictionary on selection, soft-identifier elsewhere", () => {
  assert.equal(classifySelectedText("avaritiachaos", "selection", SETTINGS), "dictionary");
  assert.equal(classifySelectedText("avaritiachaos", "manual", SETTINGS), "soft-identifier");
  assert.equal(classifySelectedText("avaritiachaos", "page", SETTINGS), "soft-identifier");
});

test("classifySelectedText: a full sentence is translated", () => {
  assert.equal(classifySelectedText("This is a sentence worth translating.", "manual", SETTINGS), "translate");
});

test("isLikelyIdentityTranslation: flags a Chinese echo when target is Japanese", () => {
  assert.equal(
    isLikelyIdentityTranslation(
      "据说 DeepSeek 的推論強度設定只是几行提示词？",
      "据说 DeepSeek 的推論強度設定只是几行提示词？",
      "Japanese",
    ),
    true,
  );
});

test("isLikelyIdentityTranslation: accepts an unchanged same-language result", () => {
  assert.equal(
    isLikelyIdentityTranslation("这是中文", "这是中文", "Simplified Chinese"),
    false,
  );
});

test("isLikelyIdentityTranslation: explicit different languages flag an echo", () => {
  assert.equal(
    isLikelyIdentityTranslation("This is a sentence.", "This is a sentence.", "French", "English"),
    true,
  );
});
