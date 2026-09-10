import {
  dockPoint,
  normalizedDockPosition,
  validDockPosition,
  type DockPosition,
} from "../../shared/manga/dockGeometry";

export const MANGA_DOCK_POSITION_KEY = "astra_manga_dock_position";
/** Drag only the grip; buttons keep their normal click behavior. */
export function makeMangaDockDraggable(
  host: HTMLElement,
  grip: HTMLButtonElement,
  moved: () => void,
) {
  let position: DockPosition | undefined;
  let touched = false,
    disposed = false,
    ignoreClickUntil = 0;
  let active:
    { id: number; x: number; y: number; left: number; top: number } | undefined;
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
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const pointerDown = (event: PointerEvent) => {
    if (!event.isTrusted || event.button !== 0) return;
    if (!ownsGrip(event)) {
      if (!active) ignoreClickUntil = 0;
      return;
    }
    stop(event);
    touched = true;
    const rect = host.getBoundingClientRect();
    active = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    grip.setPointerCapture(event.pointerId);
    grip.style.cursor = "grabbing";
    document.dispatchEvent(new Event("astra-manga-dock-move"));
  };
  const pointerMove = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.id) return;
    stop(event);
    position = normalizedDockPosition(
      {
        x: active.left + event.clientX - active.x,
        y: active.top + event.clientY - active.y,
      },
      host.getBoundingClientRect(),
      viewport(),
    );
    layout();
  };
  const pointerUp = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.id) return;
    stop(event);
    ignoreClickUntil = Date.now() + 500;
    if (grip.hasPointerCapture(event.pointerId))
      grip.releasePointerCapture(event.pointerId);
    active = undefined;
    grip.style.cursor = "";
    save();
  };
  const mouse = (event: Event) => {
    if (ownsGrip(event) || active || Date.now() < ignoreClickUntil) stop(event);
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
  window.addEventListener("pointerdown", pointerDown, true);
  window.addEventListener("pointermove", pointerMove, true);
  window.addEventListener("pointerup", pointerUp, true);
  window.addEventListener("pointercancel", pointerUp, true);
  for (const type of ["mousedown", "mouseup", "click"])
    window.addEventListener(type, mouse, true);
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
      disposed = true;
      observer.disconnect();
      window.removeEventListener("pointerdown", pointerDown, true);
      window.removeEventListener("pointermove", pointerMove, true);
      window.removeEventListener("pointerup", pointerUp, true);
      window.removeEventListener("pointercancel", pointerUp, true);
      for (const type of ["mousedown", "mouseup", "click"])
        window.removeEventListener(type, mouse, true);
      window.removeEventListener("dblclick", doubleClick, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", layout);
    },
  };
}
