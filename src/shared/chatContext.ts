// ============================================================
// Astra Translate – Chat context builder
// ============================================================
// Pure helpers for the popup chat mode: pick which stored turns
// travel to the model. (No cross-file imports — unit-testable
// under Node's strip-types runner.)

/** Structural subset of ChatAttachment (shared/types.ts). */
export interface ChatContextAttachment {
  title: string;
  url: string;
  selected: boolean;
  text: string;
}

/** Structural subset of ChatTurn (shared/types.ts) that context needs. */
export interface ChatContextTurn {
  role: "user" | "assistant";
  content: string;
  /** Failed assistant replies are rendered but never sent as context. */
  error?: boolean;
  /** Page context attached to this question. */
  attachment?: ChatContextAttachment;
}

/** Newest turns sent as model context (8 exchanges). */
export const CHAT_MAX_CONTEXT_TURNS = 16;
/** Char budget across context turns — bounds token use per request. */
export const CHAT_MAX_CONTEXT_CHARS = 8000;

/** What the model sees for a turn: attached page context wraps the question. */
export function renderTurnContent(turn: ChatContextTurn): string {
  const a = turn.attachment;
  if (!a) return turn.content;
  const kind = a.selected ? "the user's selected text" : "extracted page content";
  const title = a.title ? `; title: ${a.title}` : "";
  const url = a.url ? `; url: ${a.url}` : "";
  return (
    `Context from the current page — ${kind}${title}${url}:\n` +
    `"""\n${a.text}\n"""\n\n${turn.content}`
  );
}

/**
 * Select the newest turns that fit the turn/char budget, returned oldest-first
 * as provider-ready {role, content} messages. Error turns are skipped
 * entirely; attachments count toward the char budget at their rendered size.
 * The newest turn (the user message being answered) is always included, even
 * when it alone exceeds the char budget.
 */
export function buildChatContext(
  turns: ChatContextTurn[],
  limits?: { maxTurns?: number; maxChars?: number }
): Array<{ role: "user" | "assistant"; content: string }> {
  const maxTurns = limits?.maxTurns ?? CHAT_MAX_CONTEXT_TURNS;
  const maxChars = limits?.maxChars ?? CHAT_MAX_CONTEXT_CHARS;

  const picked: Array<{ role: "user" | "assistant"; content: string }> = [];
  let chars = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.error) continue;
    const content = renderTurnContent(turn);
    if (
      picked.length > 0 &&
      (picked.length >= maxTurns || chars + content.length > maxChars)
    ) {
      break;
    }
    picked.push({ role: turn.role, content });
    chars += content.length;
  }

  picked.reverse();
  return picked;
}
