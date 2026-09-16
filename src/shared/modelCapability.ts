// ============================================================
// Astra Translate – Model Capability Matrix & Vision Detection
// ============================================================

/** Regex pattern matching models with native vision / multimodal capabilities. */
const VISION_MODEL_PATTERN =
  /(vision|-vl\b|vl-|4o\b|4o-mini|gpt-4-turbo|gemini|claude-3|claude-sonnet|claude-opus|qwen-vl|internvl|pixtral|llava|minicpm-v|cogvlm|deepseek-flash|janus)/i;

/** Known text-only patterns even if part of a provider with multimodal models. */
const TEXT_ONLY_PATTERN =
  /(deepseek-chat|deepseek-reasoner|deepseek-v[0-9]|not-the-vision|llama|mistral-tiny|mistral-small|text-embedding|bge-)/i;

/**
 * Determine whether a provider/model combination supports multi-modal vision (image inputs).
 * Pure and unit-testable.
 */
export function isVisionCapable(providerId?: string, model?: string): boolean {
  if (!providerId && !model) return false;

  const normalizedProvider = (providerId || "").toLowerCase();
  const normalizedModel = (model || "").toLowerCase();

  // Model name matching takes precedence when specific model name is available
  if (normalizedModel) {
    if (
      normalizedModel === "deepseek-flash" ||
      normalizedModel.includes("deepseek-vl") ||
      normalizedModel.includes("-vl") ||
      normalizedModel.includes("vl-")
    ) {
      return true;
    }
    if (TEXT_ONLY_PATTERN.test(normalizedModel)) {
      return false;
    }
    if (VISION_MODEL_PATTERN.test(normalizedModel)) {
      return true;
    }
  }

  // Explicit provider rules
  if (normalizedProvider === "google-gemini") {
    // Gemini chat models in AI Studio are multimodal unless explicitly named as text-only
    return !normalizedModel || !TEXT_ONLY_PATTERN.test(normalizedModel);
  }

  if (normalizedProvider === "deepseek") {
    // Official DeepSeek default endpoints (v3/chat/reasoner) are pure text
    return false;
  }

  return false;
}

/**
 * Get display badge kind for model selector UI.
 */
export function getModelCapabilityKind(
  providerId?: string,
  model?: string
): "vision" | "text" {
  return isVisionCapable(providerId, model) ? "vision" : "text";
}
