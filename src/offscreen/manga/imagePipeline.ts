import type {
  MangaSource,
  Tile,
  PositionedRegion,
} from "../../shared/manga/types";
import { imageSourceAllowed } from "../../shared/manga/imageGeometry";
import {
  imageDataUrlToBlob,
  imageBlobToDataUrl,
} from "../../shared/imageAssets";
const MAX_BYTES = 15 * 1024 * 1024;
async function responseImage(response: Response): Promise<Blob> {
  if (!response.ok || !response.body)
    throw new Error("MANGA_SOURCE_UNREADABLE");
  if (Number(response.headers.get("Content-Length")) > MAX_BYTES)
    throw new Error("MANGA_TOO_LARGE");
  const reader = response.body.getReader();
  const parts: BlobPart[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > MAX_BYTES) throw new Error("MANGA_TOO_LARGE");
      parts.push(part.value.slice().buffer);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const blob = new Blob(parts);
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const type =
    header[0] === 137 && header[1] === 80 && header[2] === 78
      ? "image/png"
      : header[0] === 255 && header[1] === 216
        ? "image/jpeg"
        : String.fromCharCode(...header.subarray(0, 4)) === "RIFF" &&
            String.fromCharCode(...header.subarray(8, 12)) === "WEBP"
          ? "image/webp"
          : "";
  if (!type) throw new Error("MANGA_SOURCE_UNREADABLE");
  return new Blob([blob], { type });
}
export async function acquireMangaImage(
  source: MangaSource,
  signal: AbortSignal,
): Promise<{ blob: Blob; probeCode?: string }> {
  if (source.kind === "data")
    return { blob: imageDataUrlToBlob(source.dataUrl, MAX_BYTES) };
  if (source.kind === "probe") {
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const code = Array.from(
      crypto.getRandomValues(new Uint8Array(8)),
      (n) => alphabet[n % alphabet.length],
    ).join("");
    const canvas = new OffscreenCanvas(640, 180),
      ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 640, 180);
    ctx.fillStyle = "#111";
    ctx.font = "bold 48px Arial";
    ctx.fillText("ASTRA " + code, 28, 104);
    return {
      blob: await canvas.convertToBlob({ type: "image/png" }),
      probeCode: code,
    };
  }
  if (!imageSourceAllowed(source.url, source.pageOrigin))
    throw new Error("MANGA_SOURCE_UNREADABLE");
  const controller = new AbortController(),
    relay = () => controller.abort();
  signal.addEventListener("abort", relay, { once: true });
  if (signal.aborted) relay();
  const timer = setTimeout(relay, 20_000);
  try {
    return {
      blob: await responseImage(
        await fetch(source.url, {
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
          referrerPolicy: "no-referrer",
        }),
      ),
    };
  } catch (error) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (error instanceof Error && error.message === "MANGA_TOO_LARGE")
      throw error;
    throw new Error("MANGA_SOURCE_UNREADABLE");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", relay);
  }
}
export async function encodeMangaTile(bitmap: ImageBitmap, tile: Tile) {
  const scale = Math.min(1, 2048 / Math.max(tile.width, tile.height));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(tile.width * scale)),
    Math.max(1, Math.round(tile.height * scale)),
  );
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    bitmap,
    tile.x,
    tile.y,
    tile.width,
    tile.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  let blob = await canvas.convertToBlob({ type: "image/png" });
  if (blob.size > 4 * 1024 * 1024)
    blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  if (blob.size > 4 * 1024 * 1024) throw new Error("MANGA_TOO_LARGE");
  return { canvas, dataUrl: await imageBlobToDataUrl(blob) };
}
export function regionBackground(
  canvas: OffscreenCanvas,
  tile: Tile,
  region: PositionedRegion,
) {
  const ctx = canvas.getContext("2d")!;
  const sx = canvas.width / tile.width,
    sy = canvas.height / tile.height;
  const x0 = Math.max(0, Math.floor((region.rect.x - tile.x) * sx) - 3),
    y0 = Math.max(0, Math.floor((region.rect.y - tile.y) * sy) - 3);
  const x1 = Math.min(
      canvas.width - 1,
      Math.ceil((region.rect.x + region.rect.width - tile.x) * sx) + 3,
    ),
    y1 = Math.min(
      canvas.height - 1,
      Math.ceil((region.rect.y + region.rect.height - tile.y) * sy) + 3,
    );
  const samples: number[][] = [];
  for (let i = 0; i < 8; i++)
    for (const y of [y0, y1]) {
      const x = Math.round(x0 + ((x1 - x0) * i) / 7);
      samples.push(Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3));
    }
  const rgb = [0, 1, 2].map((channel) =>
    Math.round(samples.reduce((n, p) => n + p[channel], 0) / samples.length),
  );
  const variance = Math.max(
    ...samples.map((p) => Math.max(...p.map((v, i) => Math.abs(v - rgb[i])))),
  );
  return {
    color: "rgb(" + rgb.join(",") + ")",
    flat: variance < 18 && Math.min(...rgb) > 170,
  };
}
export async function digest(value: Blob | string): Promise<string> {
  const input =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : await value.arrayBuffer();
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", input)),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
