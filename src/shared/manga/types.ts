import type { UserProviderSettings } from "../types";
import type { UiLanguage } from "../i18n";
export interface MangaSettings {
  providerId: string;
  modelId: string;
  targetLanguage: string;
}
export type Box1000 = [number, number, number, number];
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Tile extends Rect {
  index: number;
}
export interface MangaRegion {
  id: string;
  kind: "dialogue" | "narration" | "sfx" | "other";
  sourceText: string;
  translatedText: string;
  textBox: Box1000;
  bubbleBox?: Box1000;
  writingDirection: "horizontal" | "vertical" | "unknown";
  readingOrder: number;
  uncertain: boolean;
}
export interface PositionedRegion
  extends Omit<MangaRegion, "textBox" | "bubbleBox"> {
  rect: Rect;
  bubble?: Rect;
  tileIndex: number;
  background?: { color: string; flat: boolean };
}
export interface MangaResult {
  width: number;
  height: number;
  regions: PositionedRegion[];
  format: string;
}
export type MangaPhase =
  | "queued"
  | "loading"
  | "preparing"
  | "translating"
  | "ready"
  | "failed"
  | "cancelled"
  | "interrupted";
export interface MangaJob {
  id: string;
  owner: string;
  phase: MangaPhase;
  revision: number;
  createdAt: number;
  updatedAt: number;
  model: string;
  total: number;
  completed: number;
  width: number;
  height: number;
  regions: PositionedRegion[];
  cacheHit?: boolean;
  format?: string;
  assetId?: string;
  error?: string;
  errorCode?: string;
  probe?: boolean;
}
export type MangaSource =
  | { kind: "url"; url: string; pageOrigin: string }
  | { kind: "data"; dataUrl: string }
  | { kind: "probe" };
export interface MangaExecution {
  job: MangaJob;
  source: MangaSource;
  provider: UserProviderSettings;
  language: UiLanguage;
  targetLanguage: string;
  glossary: string;
  force: boolean;
}
export const MANGA_ACTIVE_PHASES = new Set<MangaPhase>([
  "queued",
  "loading",
  "preparing",
  "translating",
]);
export const MANGA_PROMPT_VERSION = "manga-v1";
