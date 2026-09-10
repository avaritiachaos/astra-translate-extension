import type { Rect } from "./types.ts";
export interface DockPosition {
  x: number;
  y: number;
}
export interface BoxSize {
  width: number;
  height: number;
}
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

export function validDockPosition(value: unknown): value is DockPosition {
  const p = value as DockPosition | null;
  return (
    !!p &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    p.x >= 0 &&
    p.x <= 1 &&
    p.y >= 0 &&
    p.y <= 1
  );
}
export function dockPoint(
  position: DockPosition,
  box: BoxSize,
  viewport: BoxSize,
): { x: number; y: number } {
  return {
    x:
      8 +
      clamp(position.x, 0, 1) * Math.max(0, viewport.width - box.width - 16),
    y:
      8 +
      clamp(position.y, 0, 1) * Math.max(0, viewport.height - box.height - 16),
  };
}
export function normalizedDockPosition(
  point: { x: number; y: number },
  box: BoxSize,
  viewport: BoxSize,
): DockPosition {
  return {
    x: clamp(
      (point.x - 8) / Math.max(1, viewport.width - box.width - 16),
      0,
      1,
    ),
    y: clamp(
      (point.y - 8) / Math.max(1, viewport.height - box.height - 16),
      0,
      1,
    ),
  };
}
export function panelAtDock(
  dock: Rect,
  size: BoxSize,
  viewport: BoxSize,
): Rect {
  const width = Math.min(size.width, Math.max(0, viewport.width - 24));
  const above = Math.max(0, dock.y - 20),
    below = Math.max(0, viewport.height - dock.y - dock.height - 20);
  const useAbove = above >= size.height || above >= below;
  const height = Math.min(size.height, useAbove ? above : below);
  return {
    x: clamp(
      dock.x + dock.width - width,
      12,
      Math.max(12, viewport.width - width - 12),
    ),
    y: useAbove ? dock.y - height - 8 : dock.y + dock.height + 8,
    width,
    height,
  };
}
