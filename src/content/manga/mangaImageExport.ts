// ============================================================
// Astra Translate - Manga Translated Image Exporter
// ============================================================

import type { PositionedRegion, MangaFontFamily, MangaBubbleTheme } from "../../shared/manga/types.ts";
import { resolveBubbleColor } from "../../shared/manga/bubbleTheme.ts";
import type { MangaImage } from "./mangaImage.ts";

export const FONT_FAMILY_MAP: Record<MangaFontFamily, string> = {
  sans: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  rounded: '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "Comic Sans MS", "Quicksand", sans-serif',
  comic: '"Impact", "SimHei", "Microsoft YaHei", "PingFang SC", sans-serif',
  serif: '"Songti SC", "SimSun", "Noto Serif CJK SC", serif',
};

export function wrapHorizontalLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  if (!text) return [];
  const lines: string[] = [];
  const paragraphs = text.split("\n");
  for (const para of paragraphs) {
    if (!para) {
      lines.push("");
      continue;
    }
    let currentLine = "";
    for (const char of para) {
      const test = currentLine + char;
      if (ctx.measureText(test).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = test;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
  }
  return lines;
}

export function wrapVerticalColumns(
  text: string,
  maxCharsPerCol: number,
): string[] {
  if (!text) return [];
  const columns: string[] = [];
  const clean = text.replace(/\r?\n/g, " ");
  let currentCol = "";
  for (const char of clean) {
    if (currentCol.length >= maxCharsPerCol) {
      columns.push(currentCol);
      currentCol = char;
    } else {
      currentCol += char;
    }
  }
  if (currentCol) columns.push(currentCol);
  return columns;
}

async function getCleanDrawableImage(image: MangaImage): Promise<CanvasImageSource> {
  if (!("src" in image)) return image;
  const src = (image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src;
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) return image;

  try {
    const res = await fetch(src);
    const blob = await res.blob();
    if (typeof createImageBitmap === "function") {
      return await createImageBitmap(blob);
    }
  } catch {
    // ignore
  }
  return image;
}

export async function exportMangaImageToBlob(
  image: MangaImage,
  regions: PositionedRegion[],
  fontFamily: MangaFontFamily = "sans",
  bubbleTheme: MangaBubbleTheme = "auto",
): Promise<{ blob: Blob; filename: string }> {
  const width = "naturalWidth" in image && image.naturalWidth ? image.naturalWidth : image.width;
  const height = "naturalHeight" in image && image.naturalHeight ? image.naturalHeight : image.height;

  if (!width || !height) {
    throw new Error("MANGA_IMAGE_EMPTY");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("CANVAS_CONTEXT_FAILED");
  }

  // 1. Draw base manga image
  const drawable = await getCleanDrawableImage(image);
  ctx.drawImage(drawable, 0, 0, width, height);
  if ("close" in drawable && typeof (drawable as any).close === "function") {
    (drawable as any).close();
  }

  const fontStack = FONT_FAMILY_MAP[fontFamily] || FONT_FAMILY_MAP.sans;

  // 2. Draw translated speech bubbles
  for (const region of regions) {
    const text = (region.translatedText || "").trim();
    if (!text) continue;

    const b = region.bubble || region.rect;
    if (!b || b.width <= 0 || b.height <= 0) continue;

    const colorStyle = resolveBubbleColor(region.background, bubbleTheme);

    // Fill background bubble
    ctx.save();
    ctx.fillStyle = colorStyle.backgroundColor;
    const radius = Math.min(12, Math.max(3, Math.min(b.width, b.height) * 0.15));
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(b.x, b.y, b.width, b.height, radius);
    } else {
      ctx.rect(b.x, b.y, b.width, b.height);
    }
    ctx.fill();

    if (colorStyle.borderColor && colorStyle.borderColor !== "transparent") {
      ctx.strokeStyle = colorStyle.borderColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Render translated text
    const pad = Math.min(10, Math.min(b.width, b.height) * 0.08);
    const contentW = Math.max(10, b.width - pad * 2);
    const contentH = Math.max(10, b.height - pad * 2);

    const isVertical = region.writingDirection === "vertical";
    const weight = fontFamily === "comic" ? "bold " : "normal ";

    if (isVertical) {
      // Calculate font size for vertical layout
      const charCount = text.length;
      let fontSize = Math.max(12, Math.min(32, Math.floor(contentH / Math.max(4, Math.sqrt(charCount)))));
      ctx.font = `${weight}${fontSize}px ${fontStack}`;
      const charsPerCol = Math.max(1, Math.floor(contentH / (fontSize * 1.15)));
      const columns = wrapVerticalColumns(text, charsPerCol);
      const colWidth = fontSize * 1.25;

      ctx.fillStyle = colorStyle.textColor;
      ctx.textBaseline = "top";
      ctx.textAlign = "center";

      // Vertical CJK reads right-to-left
      let startX = b.x + b.width - pad - colWidth / 2;
      for (const col of columns) {
        let startY = b.y + pad;
        for (const char of col) {
          ctx.fillText(char, startX, startY);
          startY += fontSize * 1.15;
        }
        startX -= colWidth;
      }
    } else {
      // Horizontal text layout
      let fontSize = Math.max(12, Math.min(36, Math.floor(Math.sqrt((contentW * contentH) / (text.length * 1.6)))));
      ctx.font = `${weight}${fontSize}px ${fontStack}`;
      let lines = wrapHorizontalLines(ctx, text, contentW);
      let lineHeight = fontSize * 1.35;

      // Adjust if text overflows height
      if (lines.length * lineHeight > contentH && fontSize > 10) {
        fontSize = Math.max(10, Math.floor(contentH / (lines.length * 1.35)));
        ctx.font = `${weight}${fontSize}px ${fontStack}`;
        lines = wrapHorizontalLines(ctx, text, contentW);
        lineHeight = fontSize * 1.35;
      }

      ctx.fillStyle = colorStyle.textColor;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";

      const totalH = lines.length * lineHeight;
      let startY = b.y + (b.height - totalH) / 2 + lineHeight / 2;
      const centerX = b.x + b.width / 2;

      for (const line of lines) {
        ctx.fillText(line, centerX, startY);
        startY += lineHeight;
      }
    }
    ctx.restore();
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `manga_translated_${dateStr}_${Date.now().toString().slice(-4)}.png`;

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve({ blob, filename });
        else reject(new Error("CANVAS_TO_BLOB_FAILED"));
      },
      "image/png",
      1.0,
    );
  });
}

export async function downloadTranslatedMangaImage(
  image: MangaImage,
  regions: PositionedRegion[],
  fontFamily: MangaFontFamily = "sans",
  bubbleTheme: MangaBubbleTheme = "auto",
): Promise<string> {
  const { blob, filename } = await exportMangaImageToBlob(
    image,
    regions,
    fontFamily,
    bubbleTheme,
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return filename;
}
