import { t, type UiLanguage } from "../../shared/i18n";
import { followMangaFullscreen } from "./mangaFullscreen";
import {
  mangaImageAtPoint,
  visibleMangaImageRect,
  visibleMangaSpread,
  type MangaImage,
} from "./mangaImage";

export function createMangaPicker(
  language: UiLanguage,
  onPick: (images: MangaImage[]) => void,
  onClose: () => void,
): () => void {
  const surface = document.createElement("div"),
    bar = document.createElement("div"),
    cancel = document.createElement("button"),
    spread = document.createElement("button");
  surface.className = "ast-manga-picker-surface";
  surface.setAttribute("popover", "manual");
  bar.className = "ast-manga-picker";
  Object.assign(surface.style, {
    all: "initial",
    position: "fixed",
    inset: "0",
    margin: "0",
    padding: "0",
    width: "100%",
    height: "100%",
    maxWidth: "none",
    maxHeight: "none",
    border: "0",
    background: "transparent",
    overflow: "hidden",
    zIndex: "2147483645",
    pointerEvents: "auto",
    cursor: "crosshair",
  });
  Object.assign(bar.style, {
    all: "initial",
    position: "fixed",
    top: "14px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "8px 10px 8px 14px",
    borderRadius: "14px",
    background: "#282631f5",
    color: "#fff",
    boxShadow: "0 5px 25px #17132930",
    font: "13px system-ui",
    cursor: "default",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    maxWidth: "calc(100vw - 24px)",
  });
  const hint = document.createElement("span");
  hint.textContent = t(language, "manga.pickHint");
  bar.append(hint, spread, cancel);
  for (const button of [spread, cancel]) {
    button.type = "button";
    Object.assign(button.style, {
      all: "initial",
      font: "13px system-ui",
      color: "#fff",
      background: "#ffffff18",
      borderRadius: "9px",
      padding: "8px 10px",
      cursor: "pointer",
      whiteSpace: "nowrap",
    });
  }
  spread.textContent = t(language, "manga.translateSpread");
  spread.style.background = "#7664e5";
  cancel.textContent = t(language, "manga.cancel");
  const outlines = [0, 1].map((index) => {
    const element = document.createElement("div");
    element.className = "ast-manga-picker-outline";
    element.dataset.page = String(index);
    Object.assign(element.style, {
      all: "initial",
      position: "fixed",
      boxSizing: "border-box",
      pointerEvents: "none",
      border: "3px solid #8070f3",
      borderRadius: "5px",
      background: "#8070f30a",
      display: "none",
    });
    surface.append(element);
    return element;
  });
  surface.append(bar);
  let point: { x: number; y: number } | undefined,
    closed = false;
  const draw = (images: MangaImage[]) => {
    outlines.forEach((outline, index) => {
      const rect = images[index] && visibleMangaImageRect(images[index]);
      if (!rect) {
        outline.style.display = "none";
        return;
      }
      Object.assign(outline.style, {
        display: "block",
        left: rect.x + "px",
        top: rect.y + "px",
        width: rect.width + "px",
        height: rect.height + "px",
      });
    });
  };
  const refresh = () => {
    const pair = visibleMangaSpread();
    spread.hidden = pair.length !== 2;
    const image = point && mangaImageAtPoint(point.x, point.y);
    draw(image ? [image] : []);
    surface.style.cursor = image ? "crosshair" : "not-allowed";
  };
  const stopFollowing = followMangaFullscreen(surface, refresh);
  const onControls = (event: Event) => event.composedPath().includes(bar);
  const block = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const move = (event: PointerEvent) => {
    if (onControls(event)) {
      draw(event.composedPath().includes(spread) ? visibleMangaSpread() : []);
      return;
    }
    point = { x: event.clientX, y: event.clientY };
    refresh();
    event.stopImmediatePropagation();
  };
  const finish = (images: MangaImage[]) => {
    if (!images.length) return;
    stop();
    onPick(images);
  };
  const click = (event: MouseEvent) => {
    if (!event.isTrusted || event.button !== 0) return;
    block(event);
    if (event.composedPath().includes(cancel)) {
      stop();
      return;
    }
    if (event.composedPath().includes(spread)) {
      const pair = visibleMangaSpread();
      if (pair.length === 2) finish(pair);
      return;
    }
    if (onControls(event)) return;
    const image = mangaImageAtPoint(event.clientX, event.clientY);
    if (image) finish([image]);
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      block(event);
      stop();
    }
  };
  const presses = [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "contextmenu",
    "dblclick",
  ];
  const stop = () => {
    if (closed) return;
    closed = true;
    stopFollowing();
    surface.remove();
    for (const type of presses) window.removeEventListener(type, block, true);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("click", click, true);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("scroll", refresh, true);
    window.removeEventListener("resize", refresh);
    onClose();
  };
  for (const type of presses)
    window.addEventListener(type, block, { capture: true, passive: false });
  window.addEventListener("pointermove", move, true);
  window.addEventListener("click", click, true);
  window.addEventListener("keydown", key, true);
  window.addEventListener("scroll", refresh, { capture: true, passive: true });
  window.addEventListener("resize", refresh);
  refresh();
  return stop;
}
