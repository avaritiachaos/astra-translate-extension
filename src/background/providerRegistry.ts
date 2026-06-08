// ============================================================
// Astra Translate – Provider Registry
// ============================================================

import type { ProviderPreset } from "../shared/types";
import { DEFAULT_PROVIDER_PRESETS } from "../shared/constants";

/**
 * Simple registry that holds provider presets.
 * Currently only ships DeepSeek + Custom OpenAI-compatible.
 * Future providers (Gemini, Anthropic) can be added here.
 */
class ProviderRegistry {
  private presets: Map<string, ProviderPreset>;

  constructor() {
    this.presets = new Map();
    for (const p of DEFAULT_PROVIDER_PRESETS) {
      this.presets.set(p.id, p);
    }
  }

  /** Register a new preset at runtime (for future use). */
  register(preset: ProviderPreset): void {
    this.presets.set(preset.id, preset);
  }

  /** Get a preset by id. */
  get(id: string): ProviderPreset | undefined {
    return this.presets.get(id);
  }

  /** Return all registered presets. */
  getAll(): ProviderPreset[] {
    return Array.from(this.presets.values());
  }

  /** Check whether a preset id exists. */
  has(id: string): boolean {
    return this.presets.has(id);
  }
}

/** Singleton – imported by background modules. */
export const providerRegistry = new ProviderRegistry();
