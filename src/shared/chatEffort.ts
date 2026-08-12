// ============================================================
// Astra Translate - DeepSeek chat reasoning effort
// ============================================================
// The extension currently targets one provider for chat: DeepSeek. Keep the
// provider's request vocabulary visible in the UI and pass it through without
// translating it into a second, app-specific set of names.

/** DeepSeek chat modes: disabled thinking, or an enabled effort level. */
export type ChatEffort = "off" | "low" | "high" | "xhigh" | "max";

export const CHAT_EFFORTS: ChatEffort[] = ["off", "low", "high", "xhigh", "max"];

/** DeepSeek's existing default in this extension. */
export const DEFAULT_CHAT_EFFORT: ChatEffort = "high";

/** Legacy values kept valid for sessions created by older builds. */
const LEGACY_EFFORT: Record<string, ChatEffort> = {
  disabled: "off",
  fast: "low",
  balanced: "high",
  deep: "xhigh",
};

/** Narrow an untrusted stored or messaged value to a known DeepSeek level. */
export function normalizeChatEffort(raw: unknown): ChatEffort {
  if (
    raw === "low" ||
    raw === "high" ||
    raw === "xhigh" ||
    raw === "max" ||
    raw === "off"
  ) {
    return raw;
  }
  if (typeof raw === "string" && raw in LEGACY_EFFORT) {
    return LEGACY_EFFORT[raw];
  }
  return DEFAULT_CHAT_EFFORT;
}

/** Optional DeepSeek request fields for the selected effort level. */
export function buildEffortBody(
  effort: ChatEffort
): Record<string, unknown> {
  if (effort === "off") {
    return { thinking: { type: "disabled" } };
  }
  return {
    reasoning_effort: effort,
    thinking: { type: "enabled" },
  };
}
