// ============================================================
// Astra Translate – Shared Glossary / Terminology Module
// ============================================================

export interface GlossaryEntry {
  source: string;
  target: string;
}

/**
 * Parses raw glossary text (each line in format "source=target" or "source:target" or "source->target")
 * into structured GlossaryEntry objects. Empty lines and comment lines starting with # or // are ignored.
 */
export function parseGlossary(raw: string): GlossaryEntry[] {
  if (!raw || typeof raw !== "string") return [];

  const entries: GlossaryEntry[] = [];
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
      continue;
    }

    // Support separators: '=', '->', ':'
    let sepIdx = -1;
    let sepLen = 1;

    const arrowIdx = trimmed.indexOf("->");
    if (arrowIdx !== -1) {
      sepIdx = arrowIdx;
      sepLen = 2;
    } else {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        sepIdx = eqIdx;
        sepLen = 1;
      } else {
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx !== -1) {
          sepIdx = colonIdx;
          sepLen = 1;
        }
      }
    }

    if (sepIdx !== -1) {
      const source = trimmed.substring(0, sepIdx).trim();
      const target = trimmed.substring(sepIdx + sepLen).trim();
      if (source && target) {
        entries.push({ source, target });
      }
    }
  }

  return entries;
}

/**
 * Formats a list of GlossaryEntry back to standard "source=target" lines.
 */
export function serializeGlossary(entries: GlossaryEntry[]): string {
  return entries
    .map((e) => `${e.source.trim()}=${e.target.trim()}`)
    .filter((line) => line !== "=")
    .join("\n");
}

/**
 * Builds a prompt block from glossary text to inject into translation instructions.
 * If raw glossary is empty or has no valid pairs, returns an empty string.
 */
export function buildGlossaryPromptSection(rawGlossary?: string): string {
  if (!rawGlossary) return "";
  const entries = parseGlossary(rawGlossary);
  if (entries.length === 0) return "";

  const lines = entries.map((e) => `- "${e.source}" => "${e.target}"`).join("\n");
  return `\n\nTerminology & Glossary (Strictly use the specified translations whenever these terms appear):\n${lines}`;
}

/**
 * Injects glossary terms into an existing base prompt.
 */
export function injectGlossaryIntoPrompt(basePrompt: string, rawGlossary?: string): string {
  const glossarySection = buildGlossaryPromptSection(rawGlossary);
  if (!glossarySection) return basePrompt;
  return `${basePrompt.trimEnd()}${glossarySection}`;
}
