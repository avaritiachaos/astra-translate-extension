// ============================================================
// Astra Translate – Shared Utilities
// ============================================================

/**
 * Generate a short random id.
 */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Clamp a number between min and max.
 */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * Simple debounce helper.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number
): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

/**
 * Truncate text with ellipsis.
 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

/**
 * Escape HTML special characters to prevent XSS when building DOM manually.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Check if a string is blank / whitespace only.
 */
export function isBlank(s: string): boolean {
  return s.trim().length === 0;
}

/**
 * Try to extract JSON from a model response that may contain extra text.
 */
export function extractJson(text: string): string | null {
  // Try to find a JSON object in the text
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}
