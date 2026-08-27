// ============================================================
// Astra Translate – Image Utilities (Compression & Processing)
// ============================================================

import type { ChatImageAttachment } from "./types";

/** Maximum dimension (width or height) in pixels. 1568px is the sweet-spot for VLM OCR and detail. */
export const MAX_IMAGE_DIMENSION = 1568;
/** Default JPEG quality when compressing bitmap images. */
export const DEFAULT_JPEG_QUALITY = 0.82;
/** Maximum images allowed per user turn. */
export const MAX_IMAGES_PER_TURN = 4;

/**
 * Calculate proportional dimensions scaled to fit inside maxDimension.
 */
export function calculateScaledDimensions(
  origWidth: number,
  origHeight: number,
  maxDim: number = MAX_IMAGE_DIMENSION
): { width: number; height: number } {
  if (origWidth <= 0 || origHeight <= 0) {
    return { width: maxDim, height: maxDim };
  }
  if (origWidth <= maxDim && origHeight <= maxDim) {
    return { width: origWidth, height: origHeight };
  }

  const ratio = origWidth / origHeight;
  if (origWidth >= origHeight) {
    const width = maxDim;
    const height = Math.round(maxDim / ratio);
    return { width, height };
  } else {
    const height = maxDim;
    const width = Math.round(maxDim * ratio);
    return { width, height };
  }
}

/**
 * Convert a File/Blob to a base64 Data URL.
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Format byte count into human-readable label (e.g. "124 KB", "1.2 MB").
 */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Process and compress an image file or blob for model transmission and display.
 */
export async function processImageFile(
  fileOrBlob: Blob,
  fileName?: string,
  options?: { maxDimension?: number; quality?: number }
): Promise<ChatImageAttachment> {
  const id = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const maxDim = options?.maxDimension ?? MAX_IMAGE_DIMENSION;
  const quality = options?.quality ?? DEFAULT_JPEG_QUALITY;
  const name = fileName || (fileOrBlob instanceof File ? fileOrBlob.name : "image.jpg");

  // In non-DOM / Node test environment, fallback to raw reader
  if (typeof window === "undefined" || typeof document === "undefined" || !window.Image) {
    const dataUrl = await blobToDataUrl(fileOrBlob);
    return {
      id,
      name,
      mimeType: fileOrBlob.type || "image/jpeg",
      dataUrl,
      width: 800,
      height: 600,
    };
  }

  const rawDataUrl = await blobToDataUrl(fileOrBlob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const { width: origWidth, height: origHeight } = img;
        const { width, height } = calculateScaledDimensions(origWidth, origHeight, maxDim);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return resolve({
            id,
            name,
            mimeType: fileOrBlob.type || "image/jpeg",
            dataUrl: rawDataUrl,
            width: origWidth,
            height: origHeight,
          });
        }

        // Draw and compress
        ctx.drawImage(img, 0, 0, width, height);
        const mimeType = "image/jpeg";
        const compressedDataUrl = canvas.toDataURL(mimeType, quality);

        resolve({
          id,
          name,
          mimeType,
          dataUrl: compressedDataUrl,
          width,
          height,
        });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      reject(new Error("Invalid image source"));
    };
    img.src = rawDataUrl;
  });
}

/**
 * Extract image File objects from a clipboard event's DataTransferItemList.
 */
export function extractImagesFromDataTransfer(items: DataTransferItemList | FileList): File[] {
  const images: File[] = [];
  if (!items) return images;

  if (items instanceof FileList) {
    for (let i = 0; i < items.length; i++) {
      const file = items[i];
      if (file && file.type.startsWith("image/")) {
        images.push(file);
      }
    }
    return images;
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item && item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) images.push(file);
    }
  }
  return images;
}
