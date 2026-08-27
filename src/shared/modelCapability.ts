// ============================================================
// Astra Translate – Model Capability Matrix & Vision Detection
// ============================================================

/** Regex pattern matching models with native vision / multimodal capabilities. */
const VISION_MODEL_PATTERN =
  /(vision|-vl\b|vl-|4o\b|4o-mini|gpt-4-turbo|gemini|claude-3|claude-sonnet|claude-opus|qwen-vl|internvl|pixtral|llava|minicpm-v|cogvlm)/i;

/** Known text-only patterns even if part of a provider with multimodal models. */
const TEXT_ONLY_PATTERN =
  /(deepseek|deepseek-chat|deepseek-reasoner|deepseek-v|llama|mistral-tiny|mistral-small|text-embedding|bge-)/i;

/**
 * Determine whether a provider/model combination supports multi-modal vision (image inputs).
 * Pure and unit-testable.
 */
export function isVisionCapable(providerId?: string, model?: string): boolean {
  if (!providerId && !model) return false;

  const normalizedProvider = (providerId || "").toLowerCase();
  const normalizedModel = (model || "").toLowerCase();

  // Explicit provider rules
  if (normalizedProvider === "google-gemini") {
    // Almost all Gemini chat models in AI Studio are multimodal
    return true;
  }

  if (normalizedProvider === "deepseek") {
    // Official DeepSeek API chat/reasoner endpoints are pure text
    return false;
  }

  // Model name matching
  if (normalizedModel) {
    if (TEXT_ONLY_PATTERN.test(normalizedModel) && !normalizedModel.includes("vl")) {
      return false;
    }
    if (VISION_MODEL_PATTERN.test(normalizedModel)) {
      return true;
    }
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
