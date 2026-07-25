// ============================================================
// Astra Translate – Incremental batch JSON item extractor
// ============================================================
// Extracts complete {id, text} objects from a growing model stream
// of a page-batch response shaped like:
//   {"items":[{"id":"…","text":"…"}, …]}
// Items are emitted once as soon as their closing brace is seen —
// including nested objects while the outer envelope is still open.

export interface StreamBatchItem {
  id: string;
  text: string;
}

/**
 * Stateful parser: feed each new chunk of the assistant content.
 * Returns newly completed items (never re-emits previous ones).
 */
export class StreamBatchItemParser {
  private buffer = "";
  private emittedIds = new Set<string>();
  /** Don't re-scan already-emitted complete regions from the start every time. */
  private scanFrom = 0;

  /** Append a content delta and return any newly completed items. */
  push(delta: string): StreamBatchItem[] {
    if (!delta) return [];
    this.buffer += delta;
    return this.extractNew();
  }

  /** Final flush after stream ends. */
  finish(): StreamBatchItem[] {
    return this.extractNew();
  }

  /** Full raw text accumulated so far. */
  get raw(): string {
    return this.buffer;
  }

  private extractNew(): StreamBatchItem[] {
    const out: StreamBatchItem[] = [];
    const s = this.buffer;
    let i = this.scanFrom;
    // First incomplete `{` we hit — resume from here next time so we don't
    // re-walk a huge prefix, but still allow nested completes after it.
    let firstIncomplete = -1;

    while (i < s.length) {
      if (s[i] !== "{") {
        i += 1;
        continue;
      }

      const end = findMatchingBrace(s, i);
      if (end < 0) {
        // This object is incomplete. Nested complete objects may still appear
        // after this `{`, so keep scanning; remember the first incomplete
        // so the next push can resume near it.
        if (firstIncomplete < 0) firstIncomplete = i;
        i += 1;
        continue;
      }

      const slice = s.slice(i, end + 1);
      const item = tryParseItem(slice);
      if (item) {
        if (!this.emittedIds.has(item.id)) {
          this.emittedIds.add(item.id);
          out.push(item);
        }
        // Item object — skip past it (children are not separate items).
        i = end + 1;
      } else {
        // Envelope / non-item object (e.g. {"items":[...]}). Step inside so
        // nested complete item objects can still be found.
        i += 1;
      }
    }

    // Resume near the first incomplete brace, or at the end if all complete.
    this.scanFrom = firstIncomplete >= 0 ? firstIncomplete : s.length;
    return out;
  }
}

/** Find the index of the closing `}` matching the `{` at `start`, or -1. */
function findMatchingBrace(s: string, start: number): number {
  if (s[start] !== "{") return -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function tryParseItem(slice: string): StreamBatchItem | null {
  try {
    const obj = JSON.parse(slice) as { id?: unknown; text?: unknown };
    if (typeof obj.id === "string" && typeof obj.text === "string") {
      return { id: obj.id, text: obj.text };
    }
  } catch {
    // Not a complete valid object — ignore.
  }
  return null;
}
