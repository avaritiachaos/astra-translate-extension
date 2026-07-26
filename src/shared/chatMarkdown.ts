// ============================================================
// Astra Translate – Minimal chat markdown tokenizer
// ============================================================
// Whitelist-only: fenced code blocks, inline code, and bold. The
// popup maps tokens to React elements (never innerHTML), so model
// output cannot inject markup. Everything else stays literal text.
// (No cross-file imports — unit-testable under Node strip-types.)

export interface ChatSpan {
  type: "text" | "code" | "bold";
  content: string;
}

export type ChatBlock =
  | { type: "codeblock"; lang: string; content: string }
  | { type: "para"; spans: ChatSpan[] };

/**
 * Split text into paragraph and fenced-code blocks. An unclosed fence
 * (mid-stream, or a model that forgot to close it) still renders as a code
 * block — streaming must not flash literal ``` while the block grows.
 */
export function parseChatMarkdown(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let para: string[] = [];
  let code: string[] | null = null;
  let codeLang = "";

  const flushPara = () => {
    if (para.length === 0) return;
    const joined = para.join("\n");
    para = [];
    if (!joined.trim()) return;
    blocks.push({ type: "para", spans: parseSpans(joined) });
  };

  for (const line of text.split("\n")) {
    const fence = /^\s*```(\S*)\s*$/.exec(line);
    if (fence) {
      if (code === null) {
        flushPara();
        code = [];
        codeLang = fence[1] || "";
      } else {
        blocks.push({ type: "codeblock", lang: codeLang, content: code.join("\n") });
        code = null;
        codeLang = "";
      }
      continue;
    }
    if (code !== null) code.push(line);
    else para.push(line);
  }

  if (code !== null) {
    blocks.push({ type: "codeblock", lang: codeLang, content: code.join("\n") });
  }
  flushPara();
  return blocks;
}

/** Inline spans: `code` binds tighter than **bold**; neither crosses lines. */
export function parseSpans(text: string): ChatSpan[] {
  const spans: ChatSpan[] = [];
  for (const part of text.split(/(`[^`\n]+`)/)) {
    if (!part) continue;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      spans.push({ type: "code", content: part.slice(1, -1) });
      continue;
    }
    for (const seg of part.split(/(\*\*[^*\n]+?\*\*)/)) {
      if (!seg) continue;
      if (seg.length > 4 && seg.startsWith("**") && seg.endsWith("**")) {
        spans.push({ type: "bold", content: seg.slice(2, -2) });
      } else {
        spans.push({ type: "text", content: seg });
      }
    }
  }
  return spans;
}
