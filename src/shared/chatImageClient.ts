import type { ChatImageAttachment } from "./types";
export async function fullChatImage(
  image: ChatImageAttachment,
): Promise<string> {
  if (!image.assetId) return image.dataUrl;
  const result = await chrome.runtime.sendMessage({
    type: "GET_CHAT_IMAGE",
    payload: { assetId: image.assetId },
  });
  if (!result?.success || typeof result.dataUrl !== "string")
    throw new Error(result?.error || "Image unavailable");
  return result.dataUrl;
}
