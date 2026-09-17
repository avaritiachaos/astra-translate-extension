import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseRgb,
  getLuminance,
  resolveBubbleColor,
} from "./bubbleTheme.ts";

describe("manga bubbleTheme & luminance engine", () => {
  describe("parseRgb", () => {
    it("parses rgb strings correctly", () => {
      assert.deepEqual(parseRgb("rgb(255, 128, 64)"), [255, 128, 64]);
      assert.deepEqual(parseRgb("rgba(30, 40, 50, 0.85)"), [30, 40, 50]);
    });

    it("parses 6-digit hex strings correctly", () => {
      assert.deepEqual(parseRgb("#ffffff"), [255, 255, 255]);
      assert.deepEqual(parseRgb("#000000"), [0, 0, 0]);
      assert.deepEqual(parseRgb("#123456"), [0x12, 0x34, 0x56]);
    });

    it("parses 3-digit hex strings correctly", () => {
      assert.deepEqual(parseRgb("#fff"), [255, 255, 255]);
      assert.deepEqual(parseRgb("#000"), [0, 0, 0]);
      assert.deepEqual(parseRgb("#abc"), [0xaa, 0xbb, 0xcc]);
    });

    it("returns null for invalid or undefined color strings", () => {
      assert.equal(parseRgb(undefined), null);
      assert.equal(parseRgb(""), null);
      assert.equal(parseRgb("invalid-color"), null);
    });
  });

  describe("getLuminance", () => {
    it("computes 0 for pure black and 255 for pure white", () => {
      assert.equal(getLuminance([0, 0, 0]), 0);
      assert.ok(Math.abs(getLuminance([255, 255, 255]) - 255) < 0.1);
    });

    it("follows BT.601 weighted luminance", () => {
      // Pure red: 0.299 * 255 = 76.245
      assert.ok(Math.abs(getLuminance([255, 0, 0]) - 76.245) < 0.01);
      // Pure green: 0.587 * 255 = 149.685
      assert.ok(Math.abs(getLuminance([0, 255, 0]) - 149.685) < 0.01);
      // Pure blue: 0.114 * 255 = 29.07
      assert.ok(Math.abs(getLuminance([0, 0, 255]) - 29.07) < 0.01);
    });
  });

  describe("resolveBubbleColor", () => {
    const darkBg = { color: "rgb(25, 25, 30)", flat: true };
    const brightBg = { color: "rgb(250, 250, 250)", flat: true };
    const nonFlatBrightBg = { color: "rgb(240, 240, 240)", flat: false };

    describe("theme: auto", () => {
      it("inverts text and uses dark background when bg is naturally dark", () => {
        const style = resolveBubbleColor(darkBg, "auto");
        assert.equal(style.isDark, true);
        assert.equal(style.textColor, "#f5f3ff");
        assert.ok(style.backgroundColor.includes("rgba("));
        assert.ok(style.borderColor);
        assert.ok(style.boxShadow);
      });

      it("uses light bubble and dark text when bg is bright", () => {
        const style = resolveBubbleColor(brightBg, "auto");
        assert.equal(style.isDark, false);
        assert.equal(style.textColor, "#1f1f24");
        assert.equal(style.backgroundColor, brightBg.color);
      });

      it("falls back to white background if not flat", () => {
        const style = resolveBubbleColor(nonFlatBrightBg, "auto");
        assert.equal(style.isDark, false);
        assert.equal(style.textColor, "#1f1f24");
        assert.equal(style.backgroundColor, "#ffffff");
      });

      it("defaults to light bubble if background is undefined", () => {
        const style = resolveBubbleColor(undefined, "auto");
        assert.equal(style.isDark, false);
        assert.equal(style.textColor, "#1f1f24");
        assert.equal(style.backgroundColor, "#ffffff");
      });
    });

    describe("theme: dark", () => {
      it("forces dark background and light text even for bright original bg", () => {
        const style = resolveBubbleColor(brightBg, "dark");
        assert.equal(style.isDark, true);
        assert.equal(style.textColor, "#f3f1fb");
        assert.equal(style.backgroundColor, "rgba(22, 20, 32, 0.92)");
        assert.equal(style.borderColor, "rgba(255, 255, 255, 0.15)");
      });

      it("works for dark original bg as well", () => {
        const style = resolveBubbleColor(darkBg, "dark");
        assert.equal(style.isDark, true);
        assert.equal(style.textColor, "#f3f1fb");
      });
    });

    describe("theme: light", () => {
      it("forces light background and dark text even for dark original bg", () => {
        const style = resolveBubbleColor(darkBg, "light");
        assert.equal(style.isDark, false);
        assert.equal(style.textColor, "#1f1f24");
      });

      it("uses flat background if provided", () => {
        const style = resolveBubbleColor(brightBg, "light");
        assert.equal(style.isDark, false);
        assert.equal(style.textColor, "#1f1f24");
        assert.equal(style.backgroundColor, brightBg.color);
      });
    });

    describe("theme: translucent", () => {
      it("returns translucent dark styling for dark backgrounds", () => {
        const style = resolveBubbleColor(darkBg, "translucent");
        assert.equal(style.isDark, true);
        assert.equal(style.textColor, "#ffffff");
        assert.equal(style.backgroundColor, "rgba(16, 14, 24, 0.65)");
      });

      it("returns translucent light styling for bright backgrounds", () => {
        const style = resolveBubbleColor(brightBg, "translucent");
        assert.equal(style.isDark, false);
        assert.equal(style.textColor, "#1a1920");
        assert.equal(style.backgroundColor, "rgba(255, 255, 255, 0.72)");
      });
    });
  });
});
