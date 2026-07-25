import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  emptySiteLexiconStore,
  isLearnableUiPair,
  lookupInStore,
  lookupInStoreWithKeys,
  touchLearnedPair,
  upsertLearnedPair,
  SITE_LEXICON_MAX_PER_HOST_LANG,
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

  it("lookupInStore finds entries learned from a colon-suffixed label", () => {
    const store = emptySiteLexiconStore();
    // upsert strips the trailing colon before keying — lookup must match.
    upsertLearnedPair(store, "a.com", "Simplified Chinese", "Имя:", "名字:");
    assert.equal(lookupInStore(store, "a.com", "Simplified Chinese", "Имя:"), "名字:");
    assert.equal(lookupInStore(store, "a.com", "Simplified Chinese", "имя"), "名字:");
  });

  it("touchLearnedPair refreshes lastUsedAt so eviction is LRU by use", () => {
    const store = emptySiteLexiconStore();
    upsertLearnedPair(store, "a.com", "zh", "old", "旧", 1000);
    assert.equal(touchLearnedPair(store, "a.com", "zh", "old", 5000), true);
    assert.equal(touchLearnedPair(store, "a.com", "zh", "missing", 5000), false);
    // Fill past the cap with newer-learned but never-used entries.
    for (let i = 0; i < SITE_LEXICON_MAX_PER_HOST_LANG; i++) {
      upsertLearnedPair(store, "a.com", "zh", `k${i}`, `v${i}`, 2000 + i);
    }
    // "old" was learned first but used last — it must survive the trim.
    assert.equal(lookupInStoreWithKeys(store, "a.com", "zh", "old"), "旧");
  });
});

