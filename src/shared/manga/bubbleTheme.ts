// ============================================================
// Astra Translate - Manga Bubble Theme & Luminance Engine
// ============================================================

import type { MangaBubbleTheme } from "./types";

export interface BubbleColorStyle {
  backgroundColor: string;
  textColor: string;
  isDark: boolean;
  borderColor?: string;
  boxShadow?: string;
}

export function parseRgb(colorStr?: string): [number, number, number] | null {
  if (!colorStr) return null;
  const rgbMatch = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    return [
      parseInt(rgbMatch[1], 10),
      parseInt(rgbMatch[2], 10),
      parseInt(rgbMatch[3], 10),
    ];
  }
  if (colorStr.startsWith("#")) {
    const hex = colorStr.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ];
    }
    if (hex.length >= 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
  }
  return null;
}

export function getLuminance(rgb: [number, number, number]): number {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

export function resolveBubbleColor(
  bg: { color: string; flat: boolean } | undefined,
  theme: MangaBubbleTheme = "auto",
): BubbleColorStyle {
  const rgb = parseRgb(bg?.color);
  const luminance = rgb ? getLuminance(rgb) : 255;
  const naturallyDark = rgb ? luminance < 128 : false;

  switch (theme) {
    case "dark":
      return {
        backgroundColor: "rgba(22, 20, 32, 0.92)",
        textColor: "#f3f1fb",
        isDark: true,
        borderColor: "rgba(255, 255, 255, 0.15)",
        boxShadow: "0 2px 10px rgba(0,0,0,0.45)",
      };

    case "light":
      return {
        backgroundColor: bg?.flat ? bg.color : "#ffffff",
        textColor: "#1f1f24",
        isDark: false,
        borderColor: "transparent",
      };

    case "translucent":
      if (naturallyDark) {
        return {
          backgroundColor: "rgba(16, 14, 24, 0.65)",
          textColor: "#ffffff",
          isDark: true,
          borderColor: "rgba(255, 255, 255, 0.2)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        };
      } else {
        return {
          backgroundColor: "rgba(255, 255, 255, 0.72)",
          textColor: "#1a1920",
          isDark: false,
          borderColor: "rgba(0, 0, 0, 0.08)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        };
      }

    case "auto":
    default:
      if (naturallyDark) {
        // If the original sampled bubble is dark, use a smooth matching dark tone with gentle transparency
        const [r, g, b] = rgb!;
        return {
          backgroundColor: `rgba(${Math.max(16, r - 5)}, ${Math.max(16, g - 5)}, ${Math.max(20, b - 5)}, 0.92)`,
          textColor: "#f5f3ff",
          isDark: true,
          borderColor: "rgba(255, 255, 255, 0.18)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        };
      } else {
        // Normal light bubble
        return {
          backgroundColor: bg?.flat ? bg.color : "#ffffff",
          textColor: "#1f1f24",
          isDark: false,
          borderColor: "transparent",
        };
      }
  }
}
