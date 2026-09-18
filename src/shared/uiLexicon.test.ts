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
    assert.equal(lookupUiLexicon("Пароль:", "Simplified Chinese"), "密码:");
    assert.equal(lookupUiLexicon("Имя пользователя:", "Simplified Chinese"), "用户名:");
  });

  it('leaves ambiguous bare "Имя" to the model (name vs username)', () => {
    assert.equal(lookupUiLexicon("Имя", "Simplified Chinese"), null);
    assert.equal(lookupUiLexicon("Имя:", "Simplified Chinese"), null);
  });

  it('does not rewrite already-correct "姓名"', () => {
    assert.equal(lookupUiLexicon("姓名", "Simplified Chinese"), null);
  });

  it("maps to English and Japanese targets", () => {
    assert.equal(lookupUiLexicon("вход", "English"), "Log in");
    assert.equal(lookupUiLexicon("search", "Japanese"), "検索");
  });

  it("ignores long prose", () => {
    const long = "Please enter your username and password to continue browsing";
    assert.equal(lookupUiLexicon(long, "Simplified Chinese"), null);
  });

  it("maps common UI action controls including add, orders, public view", () => {
    assert.equal(lookupUiLexicon("Add", "Simplified Chinese"), "添加");
    assert.equal(lookupUiLexicon("add", "Traditional Chinese"), "新增");
    assert.equal(lookupUiLexicon("Public view", "Simplified Chinese"), "公开视图");
    assert.equal(lookupUiLexicon("Orders", "Simplified Chinese"), "订单");
    assert.equal(lookupUiLexicon("Copy", "Simplified Chinese"), "复制");
    assert.equal(lookupUiLexicon("Refresh", "Simplified Chinese"), "刷新");
    assert.equal(lookupUiLexicon("Retry", "Simplified Chinese"), "重试");
    assert.equal(lookupUiLexicon("Filter", "Simplified Chinese"), "筛选");
    assert.equal(lookupUiLexicon("Sort", "Simplified Chinese"), "排序");
    assert.equal(lookupUiLexicon("More", "Simplified Chinese"), "更多");
    assert.equal(lookupUiLexicon("Details", "Simplified Chinese"), "详情");
  });

  it("returns null for unknown phrases", () => {
    assert.equal(lookupUiLexicon("Случайная раздача", "Simplified Chinese"), null);
  });
});
