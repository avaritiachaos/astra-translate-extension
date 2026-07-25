// ============================================================
// Astra Translate – Incremental batch JSON item extractor
// ============================================================
// Extracts complete {id, text} objects from a growing model stream
// of a page-batch response shaped like:
//   {"items":[{"id":"…","text":"…"}, …]}
//
// Design constraints:
// - O(n): a persistent character-level state machine; every character is
//   scanned exactly once across all push() calls, never re-walked.
// - Items are only recognised as DIRECT elements of an "items" array, so a
//   stray {id,text}-shaped object elsewhere in the output (e.g. the model
//   echoing its input before answering) is not mistaken for a translation.
// - Last write wins: if the same id completes again with different text
//   (echoed input followed by the real answer), the item is re-emitted so
//   the consumer can overwrite the earlier value.

export interface StreamBatchItem {
  id: string;
  text: string;
}

/** Max characters of an object key we bother buffering ("items" is 5). */
const MAX_KEY_CAPTURE = 64;

interface Frame {
  type: "obj" | "arr";
  /** For "arr": this array is the value of an "items" key. */
  isItems?: boolean;
  /** For "obj": whether the next string is a key (vs a value). */
  expectKey?: boolean;
  /** For "obj": last completed key, pending its value. */
  lastKey?: string;
}

/**
 * Stateful parser: feed each new chunk of the assistant content.
 * Returns newly completed items (and re-emits an id when its text changed).
 */
export class StreamBatchItemParser {
  private buffer = "";
  /** Next character index in `buffer` to consume. */
  private pos = 0;

  private stack: Frame[] = [];
  private inString = false;
  private escape = false;
  /** Capture buffer for a key string of the current object, or null. */
  private keyCapture: string | null = null;
  /** Absolute index in `buffer` where the current item object opened, or -1. */
  private itemStart = -1;
  /** Stack depth of the item object being captured (to match its close). */
  private itemDepth = -1;

  /** Last emitted text per id — dedupes identical re-completions. */
  private emitted = new Map<string, string>();

  /** Append a content delta and return any newly completed items. */
  push(delta: string): StreamBatchItem[] {
    if (!delta) return [];
    this.buffer += delta;
    return this.consume();
  }

  /** Final flush after stream ends (incomplete items cannot be salvaged). */
  finish(): StreamBatchItem[] {
    return this.consume();
  }

  /** Full raw text accumulated so far. */
  get raw(): string {
    return this.buffer;
  }

  private top(): Frame | undefined {
    return this.stack[this.stack.length - 1];
  }

  private consume(): StreamBatchItem[] {
    const out: StreamBatchItem[] = [];
    const s = this.buffer;

    for (let i = this.pos; i < s.length; i++) {
      const ch = s[i];

      if (this.inString) {
        if (this.escape) {
          this.escape = false;
          if (this.keyCapture !== null && this.keyCapture.length < MAX_KEY_CAPTURE) {
            this.keyCapture += ch;
          }
        } else if (ch === "\\") {
          this.escape = true;
        } else if (ch === '"') {
          this.inString = false;
          if (this.keyCapture !== null) {
            const frame = this.top();
            if (frame?.type === "obj") frame.lastKey = this.keyCapture;
            this.keyCapture = null;
          }
        } else if (this.keyCapture !== null && this.keyCapture.length < MAX_KEY_CAPTURE) {
          this.keyCapture += ch;
        }
        continue;
      }

      switch (ch) {
        case '"': {
          // A quote in prose outside any JSON structure must not swallow the
          // JSON that follows — only track strings inside {} / [].
          if (this.stack.length === 0) break;
          this.inString = true;
          const frame = this.top();
          // Only buffer key strings — values can be arbitrarily long.
          this.keyCapture =
            frame?.type === "obj" && frame.expectKey ? "" : null;
          break;
        }
        case ":": {
          const frame = this.top();
          if (frame?.type === "obj") frame.expectKey = false;
          break;
        }
        case ",": {
          const frame = this.top();
          if (frame?.type === "obj") {
            frame.expectKey = true;
            frame.lastKey = undefined;
          }
          break;
        }
        case "{": {
          const frame = this.top();
          if (frame?.type === "arr" && frame.isItems && this.itemStart < 0) {
            // A direct element of an items array — start capturing it.
            this.itemStart = i;
            this.itemDepth = this.stack.length;
          }
          this.stack.push({ type: "obj", expectKey: true });
          break;
        }
        case "}": {
          const frame = this.top();
          if (frame?.type === "obj") {
            this.stack.pop();
            if (this.itemStart >= 0 && this.stack.length === this.itemDepth) {
              const item = tryParseItem(s.slice(this.itemStart, i + 1));
              this.itemStart = -1;
              this.itemDepth = -1;
              if (item && this.emitted.get(item.id) !== item.text) {
                this.emitted.set(item.id, item.text);
                out.push(item);
              }
            }
          }
          break;
        }
        case "[": {
          const frame = this.top();
          const isItems =
            frame?.type === "obj" &&
            frame.expectKey === false &&
            frame.lastKey === "items";
          this.stack.push({ type: "arr", isItems });
          break;
        }
        case "]": {
          const frame = this.top();
          if (frame?.type === "arr") {
            this.stack.pop();
            // Defensive: if we dropped below the depth a capture started at,
            // that capture is stale (malformed input) — drop it.
            if (this.itemStart >= 0 && this.stack.length < this.itemDepth) {
              this.itemStart = -1;
              this.itemDepth = -1;
            }
          }
          break;
        }
        default:
          // Whitespace, numbers, literals, prose — irrelevant to structure.
          break;
      }
    }

    this.pos = s.length;
    return out;
  }
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

/**
 * String-aware scan for balanced top-level {...} regions in model output.
 * Used by callers to locate the final answer envelope even when the model
 * echoed its input or wrapped the JSON in prose / code fences.
 */
export function topLevelJsonObjects(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      // Strings only matter inside a candidate object; quotes in prose at
      // depth 0 would otherwise swallow the real JSON that follows.
      if (depth > 0) inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          out.push(raw.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}
