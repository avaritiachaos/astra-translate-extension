import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lookupUiLexicon, normalizeUiKey, uiLexiconSize } from "./uiLexicon.ts";

describe("uiLexicon", () => {
  it("loads a non-trivial dictionary", () => {
    assert.ok(uiLexiconSize() > 30);
  });

  it("normalizes case and whitespace", () => {
    assert.equal(normalizeUiKey("  Log  In  "), "log in");
    assert.equal(normalizeUiKey("ВХОД"), "вход");
  });

  it("maps Russian login controls to Simplified Chinese", () => {
    assert.equal(lookupUiLexicon("Вход", "Simplified Chinese"), "登录");
    assert.equal(lookupUiLexicon("поиск", "Simplified Chinese"), "搜索");
    assert.equal(lookupUiLexicon("Регистрация", "Simplified Chinese"), "注册");
    assert.equal(lookupUiLexicon("Главная", "Simplified Chinese"), "首页");
  });

  it("preserves trailing colons on form labels", () => {
    assert.equal(lookupUiLexicon("Имя:", "Simplified Chinese"), "用户名:");
    assert.equal(lookupUiLexicon("Пароль:", "Simplified Chinese"), "密码:");
  });

  it("maps to English and Japanese targets", () => {
    assert.equal(lookupUiLexicon("вход", "English"), "Log in");
    assert.equal(lookupUiLexicon("search", "Japanese"), "検索");
  });

  it("ignores long prose", () => {
    const long = "Please enter your username and password to continue browsing";
    assert.equal(lookupUiLexicon(long, "Simplified Chinese"), null);
  });

  it("returns null for unknown phrases", () => {
    assert.equal(lookupUiLexicon("Случайная раздача", "Simplified Chinese"), null);
  });
});
