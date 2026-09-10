import type { ChatTurn, ChatImageAttachment } from "../shared/types.ts";
import {
  getImageAsset,
  putImageAsset,
  imagePreview,
  imageBlobToDataUrl,
  imageDataUrlToBlob,
} from "../shared/imageAssets.ts";
/** Migrate legacy inline images and new uploads before persisting a chat turn. */
export async function persistChatImages(
  turns: ChatTurn[],
  owner: string,
): Promise<void> {
  for (const turn of turns) {
    if (!turn.images) continue;
    const stored: ChatImageAttachment[] = [];
    for (const image of turn.images) {
      if (image.assetId) {
        stored.push({ ...image, dataUrl: "" });
        continue;
      }
      const blob = imageDataUrlToBlob(image.dataUrl);
      const preview = await imagePreview(blob);
      const assetId = await putImageAsset(blob, owner, preview);
      stored.push({ ...image, assetId, dataUrl: "" });
    }
    turn.images = stored;
  }
}
export async function presentChatImages(
  turns: ChatTurn[],
  owner: string,
  expiredLabel: string,
): Promise<ChatTurn[]> {
  return Promise.all(
    turns.map(async (turn) => {
      if (!turn.images?.length) return turn;
      const images: ChatImageAttachment[] = [];
      for (const image of turn.images) {
        if (!image.assetId) continue;
        const asset = await getImageAsset(image.assetId, owner).catch(
          () => undefined,
        );
        if (asset) images.push({ ...image, dataUrl: asset.preview });
      }
      return {
        ...turn,
        images,
        content:
          turn.content +
          (images.length < turn.images.length
            ? "\n[" + expiredLabel + "]"
            : ""),
      };
    }),
  );
}
export async function hydrateChatContext(
  turns: ChatTurn[],
  owner: string,
): Promise<ChatTurn[]> {
  let remaining = 2;
  const result = turns.map((turn) => ({ ...turn }));
  for (let i = result.length - 1; i >= 0; i--) {
    const turn = result[i];
    if (turn.role !== "user" || !turn.images?.length || remaining-- <= 0)
      continue;
    turn.images = await Promise.all(
      turn.images.map(async (image) => {
        const asset = image.assetId
          ? await getImageAsset(image.assetId, owner)
          : undefined;
        if (!asset) throw new Error("IMAGE_EXPIRED");
        return { ...image, dataUrl: await imageBlobToDataUrl(asset.blob) };
      }),
    );
  }
  return result;
}
