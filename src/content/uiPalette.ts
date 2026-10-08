/**
 * Color palette for page-injected UI (content scripts).
 *
 * Extension pages (popup / options) read CSS variables from
 * src/styles/theme.css. Content scripts inject into arbitrary third-party
 * pages where shared CSS variables are unsafe, so the same brand values are
 * inlined from here instead. Keep this file in sync with theme.css.
 *
 * Scope: shared brand / surface / status colors. One-off decorative shades
 * (e.g. hand-tuned manga bubble gradients) stay inline on purpose.
 */
export const C = {
  /* ---- Brand ---- */
  primary: "#6366f1",
  primaryDark: "#4f46e5", // hover / gradient end
  primaryLight: "#818cf8", // brand on dark surfaces
  primarySoft: "#eef2ff", // tinted surface (light)
  primarySoftDark: "#1e1b4b", // tinted surface (dark)
  primaryTextSoft: "#c7d2fe", // brand text on dark
  primaryBorderSoft: "#a5b4fc", // soft brand border
  gradBrand: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
  gradBall: "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)",
  gradBallDark: "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)",

  /* ---- Light theme surfaces & text ---- */
  bg: "#ffffff",
  bgSunken: "#f7f7fa",
  bgSunken2: "#f4f5f8",
  bgHover: "#fafafa",
  bgSubtle: "#f3f4f6",
  text: "#1a1a2e",
  textStrong: "#1d1d1f",
  textBody: "#1f2937",
  textSecondary: "#6b7280",
  textMuted: "#9ca3af",
  textFaint: "#a1a1aa",
  textZinc: "#52525b",
  textSlate: "#94a3b8",
  textSlateDark: "#374151",
  border: "#e5e7eb",
  borderStrong: "#d1d5db",
  borderSlate: "#cbd5e1",
  borderSlate2: "#e2e8f0",

  /* ---- Dark theme surfaces & text ---- */
  dBg: "#1a1a2e",
  dBg2: "#1c1d2c",
  dBg3: "#222336",
  dBgBase: "#181926",
  dBgDeep: "#0f0f1a",
  dBgHover: "#252538",
  dBgMenu: "#2a2b3d",
  dBgSelected: "#2e3052",
  dBgMedia: "#313248",
  dBorder: "#2d2d44",
  dText: "#e5e7eb",
  dTextStrong: "#f3f4f6",
  dTextBright: "#f5f5f7",

  /* ---- Status ---- */
  success: "#10b981",
  successSoft: "#86efac",
  warning: "#f59e0b",
  error: "#ef4444",
  errorSoft: "#f87171",
  errorGhost: "#fca5a5",
  errorBg: "#fef2f2",
  errorBorder: "#fecaca",
  errorBgDark: "#2d1b1b",
  errorBorderDark: "#4a2020",

  /* ---- Manga accent family (same indigo band as the brand ramp) ---- */
  manga: "#4f46e5",
  mangaLight: "#6366f1",
  mangaLighter: "#818cf8",
  mangaText: "#a5b4fc",
  mangaTextBright: "#e0e7ff",
  mangaBg: "#eef2ff",
  mangaBorder: "#c7d2fe",
  mangaSoft: "#b8bbe5",
  mangaMid: "#6175ce",
  mangaBgDark: "#24242a",

  white: "#ffffff",
} as const;
