import type { Rect, Tile } from "./types.ts";
export function planTiles(width: number, height: number): Tile[] {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 24_000_000
  )
    throw new Error("MANGA_TOO_LARGE");
  if (
    width <= 2600 &&
    height <= 2600 &&
    Math.max(width / height, height / width) < 2.5
  )
    return [{ index: 0, x: 0, y: 0, width, height }];
  const spanX = Math.min(width, 1800),
    spanY = Math.min(height, 1800),
    overlap = 128;
  const positions = (total: number, span: number) => {
    const values = [0];
    while (values[values.length - 1] + span < total)
      values.push(
        Math.min(total - span, values[values.length - 1] + span - overlap),
      );
    return values;
  };
  const tiles: Tile[] = [];
  for (const y of positions(height, spanY))
    for (const x of positions(width, spanX))
      tiles.push({ index: tiles.length, x, y, width: spanX, height: spanY });
  if (tiles.length > 24) throw new Error("MANGA_TOO_LARGE");
  return tiles;
}
export function imagePlacement(
  naturalWidth: number,
  naturalHeight: number,
  box: Rect,
  fit: string,
  position: string,
): Rect {
  if (fit === "fill") return box;
  const contain = Math.min(
    box.width / naturalWidth,
    box.height / naturalHeight,
  );
  const scale =
    fit === "cover"
      ? Math.max(box.width / naturalWidth, box.height / naturalHeight)
      : fit === "none"
        ? 1
        : fit === "scale-down"
          ? Math.min(1, contain)
          : contain;
  const width = naturalWidth * scale,
    height = naturalHeight * scale;
  const tokens = position.trim().split(/\s+/);
  if (tokens.length > 2) throw new Error("MANGA_LAYOUT_UNSUPPORTED");
  const offset = (value: string, space: number) => {
    if (value === "left" || value === "top") return 0;
    if (value === "right" || value === "bottom") return space;
    if (value === "center") return space / 2;
    if (/^[-\d.]+%$/.test(value)) return (parseFloat(value) / 100) * space;
    if (/^[-\d.]+px$/.test(value)) return parseFloat(value);
    throw new Error("MANGA_LAYOUT_UNSUPPORTED");
  };
  return {
    x: box.x + offset(tokens[0] || "50%", box.width - width),
    y: box.y + offset(tokens[1] || "50%", box.height - height),
    width,
    height,
  };
}
export function imageSourceAllowed(
  source: string,
  pageOrigin: string,
): boolean {
  try {
    const url = new URL(source);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password)
      return false;
    if (url.origin === pageOrigin) return true;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host === "::" ||
      host === "::1" ||
      /^(?:fc|fd|fe8|fe9|fea|feb)[\da-f:]*:/i.test(host) ||
      /^(?:0|10|127)\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
      host.startsWith("::ffff:")
    )
      return false;
    return true;
  } catch {
    return false;
  }
}
