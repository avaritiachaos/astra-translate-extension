export const MANGA_CARD_OPEN_EVENT = "astra-manga-card-open";

/** Keep extension controls out of reader page-turn handlers, including capture. */
export function isolateMangaControls(
  host: HTMLElement,
  root: ShadowRoot,
  onEscape?: () => boolean,
) {
  let pressed = false,
    guardUntil = 0;
  const owns = (event: Event) => event.composedPath().includes(host);
  const block = (event: Event) => {
    const down = event.type === "pointerdown" || event.type === "mousedown";
    if (down) {
      if (!owns(event)) {
        pressed = false;
        guardUntil = 0;
        return;
      }
      pressed = true;
    } else if (!owns(event) && !pressed && Date.now() >= guardUntil) return;
    if (
      event.type === "pointerup" ||
      event.type === "mouseup" ||
      event.type === "pointercancel"
    ) {
      pressed = false;
      guardUntil = Date.now() + 400;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const click = (event: PointerEvent) => {
    if (
      !event.isTrusted ||
      event.button !== 0 ||
      (!owns(event) && !pressed && Date.now() >= guardUntil)
    )
      return;
    block(event);
    pressed = false;
    guardUntil = 0;
    if (!owns(event)) return;
    const button = event
      .composedPath()
      .find(
        (node) => node instanceof HTMLButtonElement && root.contains(node),
      ) as HTMLButtonElement | undefined;
    if (button && !button.disabled) button.onclick?.call(button, event);
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape" && onEscape?.()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (owns(event)) event.stopImmediatePropagation();
  };
  const presses = [
    "pointerdown",
    "pointerup",
    "pointercancel",
    "mousedown",
    "mouseup",
    "dblclick",
  ];
  for (const type of presses)
    window.addEventListener(type, block, { capture: true, passive: false });
  window.addEventListener("click", click, true);
  window.addEventListener("keydown", key, true);
  return () => {
    for (const type of presses) window.removeEventListener(type, block, true);
    window.removeEventListener("click", click, true);
    window.removeEventListener("keydown", key, true);
  };
}
