import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { translationContextMenus } from "./contextMenuItems.ts";

describe("context-specific translation menu items", () => {
  it("keeps selection, direct image translation and page picking in separate contexts", () => {
    const items = translationContextMenus("zh-CN");
    assert.deepEqual(
      items.map((item) => [item.id, item.contexts]),
      [
        ["ast-translate-selection", ["selection"]],
        ["ast-translate-image", ["image"]],
        ["ast-pick-manga", ["page"]],
      ],
    );
    assert.equal(
      items.some((item) => item.parentId || item.contexts?.includes("all")),
      false,
    );
    assert.match(items[0].title!, /选中文字/);
    assert.match(items[1].title!, /这张图片/);
  });
  it("preserves identifiers used by routing and restricts menus to supported pages", () => {
    for (const lang of ["zh-CN", "en-US", "ja-JP"] as const) {
      const items = translationContextMenus(lang);
      assert.equal(new Set(items.map((item) => item.title)).size, 3);
      for (const item of items) {
        assert.deepEqual(item.documentUrlPatterns, [
          "http://*/*",
          "https://*/*",
        ]);
        assert.equal(item.title?.startsWith("menu."), false);
      }
    }
  });
});
