// ============================================================
// Astra Translate – Chat context builder
// ============================================================
// Pure helpers for the popup chat mode: pick which stored turns
// travel to the model. (No cross-file imports — unit-testable
// under Node's strip-types runner.)

/** Structural subset of ChatTurn (shared/types.ts) that context needs. */
export interface ChatContextTurn {
  role: "user" | "assistant";
  content: string;
  /** Failed assistant replies are rendered but never sent as context. */
  error?: boolean;
}

/** Newest turns sent as model context (8 exchanges). */
export const CHAT_MAX_CONTEXT_TURNS = 16;
/** Char budget across context turns — bounds token use per request. */
export const CHAT_MAX_CONTEXT_CHARS = 8000;

/**
 * Select the newest turns that fit the turn/char budget, returned oldest-first
 * as provider-ready {role, content} messages. Error turns are skipped
 * entirely. The newest turn (the user message being answered) is always
 * included, even when it alone exceeds the char budget.
 */
export function buildChatContext(
  turns: ChatContextTurn[],
  limits?: { maxTurns?: number; maxChars?: number }
): Array<{ role: "user" | "assistant"; content: string }> {
  const maxTurns = limits?.maxTurns ?? CHAT_MAX_CONTEXT_TURNS;
  const maxChars = limits?.maxChars ?? CHAT_MAX_CONTEXT_CHARS;

  const picked: ChatContextTurn[] = [];
  let chars = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.error) continue;
    if (
      picked.length > 0 &&
      (picked.length >= maxTurns || chars + turn.content.length > maxChars)
    ) {
      break;
    }
    picked.push(turn);
    chars += turn.content.length;
  }

  picked.reverse();
  return picked.map((turn) => ({ role: turn.role, content: turn.content }));
}
