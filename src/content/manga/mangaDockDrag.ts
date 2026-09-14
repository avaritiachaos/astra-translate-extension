import {
  dockPoint,
  normalizedDockPosition,
  validDockPosition,
  type DockPosition,
} from "../../shared/manga/dockGeometry.ts";

export const MANGA_DOCK_POSITION_KEY = "astra_manga_dock_position";

/** Drag grip directly; interactive buttons (trigger, compact) require movement threshold to keep normal click behavior. */
export function makeMangaDockDraggable(
  host: HTMLElement,
  grip: HTMLButtonElement,
  moved: () => void,
  interactiveHandles: HTMLElement[] = [],
) {
  let position: DockPosition | undefined;
  let touched = false,
    disposed = false,
    ignoreClickUntil = 0;
  let active:
    | {
        id: number;
        handle: HTMLElement;
        isDedicated: boolean;
        startX: number;
        startY: number;
        left: number;
        top: number;
        hasMoved: boolean;
      }
    | undefined;
  const viewport = () => ({ width: innerWidth, height: innerHeight });
  const save = () => {
    if (position)
      void chrome.storage.local
        .set({ [MANGA_DOCK_POSITION_KEY]: position })
        .catch(() => {});
    else
      void chrome.storage.local.remove(MANGA_DOCK_POSITION_KEY).catch(() => {});
  };
  const layout = () => {
    if (disposed || !host.isConnected) return;
    if (position) {
      const p = dockPoint(position, host.getBoundingClientRect(), viewport());
      Object.assign(host.style, {
        left: p.x + "px",
        top: p.y + "px",
        right: "auto",
        bottom: "auto",
        transform: "none",
      });
    } else
      Object.assign(host.style, {
        left: "50%",
        top: "auto",
        right: "auto",
        bottom: "16px",
        transform: "translateX(-50%)",
      });
    moved();
  };
  const reset = () => {
    touched = true;
    position = undefined;
    layout();
    save();
  };
  const ownsGrip = (event: Event) => event.composedPath().includes(grip);
  const ownsHandle = (
    event: Event,
  ): { handle: HTMLElement; isDedicated: boolean } | null => {
    const path = event.composedPath();
    if (path.includes(grip)) return { handle: grip, isDedicated: true };
    for (const h of interactiveHandles) {
      if (path.includes(h)) return { handle: h, isDedicated: false };
    }
    return null;
  };
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const endDrag = (event?: Event) => {
    if (!active) return;
    const currentHandle = active.handle;
    const wasMoved = active.hasMoved;
    const isDedicated = active.isDedicated;
    const pointerId = active.id;
    active = undefined;

    if (wasMoved || isDedicated) {
      if (event) stop(event);
      ignoreClickUntil = Date.now() + 250;
      if (wasMoved) {
        save();
      }
    }
    if (currentHandle) {
      try {
        if (pointerId !== undefined && currentHandle.hasPointerCapture?.(pointerId)) {
          currentHandle.releasePointerCapture(pointerId);
        }
      } catch {}
      currentHandle.style.cursor = "";
      currentHandle.classList.remove("dragging");
    }
  };
  const pointerDown = (event: PointerEvent) => {
    if (!event.isTrusted || event.button !== 0) return;
    if (active) {
      endDrag();
    }
    const match = ownsHandle(event);
    if (!match) {
      ignoreClickUntil = 0;
      return;
    }
    const rect = host.getBoundingClientRect();
    if (match.isDedicated) {
      stop(event);
      touched = true;
      active = {
        id: event.pointerId,
        handle: grip,
        isDedicated: true,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        hasMoved: true,
      };
      try {
        grip.setPointerCapture(event.pointerId);
      } catch {}
      grip.style.cursor = "grabbing";
      grip.classList.add("dragging");
      document.dispatchEvent(new Event("astra-manga-dock-move"));
    } else {
      active = {
        id: event.pointerId,
        handle: match.handle,
        isDedicated: false,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        hasMoved: false,
      };
    }
  };
  const pointerMove = (event: PointerEvent) => {
    if (!active) return;
    // Release immediately if mouse button is not held
    if (
      (event.pointerType === "mouse" || event.pointerType === "") &&
      event.buttons === 0
    ) {
      endDrag(event);
      return;
    }
    if (event.pointerId !== active.id) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (!active.hasMoved) {
      const threshold = event.pointerType === "touch" ? 8 : 4;
      if (Math.hypot(dx, dy) < threshold) return;
      active.hasMoved = true;
      touched = true;
      try {
        active.handle.setPointerCapture(event.pointerId);
      } catch {}
      active.handle.style.cursor = "grabbing";
      active.handle.classList.add("dragging");
      document.dispatchEvent(new Event("astra-manga-dock-move"));
    }
    stop(event);
    position = normalizedDockPosition(
      {
        x: active.left + dx,
        y: active.top + dy,
      },
      host.getBoundingClientRect(),
      viewport(),
    );
    layout();
  };
  const pointerUp = (event: PointerEvent) => {
    if (!active) return;
    if (
      event.pointerId === active.id ||
      event.pointerType === "mouse" ||
      event.buttons === 0
    ) {
      endDrag(event);
    }
  };
  const mouse = (event: Event) => {
    if (event.type === "mouseup" && active) {
      endDrag(event);
      return;
    }
    if (
      (ownsGrip(event) &&
        (event.type === "mousedown" ||
          event.type === "mouseup" ||
          event.type === "click")) ||
      (active?.hasMoved && ownsHandle(event)) ||
      (Date.now() < ignoreClickUntil && ownsHandle(event))
    ) {
      stop(event);
    }
  };
  const doubleClick = (event: MouseEvent) => {
    if (event.isTrusted && ownsGrip(event)) {
      stop(event);
      reset();
    }
  };
  const key = (event: KeyboardEvent) => {
    if (!ownsGrip(event)) return;
    if (event.key === "Home") {
      stop(event);
      reset();
      return;
    }
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const delta = directions[event.key];
    if (!delta) return;
    stop(event);
    touched = true;
    const rect = host.getBoundingClientRect(),
      step = event.shiftKey ? 30 : 10;
    position = normalizedDockPosition(
      { x: rect.x + delta[0] * step, y: rect.y + delta[1] * step },
      rect,
      viewport(),
    );
    layout();
    save();
  };
  const onDragStart = (event: DragEvent) => {
    if (ownsHandle(event)) {
      event.preventDefault();
    }
  };
  const onBlur = () => endDrag();
  window.addEventListener("pointerdown", pointerDown, true);
  window.addEventListener("pointermove", pointerMove, true);
  window.addEventListener("pointerup", pointerUp, true);
  window.addEventListener("pointercancel", pointerUp, true);
  window.addEventListener("lostpointercapture", pointerUp, true);
  window.addEventListener("blur", onBlur);
  for (const type of ["mousedown", "mouseup", "click"])
    window.addEventListener(type, mouse, true);
  window.addEventListener("dragstart", onDragStart, true);
  window.addEventListener("dblclick", doubleClick, true);
  window.addEventListener("keydown", key, true);
  window.addEventListener("resize", layout);
  const observer = new ResizeObserver(layout);
  observer.observe(host);
  void chrome.storage.local
    .get(MANGA_DOCK_POSITION_KEY)
    .then((saved) => {
      if (
        disposed ||
        touched ||
        !validDockPosition(saved[MANGA_DOCK_POSITION_KEY])
      )
        return;
      position = saved[MANGA_DOCK_POSITION_KEY];
      layout();
    })
    .catch(() => {});
  return {
    layout,
    dispose() {
      endDrag();
      disposed = true;
      observer.disconnect();
      window.removeEventListener("pointerdown", pointerDown, true);
      window.removeEventListener("pointermove", pointerMove, true);
      window.removeEventListener("pointerup", pointerUp, true);
      window.removeEventListener("pointercancel", pointerUp, true);
      window.removeEventListener("lostpointercapture", pointerUp, true);
      window.removeEventListener("blur", onBlur);
      for (const type of ["mousedown", "mouseup", "click"])
        window.removeEventListener(type, mouse, true);
      window.removeEventListener("dragstart", onDragStart, true);
      window.removeEventListener("dblclick", doubleClick, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", layout);
    },
  };
}
