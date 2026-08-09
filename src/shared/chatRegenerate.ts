// ============================================================
// Astra Translate – Regenerate slicing
// ============================================================
// "Regenerate" re-asks the last question instead of appending a new one:
// drop the trailing assistant reply (including a failed one), then reuse the
// user turn behind it verbatim — same text, same page attachment, same
// web-search choice. Pure so it can be unit-tested without chrome APIs.

/** Structural subset of ChatTurn (shared/types.ts) that slicing needs. */
export interface RegenerateTurn {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  attachment?: unknown;
  webSearch?: boolean;
}

export interface RegenerateSlice<T extends RegenerateTurn> {
  /** Conversation with the stale assistant reply removed, user turn last. */
  turns: T[];
  /** The user turn being re-answered. */
  source: T;
}

/**
 * Compute the conversation to re-answer, or null when there is nothing to
 * regenerate (empty chat, or no user turn behind the last assistant reply).
 *
 * A trailing user turn with no reply yet is also regenerable — that is the
 * shape left behind when a request died mid-flight with its service worker.
 */
export function sliceForRegenerate<T extends RegenerateTurn>(
  turns: T[]
): RegenerateSlice<T> | null {
  // Walk back over trailing assistant turns (normally one; more only if a
  // previous state was left inconsistent).
  let end = turns.length;
  while (end > 0 && turns[end - 1].role === "assistant") end--;
  if (end === 0) return null;

  const source = turns[end - 1];
  if (source.role !== "user") return null;

  return { turns: turns.slice(0, end), source };
}
