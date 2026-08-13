// ============================================================
// Astra Translate - Local Translation History
// ============================================================

import type { TranslationHistoryEntry } from "../shared/types";

const HISTORY_STORAGE_KEY = "astra_translation_history_v1";
export const MAX_TRANSLATION_HISTORY_ENTRIES = 100;

interface HistoryStore {
  version: 1;
  items: TranslationHistoryEntry[];
}

function emptyStore(): HistoryStore {
  return { version: 1, items: [] };
}

function isHistoryEntry(value: unknown): value is TranslationHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TranslationHistoryEntry>;
  return (
    typeof item.id === "string" &&
    typeof item.sourceText === "string" &&
    typeof item.translation === "string" &&
    typeof item.sourceLang === "string" &&
    typeof item.targetLang === "string" &&
    (item.mode === "manual" || item.mode === "selection") &&
    typeof item.createdAt === "number" &&
    Number.isFinite(item.createdAt)
  );
}

async function loadStore(): Promise<HistoryStore> {
  const result = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
  const stored = result[HISTORY_STORAGE_KEY] as Partial<HistoryStore> | undefined;
  if (!stored || stored.version !== 1 || !Array.isArray(stored.items)) {
    return emptyStore();
  }

  return {
    version: 1,
    items: stored.items.filter(isHistoryEntry).slice(0, MAX_TRANSLATION_HISTORY_ENTRIES),
  };
}

async function saveStore(store: HistoryStore): Promise<void> {
  await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: store });
}

// Multiple translation requests can finish close together. Serialize writes
// so a later read-modify-write cannot discard an earlier history entry.
let mutationChain: Promise<unknown> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(operation, operation);
  mutationChain = run.catch(() => {});
  return run;
}

function makeId(now: number): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function getTranslationHistory(): Promise<TranslationHistoryEntry[]> {
  const store = await loadStore();
  return [...store.items]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_TRANSLATION_HISTORY_ENTRIES);
}

export async function recordTranslationHistory(
  entry: Omit<TranslationHistoryEntry, "id" | "createdAt">
): Promise<void> {
  const sourceText = entry.sourceText.trim();
  const translation = entry.translation.trim();
  if (!sourceText || !translation) return;

  await serialized(async () => {
    const store = await loadStore();
    const now = Date.now();
    const duplicateIndex = store.items.findIndex(
      (item) =>
        item.sourceText === sourceText &&
        item.translation === translation &&
        item.sourceLang === entry.sourceLang &&
        item.targetLang === entry.targetLang &&
        item.mode === entry.mode
    );

    const next: TranslationHistoryEntry = {
      ...entry,
      sourceText,
      translation,
      id: duplicateIndex >= 0 ? store.items[duplicateIndex].id : makeId(now),
      createdAt: now,
    };

    const withoutDuplicate = store.items.filter((_, index) => index !== duplicateIndex);
    await saveStore({
      version: 1,
      items: [next, ...withoutDuplicate].slice(0, MAX_TRANSLATION_HISTORY_ENTRIES),
    });
  });
}

export async function clearTranslationHistory(): Promise<void> {
  await serialized(async () => {
    await saveStore(emptyStore());
  });
}
