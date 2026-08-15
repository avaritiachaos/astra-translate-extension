// ============================================================
// Astra Translate - Chat reasoning effort per provider
// ============================================================

/** Chat modes across supported providers: disabled thinking or provider-specific level. */
export type ChatEffort = "off" | "low" | "medium" | "high" | "max";

export const DEEPSEEK_EFFORTS: ChatEffort[] = ["off", "high", "max"];
export const GEMINI_EFFORTS: ChatEffort[] = ["off", "low", "medium", "high"];
export const DEFAULT_EFFORTS: ChatEffort[] = ["off", "low", "medium", "high"];

export const CHAT_EFFORTS: ChatEffort[] = ["off", "low", "medium", "high", "max"];

export const DEFAULT_CHAT_EFFORT: ChatEffort = "high";

/** Return the list of reasoning effort options specific to the given provider. */
export function getChatEffortsForProvider(providerId?: string): ChatEffort[] {
  if (providerId === "deepseek") {
    return DEEPSEEK_EFFORTS;
  }
  if (providerId === "google-gemini") {
    return GEMINI_EFFORTS;
  }
  return DEFAULT_EFFORTS;
}

/** Return the default reasoning effort for the given provider. */
export function getDefaultChatEffort(providerId?: string): ChatEffort {
  if (providerId === "deepseek") {
    return "high";
  }
  if (providerId === "google-gemini") {
    return "medium";
  }
  return "medium";
}

/** Legacy values kept valid for sessions created by older builds. */
const LEGACY_EFFORT: Record<string, ChatEffort> = {
  disabled: "off",
  fast: "low",
  balanced: "medium",
  deep: "high",
  xhigh: "max",
};

/** Narrow an untrusted stored or messaged value to a known provider level. */
export function normalizeChatEffort(
  raw: unknown,
  providerId?: string
): ChatEffort {
  const allowed = getChatEffortsForProvider(providerId);

  let candidate: string | undefined = undefined;
  if (typeof raw === "string") {
    if (raw in LEGACY_EFFORT) {
      candidate = LEGACY_EFFORT[raw];
    } else {
      candidate = raw;
    }
  }

  if (candidate && (allowed as string[]).includes(candidate)) {
    return candidate as ChatEffort;
  }

  // Cross-provider graceful adaptation:
  if (candidate === "max" && providerId === "google-gemini") {
    return "high";
  }
  if ((candidate === "medium" || candidate === "low") && providerId === "deepseek") {
    return "high";
  }

  return getDefaultChatEffort(providerId);
}

/** Optional request fields for the selected effort level and provider. */
export function buildEffortBody(
  effort: ChatEffort,
  providerId?: string
): Record<string, unknown> {
  if (providerId === "google-gemini") {
    if (effort === "off") {
      return { reasoning_effort: "none" };
    }
    if (effort === "high" || effort === "max") {
      return { reasoning_effort: "high" };
    }
    if (effort === "low") {
      return { reasoning_effort: "low" };
    }
    return { reasoning_effort: "medium" };
  }

  if (providerId === "deepseek") {
    if (effort === "off") {
      return { thinking: { type: "disabled" } };
    }
    if (effort === "max") {
      return {
        reasoning_effort: "max",
        thinking: { type: "enabled" },
      };
    }
    return {
      reasoning_effort: "high",
      thinking: { type: "enabled" },
    };
  }

  // Custom / OpenAI-compatible
  if (effort === "off") {
    return { reasoning_effort: "none" };
  }
  return { reasoning_effort: effort };
}
