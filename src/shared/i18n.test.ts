// ============================================================
// i18n key consistency — every literal t() key must exist in
// every locale. Guards against keys silently falling back to
// their raw name in the UI (e.g. the v4.2.1 "page.scrollHint"
// regression: t() returns the key itself when it is missing).
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDict, type UiLanguage } from "./i18n.ts";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES: UiLanguage[] = ["zh-CN", "en-US", "ja-JP"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, out);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) {
      out.push(path);
    }
  }
  return out;
}

/** Literal keys from t(<expr>, "some.key", ...) call sites across src/. */
function collectUsedKeys(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const file of sourceFiles(SRC_ROOT)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\bt\(\s*[A-Za-z_$][\w.$]*\s*,\s*["'`]([\w.]+)["'`]/g)) {
      const files = used.get(m[1]) ?? [];
      files.push(file);
      used.set(m[1], files);
    }
  }
  return used;
}

describe("i18n key consistency", () => {
  const used = collectUsedKeys();

  it("extraction finds a plausible number of call sites", () => {
    // ~142 distinct keys at the time of writing. A collapse in this number
    // means the regex stopped matching the codebase's t() call style —
    // fix the extraction rather than trusting a hollow green run.
    assert.ok(
      used.size >= 100,
      `only ${used.size} distinct t() keys found — extraction regex broken?`
    );
  });

  for (const lang of LOCALES) {
    it(`every t() key exists in ${lang}`, () => {
      const dict = getDict(lang);
      const missing = [...used.keys()]
        .filter((key) => !(key in dict))
        .map((key) => `${key} (used in ${[...new Set(used.get(key))].join(", ")})`);
      assert.deepEqual(missing, []);
    });
  }
});
