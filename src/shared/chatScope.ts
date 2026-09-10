import { CHAT_STORAGE_KEY, type ChatState } from "./types.ts";
interface Sender {
  id?: string;
  url?: string;
  documentId?: string;
  frameId?: number;
  tab?: { id?: number; url?: string };
}
/** Derive scope solely from the browser-provided sender, never a message payload. */
export function chatScopeForSender(
  sender: Sender | undefined,
  extensionId: string,
): string | null {
  if (!sender || sender.id !== extensionId) return null;
  try {
    const url = new URL(sender.url || sender.tab?.url || "");
    if (url.protocol === "chrome-extension:" && url.hostname === extensionId)
      return CHAT_STORAGE_KEY;
    if (!Number.isInteger(sender.tab?.id) || !/^https?:$/.test(url.protocol))
      return null;
    return (
      CHAT_STORAGE_KEY +
      ":" +
      sender.tab!.id +
      ":" +
      (sender.documentId || String(sender.frameId ?? 0) + "@" + url.origin)
    );
  } catch {
    return null;
  }
}
export function boundChatHistory(state: ChatState): ChatState {
  const bounded = { ...state, turns: state.turns.slice(-60) };
  while (bounded.turns.length > 2 && JSON.stringify(bounded).length > 100_000)
    bounded.turns.splice(0, 2);
  return bounded;
}
let writeQueue: Promise<unknown> = Promise.resolve();
/** Small state only; active conversations are never evicted to admit a new one. */
export function writeChatSession(key: string, state: ChatState): Promise<void> {
  const write = async () => {
    const all = await chrome.storage.session.get(null);
    const others = Object.entries(all).filter(
      ([k]) => k === CHAT_STORAGE_KEY || k.startsWith(CHAT_STORAGE_KEY + ":"),
    );
    const size = (value: unknown) => JSON.stringify(value).length * 2;
    let bytes =
      size(state) +
      others.reduce((n, [k, v]) => n + (k === key ? 0 : size(v)), 0);
    let count = others.filter(([k]) => k !== key).length + 1;
    const removable = others
      .filter(([k, v]) => k !== key && k !== CHAT_STORAGE_KEY && !v.pending)
      .sort(([, a], [, b]) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
    const remove: string[] = [];
    for (const [k, v] of removable) {
      if (bytes <= 6 * 1024 * 1024 && count <= 16) break;
      remove.push(k);
      bytes -= size(v);
      count--;
    }
    if (bytes > 6 * 1024 * 1024 || count > 16)
      throw new Error("CHAT_STORAGE_FULL");
    if (remove.length) await chrome.storage.session.remove(remove);
    await chrome.storage.session.set({
      [key]: { ...state, updatedAt: Date.now() },
    });
  };
  const result = writeQueue.then(write, write);
  writeQueue = result.catch(() => {});
  return result;
}
