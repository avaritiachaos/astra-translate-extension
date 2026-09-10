let operations: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation, operation);
  operations = result.catch(() => {});
  return result;
}
export async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await (chrome.runtime as any).getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL("offscreen.html")],
  });
  return contexts.length > 0;
}
async function ensure() {
  if (!(await hasOffscreenDocument()))
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [
        chrome.offscreen.Reason.BLOBS,
        chrome.offscreen.Reason.USER_MEDIA,
      ],
      justification:
        "Process user-selected manga images and capture tab media for enabled live translation.",
    });
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const reply = await chrome.runtime.sendMessage({
        target: "offscreen",
        type: "ASTRA_HOST_PING",
      });
      if (reply?.success) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("OFFSCREEN_UNAVAILABLE");
}
export function ensureOffscreenDocument() {
  return serialized(ensure);
}
export function sendOffscreenCommand<T = any>(command: {
  type: string;
  payload?: unknown;
}): Promise<T> {
  return serialized(async () => {
    await ensure();
    return chrome.runtime.sendMessage({ ...command, target: "offscreen" });
  });
}
export function closeIdleOffscreenDocument(): Promise<void> {
  return serialized(async () => {
    if (!(await hasOffscreenDocument())) return;
    const state = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "ASTRA_HOST_STATE",
    });
    if (state?.success && state.busy === false)
      await chrome.offscreen.closeDocument();
  });
}
