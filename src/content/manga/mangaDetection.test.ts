import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isMangaReaderUrl,
  isMangaReaderDom,
  isLikelyMangaPage,
} from "./mangaDetection.ts";
import type { MangaImage } from "./mangaImage.ts";

type Box = { x: number; y: number; width: number; height: number };

class MockElement {
  tagName: string;
  box: Box;
  parentElement: MockElement | null;
  attributes: Map<string, string> = new Map();
  children: MockElement[] = [];
  className = "";
  id = "";

  constructor(tag: string, box: Box = { x: 0, y: 0, width: 0, height: 0 }, parent: MockElement | null = null) {
    this.tagName = tag.toUpperCase();
    this.box = box;
    this.parentElement = parent;
    if (parent) {
      parent.children.push(this);
    }
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, val: string) {
    this.attributes.set(name, val);
    if (name === "class") this.className = val;
    if (name === "id") this.id = val;
  }

  getBoundingClientRect(): Box {
    return { ...this.box };
  }

  matches(selector: string): boolean {
    const parts = selector.split(",").map((s) => s.trim());
    return parts.some((part) => {
      if (part.startsWith("#")) {
        return this.id === part.slice(1);
      }
      if (part.startsWith(".")) {
        const cls = part.slice(1);
        return this.className.split(/\s+/).includes(cls);
      }
      if (part.startsWith("[") && part.endsWith("]")) {
        const attrName = part.slice(1, -1);
        return this.hasAttribute(attrName);
      }
      return this.tagName.toLowerCase() === part.toLowerCase();
    });
  }

  querySelectorAll<T = MockElement>(selector: string): T[] {
    const results: MockElement[] = [];
    const traverse = (el: MockElement) => {
      for (const child of el.children) {
        if (child.matches(selector)) {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results as unknown as T[];
  }
}

function createMockDoc(url: string) {
  const body = new MockElement("BODY");
  const doc = {
    location: { href: url },
    body,
    documentElement: new MockElement("HTML", { x: 0, y: 0, width: 1000, height: 1000 }),
    querySelector: (selector: string) => {
      const all = body.querySelectorAll(selector);
      return all.length ? all[0] : null;
    },
  } as unknown as Document;
  return { doc, body };
}

describe("manga reader detection", () => {
  describe("isMangaReaderUrl", () => {
    it("rejects generic non-manga websites even if query contains keywords", () => {
      assert.equal(
        isMangaReaderUrl("https://blender.org/thanks/?cd=2026-09-14-1234"),
        false,
      );
      assert.equal(
        isMangaReaderUrl("https://en.wikipedia.org/wiki/Manga"),
        false,
      );
      assert.equal(
        isMangaReaderUrl("https://github.com/torvalds/linux"),
        false,
      );
      assert.equal(
        isMangaReaderUrl("https://www.google.com/search?q=manga+reader"),
        false,
      );
      assert.equal(
        isMangaReaderUrl("https://chat.deepseek.com/"),
        false,
      );
      assert.equal(
        isMangaReaderUrl("https://chat.deepseek.com/a/chat/s/12345"),
        false,
      );
      assert.equal(
        isMangaReaderUrl("https://chatgpt.com/c/abcd"),
        false,
      );
      assert.equal(
        isMangaReaderUrl("https://claude.ai/chat/123"),
        false,
      );
      assert.equal(
        isMangaReaderUrl("https://bilibili.com/video/BV12345"),
        false,
      );
      assert.equal(
        isMangaReaderUrl("https://www.reddit.com/r/manga/comments/123/discussion"),
        false,
      );
    });

    it("accepts known manga domains", () => {
      assert.equal(
        isMangaReaderUrl("https://mangadex.org/chapter/a1b2c3d4/1"),
        true,
      );
      assert.equal(
        isMangaReaderUrl("https://nhentai.net/g/12345/1/"),
        true,
      );
      assert.equal(
        isMangaReaderUrl("https://comic-walker.com/contents/detail/KDCW_123/"),
        true,
      );
      assert.equal(
        isMangaReaderUrl("https://www.webtoons.com/en/fantasy/tower-of-god/viewer?title_no=95&episode_no=1"),
        true,
      );
      assert.equal(
        isMangaReaderUrl("https://copymanga.tv/comic/one-piece/chapter/1"),
        true,
      );
    });

    it("accepts reader/chapter path patterns on unknown domains", () => {
      assert.equal(
        isMangaReaderUrl("https://my-scans.example.xyz/chapter/1050/"),
        true,
      );
      assert.equal(
        isMangaReaderUrl("https://read-here.net/chapter-12/"),
        true,
      );
      assert.equal(
        isMangaReaderUrl("https://comic-archive.org/read/title/c1"),
        true,
      );
      assert.equal(
        isMangaReaderUrl("https://obscure-host.org/viewer/episode-1"),
        true,
      );
    });
  });

  describe("isMangaReaderDom", () => {
    it("rejects Blender scenario (single landscape banner on generic page)", () => {
      const { doc, body } = createMockDoc("https://blender.org/thanks/");
      const main = new MockElement("MAIN", { x: 0, y: 0, width: 1000, height: 800 }, body);
      // Landscape banner (1200x500)
      const banner = new MockElement("IMG", { x: 50, y: 100, width: 900, height: 400 }, main);
      
      const isReader = isMangaReaderDom(doc, [banner as unknown as MangaImage]);
      assert.equal(isReader, false);
      assert.equal(isLikelyMangaPage(doc, [banner as unknown as MangaImage]), false);
    });

    it("identifies comic page inside a reader container (#reader-area, .comic-container, .comic-page)", () => {
      const { doc, body } = createMockDoc("https://unknown-domain.test/view");
      const readerContainer = new MockElement("DIV", { x: 0, y: 0, width: 800, height: 1200 }, body);
      readerContainer.setAttribute("id", "reader-area");
      const comicImg = new MockElement("IMG", { x: 50, y: 50, width: 700, height: 1050 }, readerContainer);

      assert.equal(isMangaReaderDom(doc, [comicImg as unknown as MangaImage]), true);
      assert.equal(isLikelyMangaPage(doc, [comicImg as unknown as MangaImage]), true);
    });

    it("strictly rejects chat.deepseek.com even with user-uploaded images in chat", () => {
      const { doc, body } = createMockDoc("https://chat.deepseek.com/a/chat/s/12345");
      const chatMsg = new MockElement("DIV", { x: 0, y: 0, width: 800, height: 600 }, body);
      // User uploaded screenshot/image in chat
      const uploadedImg = new MockElement("IMG", { x: 20, y: 20, width: 600, height: 400 }, chatMsg);

      assert.equal(isLikelyMangaPage(doc, [uploadedImg as unknown as MangaImage]), false);
    });

    it("identifies two-page spread (two portrait images side by side)", () => {
      const { doc, body } = createMockDoc("https://generic-gallery.test/album/1");
      const container = new MockElement("DIV", { x: 0, y: 0, width: 1000, height: 800 }, body);
      // Two portrait images side-by-side: 400x600 each
      const pageLeft = new MockElement("IMG", { x: 100, y: 100, width: 400, height: 600 }, container);
      const pageRight = new MockElement("IMG", { x: 510, y: 100, width: 400, height: 600 }, container);

      assert.equal(
        isMangaReaderDom(doc, [pageLeft as unknown as MangaImage, pageRight as unknown as MangaImage]),
        true,
      );
    });

    it("identifies multi-page vertical strip reader (webtoon stream)", () => {
      const { doc, body } = createMockDoc("https://cdn-viewer.test/article/42");
      const stripContainer = new MockElement("DIV", { x: 0, y: 0, width: 800, height: 3000 }, body);
      const img1 = new MockElement("IMG", { x: 50, y: 0, width: 700, height: 1000 }, stripContainer);
      new MockElement("IMG", { x: 50, y: 1000, width: 700, height: 1000 }, stripContainer);
      new MockElement("IMG", { x: 50, y: 2000, width: 700, height: 1000 }, stripContainer);

      assert.equal(isMangaReaderDom(doc, [img1 as unknown as MangaImage]), true);
    });

    it("identifies image with data-page attribute", () => {
      const { doc, body } = createMockDoc("https://image-host.test/p/123");
      const container = new MockElement("DIV", { x: 0, y: 0, width: 800, height: 1200 }, body);
      const img = new MockElement("IMG", { x: 50, y: 50, width: 700, height: 1050 }, container);
      img.setAttribute("data-page", "1");

      assert.equal(isMangaReaderDom(doc, [img as unknown as MangaImage]), true);
    });

    it("identifies chapter navigation on page with portrait image", () => {
      const { doc, body } = createMockDoc("https://reading-site.test/view");
      const navLink = new MockElement("A", { x: 0, y: 0, width: 100, height: 30 }, body);
      navLink.setAttribute("class", "next-chapter");
      const img = new MockElement("IMG", { x: 50, y: 50, width: 700, height: 1050 }, body);

      assert.equal(isMangaReaderDom(doc, [img as unknown as MangaImage]), true);
    });
  });
});
