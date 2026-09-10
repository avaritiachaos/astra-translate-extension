import type {
  Box1000,
  MangaRegion,
  PositionedRegion,
  Tile,
  Rect,
} from "./types.ts";
export const MANGA_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "sourceLanguage", "regions"],
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    sourceLanguage: { type: "string" },
    regions: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "kind",
          "sourceText",
          "translatedText",
          "textBox",
          "bubbleBox",
          "writingDirection",
          "readingOrder",
          "uncertain",
        ],
        properties: {
          id: { type: "string" },
          kind: {
            type: "string",
            enum: ["dialogue", "narration", "sfx", "other"],
          },
          sourceText: { type: "string" },
          translatedText: { type: "string" },
          textBox: {
            type: "array",
            items: { type: "number" },
            minItems: 4,
            maxItems: 4,
          },
          bubbleBox: {
            anyOf: [
              {
                type: "array",
                items: { type: "number" },
                minItems: 4,
                maxItems: 4,
              },
              { type: "null" },
            ],
          },
          writingDirection: {
            type: "string",
            enum: ["horizontal", "vertical", "unknown"],
          },
          readingOrder: { type: "integer" },
          uncertain: { type: "boolean" },
        },
      },
    },
  },
};
function box(value: unknown): Box1000 {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some(
      (n) => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1000,
    ) ||
    value[2] <= value[0] ||
    value[3] <= value[1]
  )
    throw new Error("MANGA_INVALID_RESULT");
  return value.slice() as Box1000;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max)
    throw new Error("MANGA_INVALID_RESULT");
  return value.trim();
}
export function parseMangaResult(raw: string): MangaRegion[] {
  if (raw.length > 1_000_000) throw new Error("MANGA_INVALID_RESULT");
  const clean = raw
    .trim()
    .replace(/^\x60{3}(?:json)?\s*\n?([\s\S]*?)\n?\x60{3}$/i, "$1");
  let value: any;
  try {
    value = JSON.parse(clean);
  } catch {
    throw new Error("MANGA_INVALID_RESULT");
  }
  if (
    value?.schemaVersion !== 1 ||
    typeof value.sourceLanguage !== "string" ||
    value.sourceLanguage.length > 80 ||
    !Array.isArray(value.regions) ||
    value.regions.length > 200
  )
    throw new Error("MANGA_INVALID_RESULT");
  const ids = new Set<string>();
  return value.regions.map((row: any): MangaRegion => {
    if (!row || typeof row !== "object")
      throw new Error("MANGA_INVALID_RESULT");
    const id = text(row.id, 100);
    if (
      !id ||
      ids.has(id) ||
      !["dialogue", "narration", "sfx", "other"].includes(row.kind) ||
      !["horizontal", "vertical", "unknown"].includes(row.writingDirection) ||
      !Number.isInteger(row.readingOrder) ||
      row.readingOrder < 0 ||
      row.readingOrder > 10000 ||
      typeof row.uncertain !== "boolean"
    )
      throw new Error("MANGA_INVALID_RESULT");
    ids.add(id);
    const sourceText = text(row.sourceText, 4000);
    const translatedText = text(row.translatedText, 4000);
    if ((!sourceText || !translatedText) && !row.uncertain)
      throw new Error("MANGA_INVALID_RESULT");
    const textBox = box(row.textBox);
    const bubbleBox = row.bubbleBox == null ? undefined : box(row.bubbleBox);
    if (
      bubbleBox &&
      (bubbleBox[0] > textBox[0] + 2 ||
        bubbleBox[1] > textBox[1] + 2 ||
        bubbleBox[2] < textBox[2] - 2 ||
        bubbleBox[3] < textBox[3] - 2)
    )
      throw new Error("MANGA_INVALID_RESULT");
    return {
      id,
      kind: row.kind,
      sourceText,
      translatedText,
      textBox,
      bubbleBox,
      writingDirection: row.writingDirection,
      readingOrder: row.readingOrder,
      uncertain: row.uncertain,
    };
  });
}
export function mapBox(value: Box1000, tile: Rect): Rect {
  return {
    x: tile.x + (value[1] / 1000) * tile.width,
    y: tile.y + (value[0] / 1000) * tile.height,
    width: ((value[3] - value[1]) / 1000) * tile.width,
    height: ((value[2] - value[0]) / 1000) * tile.height,
  };
}
export function positionRegion(
  region: MangaRegion,
  tile: Tile,
): PositionedRegion {
  const { textBox, bubbleBox, ...rest } = region;
  return {
    ...rest,
    id: String(tile.index) + ":" + region.id,
    tileIndex: tile.index,
    rect: mapBox(textBox, tile),
    bubble: bubbleBox ? mapBox(bubbleBox, tile) : undefined,
  };
}
export function overlap(a: Rect, b: Rect): number {
  const intersection =
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return (
    intersection /
    Math.max(1, a.width * a.height + b.width * b.height - intersection)
  );
}
export function mergeRegions(
  existing: PositionedRegion[],
  incoming: PositionedRegion[],
): PositionedRegion[] {
  const result = existing.slice();
  const normalize = (value: string) =>
    value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  for (const region of incoming) {
    const duplicate = result.findIndex(
      (old) =>
        old.tileIndex !== region.tileIndex &&
        overlap(old.rect, region.rect) > 0.45 &&
        normalize(old.sourceText) === normalize(region.sourceText),
    );
    if (duplicate < 0) result.push(region);
    else if (result[duplicate].uncertain && !region.uncertain)
      result[duplicate] = region;
  }
  return result;
}
