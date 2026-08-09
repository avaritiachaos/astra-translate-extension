// ============================================================
// Astra Translate – Chat thinking-effort levels
// ============================================================
// Three user-facing levels mapped onto whatever the provider understands.
// Providers differ wildly here (some take `reasoning_effort`, DeepSeek takes
// `thinking`, many take neither), so the level ALSO carries a prompt suffix —
// that part works everywhere, even on an endpoint that ignores both fields.
// Unknown fields make some gateways answer 400; the OpenAI-compatible client
// drops every optional key and retries once, so a rejection costs one round
// trip and never the answer.
// (No cross-file imports — unit-testable under Node's strip-types runner.)

export type ChatEffort = "fast" | "balanced" | "deep";

export const CHAT_EFFORTS: ChatEffort[] = ["fast", "balanced", "deep"];

export const DEFAULT_CHAT_EFFORT: ChatEffort = "balanced";

/** Narrow an untrusted stored/messaged value to a known level. */
export function normalizeChatEffort(raw: unknown): ChatEffort {
  return raw === "fast" || raw === "balanced" || raw === "deep"
    ? raw
    : DEFAULT_CHAT_EFFORT;
}

/**
 * Optional request-body fields for a level. Balanced sends nothing at all —
 * the provider's own default is the middle setting by definition, and an
 * omitted field can never be rejected.
 */
export function buildEffortBody(
  effort: ChatEffort,
  providerId?: string
): Record<string, unknown> {
  if (effort === "fast") {
    const body: Record<string, unknown> = { reasoning_effort: "low" };
    // DeepSeek's own switch — the historical fast path, kept exactly as it was.
    if (providerId === "deepseek") body.thinking = { type: "disabled" };
    return body;
  }
  if (effort === "deep") {
    return { reasoning_effort: "high" };
  }
  return {};
}

/**
 * Appended to the chat system prompt. This is what makes the levels mean
 * something on providers that silently ignore reasoning parameters.
 */
export function effortPromptSuffix(effort: ChatEffort): string {
  if (effort === "fast") {
    return (
      "\n\nAnswer briefly and directly. Skip preamble and step-by-step " +
      "derivations — give the conclusion first, and only the detail needed " +
      "to make it usable."
    );
  }
  if (effort === "deep") {
    return (
      "\n\nThink the problem through carefully before answering. Consider " +
      "edge cases and alternative readings of the question, work through the " +
      "reasoning that matters, and state your assumptions and any remaining " +
      "uncertainty. Present the reasoning that supports the answer — not a " +
      "transcript of your search for it."
    );
  }
  return "";
}
