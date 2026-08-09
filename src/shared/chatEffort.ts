// ============================================================
// Astra Translate – Chat thinking-effort levels
// ============================================================
// Modelled directly on DeepSeek's four request-side effort values, since that
// is the provider this extension ships a preset for. From their reasoning
// docs (OpenAI-format column):
//
//   thinking switch : {"thinking": {"type": "enabled" | "disabled"}}
//   effort control  : {"reasoning_effort": "low" | "high" | "xhigh" | "max"}
//
// Thinking is ON by default with effort=high, and the request value is mapped
// onto the model's real effort per model (e.g. on deepseek-v4-flash, xhigh
// maps down to high; on deepseek-v4-pro, low maps up to high). We send the
// user's choice through unchanged and let the provider do that mapping.
//
// Other OpenAI-compatible endpoints don't share this vocabulary — "xhigh" is
// DeepSeek's own — so those get the nearest standard value instead. Anything
// a gateway rejects is dropped wholesale on the first 400 and retried once
// (see dropOptionalFields in openAICompatibleClient), so an unsupported field
// costs one round trip, never the answer.
//
// The level also carries a prompt suffix: that part steers models whose
// endpoint ignores reasoning parameters entirely.
// (No cross-file imports — unit-testable under Node's strip-types runner.)

/** Request-side effort values, ordered cheapest → most thorough. */
export type ChatEffort = "low" | "high" | "xhigh" | "max";

export const CHAT_EFFORTS: ChatEffort[] = ["low", "high", "xhigh", "max"];

/** Matches DeepSeek's own default (thinking on, effort=high). */
export const DEFAULT_CHAT_EFFORT: ChatEffort = "high";

/**
 * Nearest standard `reasoning_effort` for non-DeepSeek endpoints, whose
 * documented vocabulary is low / medium / high — no "xhigh" or "max".
 */
const GENERIC_EFFORT: Record<ChatEffort, string> = {
  low: "low",
  high: "medium",
  xhigh: "high",
  max: "high",
};

/** Pre-4.8.1 level names, so a stored session value keeps working. */
const LEGACY_EFFORT: Record<string, ChatEffort> = {
  fast: "low",
  balanced: "high",
  deep: "xhigh",
};

/** Narrow an untrusted stored/messaged value to a known level. */
export function normalizeChatEffort(raw: unknown): ChatEffort {
  if (
    raw === "low" ||
    raw === "high" ||
    raw === "xhigh" ||
    raw === "max"
  ) {
    return raw;
  }
  if (typeof raw === "string" && raw in LEGACY_EFFORT) {
    return LEGACY_EFFORT[raw];
  }
  return DEFAULT_CHAT_EFFORT;
}

/**
 * Optional request-body fields for a level. Every key returned here is
 * droppable: the client removes them all and retries once on a 400.
 */
export function buildEffortBody(
  effort: ChatEffort,
  providerId?: string
): Record<string, unknown> {
  if (providerId === "deepseek") {
    // Thinking is on by default, but say so explicitly — the provider
    // settings also carry a disableThinking switch meant for translation,
    // and chat's own level is what should win here.
    return {
      reasoning_effort: effort,
      thinking: { type: "enabled" },
    };
  }
  return { reasoning_effort: GENERIC_EFFORT[effort] };
}

/**
 * Appended to the chat system prompt. This is what makes the levels mean
 * something on providers that silently ignore reasoning parameters.
 */
export function effortPromptSuffix(effort: ChatEffort): string {
  if (effort === "low") {
    return (
      "\n\nAnswer briefly and directly. Skip preamble and step-by-step " +
      "derivations — give the conclusion first, and only the detail needed " +
      "to make it usable."
    );
  }
  if (effort === "xhigh" || effort === "max") {
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
