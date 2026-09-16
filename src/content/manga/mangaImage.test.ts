import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mangaImageAtPoint,
  mangaImageSize,
  mangaImageSource,
  visibleMangaImageRect,
  visibleMangaSpread,
  intersectRects,
  type MangaImage,
} from "./mangaImage.ts";

type Box = { x: number; y: number; width: number; height: number };
class TestElement {
  tagName: string;
  box: Box;
  parentElement: TestElement | null;
  ownerDocument: Document;
  isConnected = true;
  width = 822;
  height = 1200;
  naturalWidth = 800;
  naturalHeight = 1100;
  currentSrc = "https://example.test/current.png";
  src = "https://example.test/original.png";
  clientLeft = 0;
  clientTop = 0;
  clientWidth: number;
  clientHeight: number;
  offsetWidth: number;
  offsetHeight: number;
  style: Record<string, string> = {};
  constructor(
    tag: string,
    box: Box,
    parent: TestElement | null,
    doc: Document,
  ) {
    this.tagName = tag;
    this.box = box;
    this.parentElement = parent;
    this.ownerDocument = doc;
    this.clientWidth = this.offsetWidth = box.width;
    this.clientHeight = this.offsetHeight = box.height;
  }
  getBoundingClientRect() {
    return {
      ...this.box,
      left: this.box.x,
      top: this.box.y,
      right: this.box.x + this.box.width,
      bottom: this.box.y + this.box.height,
    };
  }
  contains(other: TestElement): boolean {
    for (let el: TestElement | null = other; el; el = el.parentElement) {
      if (el === this) return true;
    }
    return false;
  }
}
function fixture() {
  const elements: TestElement[] = [];
  let stack: TestElement[] = [];
  const doc = {
    defaultView: {
      innerWidth: 1000,
      innerHeight: 800,
      getComputedStyle: (el: TestElement) => ({
        display: "block",
        visibility: "visible",
        opacity: "1",
        overflowX: "visible",
        overflowY: "visible",
        pointerEvents: "auto",
        ...el.style,
      }),
    },
    querySelectorAll: () =>
      elements.filter((el) => ["IMG", "CANVAS"].includes(el.tagName)),
    elementsFromPoint: () => stack,
  } as unknown as Document;
  const add = (tag: string, box: Box, parent: TestElement | null = null) => {
    const el = new TestElement(tag, box, parent, doc);
    elements.push(el);
    return el;
  };
  const html = add("HTML", { x: 0, y: 0, width: 1000, height: 800 });
  const body = add("BODY", { x: 0, y: 0, width: 1000, height: 800 }, html);
  (doc as unknown as { body: TestElement; documentElement: TestElement }).body = body;
  (doc as unknown as { body: TestElement; documentElement: TestElement }).documentElement = html;
  return {
    doc,
    add,
    body,
    html,
    stack: (...items: TestElement[]) => {
      stack = items;
    },
  };
}
const image = (el: TestElement) => el as unknown as MangaImage;
const pageBox = { x: 100, y: 100, width: 300, height: 500 };

describe("manga picker image geometry", () => {
  it("uses intrinsic image and canvas sizes without treating a canvas as a URL", () => {
    const f = fixture(),
      img = f.add("IMG", pageBox, f.body),
      canvas = f.add("CANVAS", pageBox, f.body);
    assert.deepEqual(mangaImageSize(image(img)), { width: 800, height: 1100 });
    assert.deepEqual(mangaImageSize(image(canvas)), {
      width: 822,
      height: 1200,
    });
    assert.equal(mangaImageSource(image(img)), img.currentSrc);
    img.currentSrc = "";
    assert.equal(mangaImageSource(image(img)), img.src);
    assert.equal(mangaImageSource(image(canvas)), "canvas:822x1200");
  });
  it("selects a normal image beneath a transparent interaction layer", () => {
    const f = fixture(),
      img = f.add("IMG", pageBox, f.body),
      cover = f.add("A", pageBox, f.body);
    f.stack(cover, img, f.body);
    assert.equal(mangaImageAtPoint(200, 200, f.doc), img);
  });
  it("selects BOTH pointer-events:none canvases by position, not document order", () => {
    const f = fixture();
    const rightPage = f.add(
      "P",
      { x: 500, y: 0, width: 400, height: 700 },
      f.body,
    );
    const leftPage = f.add(
      "P",
      { x: 100, y: 0, width: 400, height: 700 },
      f.body,
    );
    const right = f.add("CANVAS", rightPage.box, rightPage);
    const left = f.add("CANVAS", leftPage.box, leftPage);
    right.style.pointerEvents = left.style.pointerEvents = "none";
    const next = f.add("A", { x: 0, y: 0, width: 350, height: 700 }, f.body);
    f.stack(next, leftPage, f.body);
    assert.equal(mangaImageAtPoint(200, 300, f.doc), left);
    f.stack(rightPage, f.body);
    assert.equal(mangaImageAtPoint(700, 300, f.doc), right);
    assert.equal(mangaImageAtPoint(500, 300, f.doc), right);
  });
  it("uses hit-stack order instead of selecting a covered preloaded image", () => {
    const f = fixture();
    const top = f.add("IMG", pageBox, f.body),
      behind = f.add("IMG", pageBox, f.body);
    f.stack(top, behind, f.body);
    assert.equal(mangaImageAtPoint(200, 200, f.doc), top);
  });
  it("uses the nearest hit ancestor for overlapping non-interactive canvases", () => {
    const f = fixture();
    const a = f.add("P", pageBox, f.body),
      b = f.add("P", pageBox, f.body);
    const top = f.add("CANVAS", pageBox, a);
    f.add("CANVAS", pageBox, b);
    f.stack(a, b, f.body);
    assert.equal(mangaImageAtPoint(200, 200, f.doc), top);
  });
  it("rejects hidden ancestors and invisible preloaded pages", () => {
    for (const style of [
      { display: "none" },
      { visibility: "hidden" },
      { visibility: "collapse" },
      { opacity: "0" },
      { contentVisibility: "hidden" },
    ]) {
      const f = fixture(),
        parent = f.add("P", pageBox, f.body);
      const img = f.add("IMG", pageBox, parent);
      parent.style = style;
      f.stack(parent, f.body);
      assert.equal(visibleMangaImageRect(image(img)), null);
      assert.equal(mangaImageAtPoint(200, 200, f.doc), null);
    }
  });
  it("clips pages to scrolling reader containers and rejects the clipped portion", () => {
    const f = fixture();
    const reader = f.add(
      "DIV",
      { x: 100, y: 100, width: 150, height: 400 },
      f.body,
    );
    reader.style.overflowX = "hidden";
    reader.style.overflowY = "auto";
    const canvas = f.add("CANVAS", pageBox, reader);
    f.stack(reader, f.body);
    assert.deepEqual(visibleMangaImageRect(image(canvas)), {
      x: 100,
      y: 100,
      width: 150,
      height: 400,
    });
    assert.equal(mangaImageAtPoint(200, 200, f.doc), canvas);
    assert.equal(mangaImageAtPoint(300, 200, f.doc), null);
    assert.equal(mangaImageAtPoint(200, 550, f.doc), null);
  });
  it("accounts for scaled container borders when clipping", () => {
    const f = fixture();
    const reader = f.add(
      "DIV",
      { x: 100, y: 100, width: 400, height: 400 },
      f.body,
    );
    reader.style.overflowX = reader.style.overflowY = "hidden";
    reader.offsetWidth = reader.offsetHeight = 200;
    reader.clientWidth = reader.clientHeight = 180;
    reader.clientLeft = reader.clientTop = 10;
    const canvas = f.add(
      "CANVAS",
      { x: 100, y: 100, width: 400, height: 400 },
      reader,
    );
    assert.deepEqual(visibleMangaImageRect(image(canvas)), {
      x: 120,
      y: 120,
      width: 360,
      height: 360,
    });
  });
  it("clips to the viewport and does not expose an offscreen page", () => {
    const f = fixture();
    const canvas = f.add(
      "CANVAS",
      { x: 900, y: -50, width: 300, height: 200 },
      f.body,
    );
    assert.deepEqual(visibleMangaImageRect(image(canvas)), {
      x: 900,
      y: 0,
      width: 100,
      height: 150,
    });
    canvas.box.x = 1000;
    assert.equal(visibleMangaImageRect(image(canvas)), null);
  });
  it("ignores detached, zero-size, and cleared canvases", () => {
    const f = fixture(),
      canvas = f.add("CANVAS", pageBox, f.body);
    f.stack(f.body);
    canvas.isConnected = false;
    assert.equal(mangaImageAtPoint(200, 200, f.doc), null);
    canvas.isConnected = true;
    canvas.width = 0;
    assert.equal(mangaImageAtPoint(200, 200, f.doc), null);
    canvas.width = 822;
    canvas.box = { ...pageBox, width: 0 };
    assert.equal(mangaImageAtPoint(200, 200, f.doc), null);
  });
  it("does not choose a hidden later sibling or an image with no hit ancestor", () => {
    const f = fixture(),
      visible = f.add("IMG", pageBox, f.body);
    const hidden = f.add("IMG", pageBox, f.body);
    hidden.style.opacity = "0";
    f.stack(f.body);
    assert.equal(mangaImageAtPoint(200, 200, f.doc), visible);
    f.stack();
    assert.equal(mangaImageAtPoint(200, 200, f.doc), null);
  });
  it("intersects only overlapping rectangles", () => {
    assert.equal(
      intersectRects(pageBox, { x: 400, y: 100, width: 100, height: 100 }),
      null,
    );
    assert.deepEqual(
      intersectRects(pageBox, { x: 200, y: 200, width: 400, height: 400 }),
      { x: 200, y: 200, width: 200, height: 400 },
    );
  });
});

describe("current-page candidate selection", () => {
  it("finds a large image with only a short visible portion left after scrolling", () => {
    const f = fixture();
    const img = f.add(
      "IMG",
      { x: 200, y: -920, width: 400, height: 1020 },
      f.body,
    );
    f.stack(img, f.body);
    assert.deepEqual(visibleMangaSpread(f.doc), [img]);
  });
  it("does not treat tiny clipped remnants or navigation icons as a current page", () => {
    const f = fixture();
    const image = f.add(
      "IMG",
      { x: 200, y: -950, width: 400, height: 1020 },
      f.body,
    );
    const icon = f.add("IMG", { x: 20, y: 20, width: 40, height: 40 }, f.body);
    f.stack(image, icon, f.body);
    assert.deepEqual(visibleMangaSpread(f.doc), []);
  });
  it("retains an explicitly chosen visible image instead of jumping to another larger image", () => {
    const f = fixture();
    const chosen = f.add(
      "IMG",
      { x: 100, y: 50, width: 300, height: 600 },
      f.body,
    );
    const large = f.add(
      "IMG",
      { x: 420, y: 10, width: 550, height: 770 },
      f.body,
    );
    f.stack(chosen, large, f.body);
    assert.deepEqual(visibleMangaSpread(f.doc, image(chosen)), [chosen]);
  });
  it("does not clip position: fixed modal images when document has scrolled", () => {
    const f = fixture();
    // Simulate page scrolled by 1200px (e.g. Twitter feed scrolled down)
    f.html.box.y = -1200;
    f.body.box.y = -1200;
    f.html.style.overflowY = "scroll";
    f.body.style.overflowY = "hidden";

    // Fixed modal layer in middle of viewport
    const modal = f.add("DIV", { x: 0, y: 0, width: 1000, height: 800 }, f.body);
    modal.style.position = "fixed";
    const img = f.add("IMG", { x: 200, y: 100, width: 600, height: 600 }, modal);
    img.style.position = "fixed";

    f.stack(img, modal);
    const rect = visibleMangaImageRect(image(img));
    assert.ok(rect);
    assert.deepEqual(rect, { x: 200, y: 100, width: 600, height: 600 });
  });
  it("does not clip position: absolute modal images through intermediate static overflow containers", () => {
    const f = fixture();
    // Simulate page scrolled by 1200px
    f.html.box.y = -1200;
    f.body.box.y = -1200;
    f.html.style.overflowY = "scroll";
    f.body.style.overflowY = "hidden";

    // Fixed modal layer in middle of viewport
    const modal = f.add("DIV", { x: 0, y: 0, width: 1000, height: 800 }, f.body);
    modal.style.position = "fixed";

    // Intermediate static containers with overflow: hidden (like Twitter React Native for Web)
    const flexWrap = f.add("DIV", { x: 0, y: 0, width: 1000, height: 800 }, modal);
    flexWrap.style.overflowX = "hidden";
    flexWrap.style.overflowY = "hidden";

    const img = f.add("IMG", { x: 150, y: 50, width: 700, height: 700 }, flexWrap);
    img.style.position = "absolute";

    f.stack(img, flexWrap, modal);
    const rect = visibleMangaImageRect(image(img));
    assert.ok(rect);
    assert.deepEqual(rect, { x: 150, y: 50, width: 700, height: 700 });
  });
});
