// A popover can be removed from the top layer by a fullscreen transition.
// Move it into the current fullscreen subtree and show it again afterwards.
export function followMangaFullscreen(
  host: HTMLElement,
  changed: () => void,
): () => void {
  const mount = () => {
    const parent =
      document.fullscreenElement ?? document.body ?? document.documentElement;
    if (host.parentElement !== parent) parent.append(host);
    host.showPopover?.();
  };
  const update = () => {
    mount();
    changed();
  };
  mount();
  document.addEventListener("fullscreenchange", update);
  return () => document.removeEventListener("fullscreenchange", update);
}
