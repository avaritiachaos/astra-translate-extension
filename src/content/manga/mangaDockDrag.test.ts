import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { makeMangaDockDraggable } from "./mangaDockDrag.ts";

class MockElement {
  style: Record<string, string> = {};
  classList = {
    _classes: new Set<string>(),
    add(cls: string) {
      this._classes.add(cls);
    },
    remove(cls: string) {
      this._classes.delete(cls);
    },
    contains(cls: string) {
      return this._classes.has(cls);
    },
  };
  capturedPointerId: number | null = null;
  isConnected = true;
  rect = { left: 500, top: 700, width: 120, height: 40 };

  getBoundingClientRect() {
    return {
      x: this.rect.left,
      y: this.rect.top,
      left: this.rect.left,
      top: this.rect.top,
      width: this.rect.width,
      height: this.rect.height,
      right: this.rect.left + this.rect.width,
      bottom: this.rect.top + this.rect.height,
    };
  }

  setPointerCapture(id: number) {
    this.capturedPointerId = id;
  }

  releasePointerCapture(id: number) {
    if (this.capturedPointerId === id) this.capturedPointerId = null;
  }

  hasPointerCapture(id: number) {
    return this.capturedPointerId === id;
  }
}

class MockEvent {
  type: string;
  init: {
    pointerId?: number;
    clientX?: number;
    clientY?: number;
    button?: number;
    isTrusted?: boolean;
    pointerType?: string;
    composedPath?: any[];
  };
  defaultPrevented = false;
  immediatePropagationStopped = false;

  constructor(
    type: string,
    init: {
      pointerId?: number;
      clientX?: number;
      clientY?: number;
      button?: number;
      isTrusted?: boolean;
      pointerType?: string;
      composedPath?: any[];
    } = {},
  ) {
    this.type = type;
    this.init = init;
  }

  get pointerId() {
    return this.init.pointerId ?? 1;
  }
  get clientX() {
    return this.init.clientX ?? 0;
  }
  get clientY() {
    return this.init.clientY ?? 0;
  }
  get button() {
    return this.init.button ?? 0;
  }
  get buttons() {
    return this.init.buttons ?? 1;
  }
  get isTrusted() {
    return this.init.isTrusted ?? true;
  }
  get pointerType() {
    return this.init.pointerType ?? "mouse";
  }
  composedPath() {
    return this.init.composedPath ?? [];
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopImmediatePropagation() {
    this.immediatePropagationStopped = true;
  }
}

describe("makeMangaDockDraggable handles", () => {
  let originalWindow: any;
  let originalDocument: any;
  let originalChrome: any;
  let originalResizeObserver: any;
  let listeners: Record<string, ((e: any) => void)[]> = {};

  beforeEach(() => {
    listeners = {};
    originalWindow = (globalThis as any).window;
    originalDocument = (globalThis as any).document;
    originalChrome = (globalThis as any).chrome;
    originalResizeObserver = (globalThis as any).ResizeObserver;

    (globalThis as any).innerWidth = 1200;
    (globalThis as any).innerHeight = 800;

    (globalThis as any).window = {
      innerWidth: 1200,
      innerHeight: 800,
      addEventListener(type: string, fn: (e: any) => void) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      removeEventListener(type: string, fn: (e: any) => void) {
        if (listeners[type]) {
          listeners[type] = listeners[type].filter((cb) => cb !== fn);
        }
      },
    };

    (globalThis as any).document = {
      dispatchEvent: () => true,
    };

    (globalThis as any).Event = class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    };

    (globalThis as any).chrome = {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
          remove: async () => {},
        },
      },
    };

    (globalThis as any).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
    (globalThis as any).chrome = originalChrome;
    (globalThis as any).ResizeObserver = originalResizeObserver;
  });

  function fire(type: string, event: MockEvent) {
    for (const fn of listeners[type] || []) {
      fn(event);
      if (event.immediatePropagationStopped) break;
    }
  }

  it("discriminates drag from click on interactive handle (trigger)", () => {
    const host = new MockElement() as any;
    const grip = new MockElement() as any;
    const trigger = new MockElement() as any;
    let movedCalls = 0;

    const drag = makeMangaDockDraggable(host, grip, () => movedCalls++, [trigger]);

    // 1. Normal tap/click: pointerdown, move 1px, pointerup -> click should NOT be stopped
    const downEvt = new MockEvent("pointerdown", {
      clientX: 550,
      clientY: 720,
      composedPath: [trigger, host],
    });
    fire("pointerdown", downEvt);
    assert.equal(downEvt.immediatePropagationStopped, false, "pointerdown on trigger does not block");

    const smallMoveEvt = new MockEvent("pointermove", {
      clientX: 551,
      clientY: 721,
      composedPath: [trigger, host],
    });
    fire("pointermove", smallMoveEvt);
    assert.equal(smallMoveEvt.immediatePropagationStopped, false, "small move below 4px does not drag");

    const upEvt = new MockEvent("pointerup", {
      clientX: 551,
      clientY: 721,
      composedPath: [trigger, host],
    });
    fire("pointerup", upEvt);
    assert.equal(upEvt.immediatePropagationStopped, false, "pointerup without move does not block");

    const clickEvt = new MockEvent("click", {
      composedPath: [trigger, host],
    });
    fire("click", clickEvt);
    assert.equal(clickEvt.immediatePropagationStopped, false, "click event fires through to trigger button");

    // 2. Drag action: pointerdown, move 20px -> should capture and move host
    const downDrag = new MockEvent("pointerdown", {
      clientX: 550,
      clientY: 720,
      composedPath: [trigger, host],
    });
    fire("pointerdown", downDrag);

    const bigMove = new MockEvent("pointermove", {
      clientX: 600,
      clientY: 700,
      composedPath: [trigger, host],
    });
    fire("pointermove", bigMove);
    assert.equal(bigMove.immediatePropagationStopped, true, "big move begins drag and stops propagation");
    assert.ok(movedCalls > 0, "moved() called during drag");
    assert.equal(trigger.capturedPointerId, 1, "trigger has pointer capture");
    assert.equal(trigger.style.cursor, "grabbing");

    const upDrag = new MockEvent("pointerup", {
      clientX: 600,
      clientY: 700,
      composedPath: [trigger, host],
    });
    fire("pointerup", upDrag);
    assert.equal(upDrag.immediatePropagationStopped, true, "pointerup after drag stops propagation");
    assert.equal(trigger.capturedPointerId, null, "pointer capture released");

    // Trailing click immediately following drag must be blocked!
    const dragClick = new MockEvent("click", {
      composedPath: [trigger, host],
    });
    fire("click", dragClick);
    assert.equal(dragClick.immediatePropagationStopped, true, "trailing click after drag is suppressed");

    drag.dispose();
  });

  it("grip immediately starts drag on pointerdown", () => {
    const host = new MockElement() as any;
    const grip = new MockElement() as any;
    let movedCalls = 0;

    const drag = makeMangaDockDraggable(host, grip, () => movedCalls++);

    const downEvt = new MockEvent("pointerdown", {
      clientX: 550,
      clientY: 720,
      composedPath: [grip, host],
    });
    fire("pointerdown", downEvt);
    assert.equal(downEvt.immediatePropagationStopped, true, "grip stops pointerdown immediately");
    assert.equal(grip.capturedPointerId, 1, "grip captures pointer immediately");
    assert.equal(grip.style.cursor, "grabbing");

    drag.dispose();
  });

  it("terminates drag immediately if pointermove occurs with buttons === 0 (mouse released outside window)", () => {
    const host = new MockElement() as any;
    const grip = new MockElement() as any;
    let movedCalls = 0;

    const drag = makeMangaDockDraggable(host, grip, () => movedCalls++);

    // Start drag
    fire(
      "pointerdown",
      new MockEvent("pointerdown", {
        clientX: 500,
        clientY: 500,
        composedPath: [grip, host],
      }),
    );
    assert.equal(grip.style.cursor, "grabbing");

    // Move with buttons: 0 (simulates mouse released outside window)
    const zeroButtonsMove = new MockEvent("pointermove", {
      clientX: 510,
      clientY: 510,
      buttons: 0,
      pointerType: "mouse",
      composedPath: [grip, host],
    });
    fire("pointermove", zeroButtonsMove);

    // Should have terminated drag
    assert.equal(grip.style.cursor, "");
    assert.equal(grip.capturedPointerId, null);

    drag.dispose();
  });

  it("terminates drag and clears grabbing cursor on lostpointercapture", () => {
    const host = new MockElement() as any;
    const grip = new MockElement() as any;
    let movedCalls = 0;

    const drag = makeMangaDockDraggable(host, grip, () => movedCalls++);

    fire(
      "pointerdown",
      new MockEvent("pointerdown", {
        clientX: 500,
        clientY: 500,
        composedPath: [grip, host],
      }),
    );
    assert.equal(grip.style.cursor, "grabbing");

    fire(
      "lostpointercapture",
      new MockEvent("lostpointercapture", {
        pointerId: 1,
        composedPath: [grip, host],
      }),
    );

    assert.equal(grip.style.cursor, "");
    assert.equal(grip.capturedPointerId, null);

    drag.dispose();
  });

  it("terminates drag and clears grabbing cursor on window blur", () => {
    const host = new MockElement() as any;
    const grip = new MockElement() as any;
    let movedCalls = 0;

    const drag = makeMangaDockDraggable(host, grip, () => movedCalls++);

    fire(
      "pointerdown",
      new MockEvent("pointerdown", {
        clientX: 500,
        clientY: 500,
        composedPath: [grip, host],
      }),
    );
    assert.equal(grip.style.cursor, "grabbing");

    fire("blur", new MockEvent("blur"));

    assert.equal(grip.style.cursor, "");
    assert.equal(grip.capturedPointerId, null);

    drag.dispose();
  });

  it("mouseup event terminates active drag and restores cursor", () => {
    const host = new MockElement() as any;
    const grip = new MockElement() as any;
    let movedCalls = 0;

    const drag = makeMangaDockDraggable(host, grip, () => movedCalls++);

    fire(
      "pointerdown",
      new MockEvent("pointerdown", {
        clientX: 500,
        clientY: 500,
        composedPath: [grip, host],
      }),
    );
    assert.equal(grip.style.cursor, "grabbing");

    fire(
      "mouseup",
      new MockEvent("mouseup", {
        composedPath: [grip, host],
      }),
    );

    assert.equal(grip.style.cursor, "");
    assert.equal(grip.capturedPointerId, null);

    drag.dispose();
  });
});
