import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  emptySiteLexiconStore,
  isLearnableUiPair,
  lookupInStoreWithKeys,
  upsertLearnedPair,
} from "./siteLexicon.ts";

describe("siteLexicon", () => {
  it("accepts short UI pairs only", () => {
    assert.equal(isLearnableUiPair("Вход", "登录"), true);
    assert.equal(isLearnableUiPair("Имя:", "用户名:"), true);
    assert.equal(
      isLearnableUiPair(
        "Please enter your username and password to continue.",
        "请输入"
      ),
      false
    );
    assert.equal(isLearnableUiPair("hello", "hello"), false);
  });

  it("stores and looks up by host + lang", () => {
    const store = emptySiteLexiconStore();
    assert.equal(
      upsertLearnedPair(store, "rutracker.net", "Simplified Chinese", "Вход", "登录"),
      true
    );
    assert.equal(
      lookupInStoreWithKeys(store, "rutracker.net", "Simplified Chinese", "вход"),
      "登录"
    );
    assert.equal(
      lookupInStoreWithKeys(store, "rutracker.net", "Simplified Chinese", "Вход:"),
      "登录:"
    );
    assert.equal(
      lookupInStoreWithKeys(store, "other.com", "Simplified Chinese", "Вход"),
      null
    );
  });
});
