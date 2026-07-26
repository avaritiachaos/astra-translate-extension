// ============================================================
// Astra Translate – Ephemeral chat service (popup "chat" mode)
// ============================================================
// One browser-session conversation stored in chrome.storage.session:
// it survives popup close and service-worker idle death, and clears
// when the browser exits. The service worker owns every mutation;
// the popup renders from storage change events, so an answer that
// finishes while the popup is closed is waiting on next open.

import {
  CHAT_STORAGE_KEY,
  type AstraSettings,
  type ChatAttachment,
  type ChatResponse,
  type ChatState,
  type ChatStreamEvent,
  type ChatStreamRequest,
  type ChatTurn,
} from "../shared/types";
import { buildChatContext } from "../shared/chatContext";
import { DEFAULT_CHAT_PROMPT } from "../shared/prompts";
import { t, type UiLanguage } from "../shared/i18n";
import { getSettings } from "../shared/storage";
import {
  chatViaProvider,
  chatViaProviderStream,
  type ChatMessage,
} from "./providerClient";
import { AstraError } from "./errors";

/** Hard cap on one user input (popup enforces the same via maxLength). */
const MAX_INPUT_CHARS = 8000;
/** Hard cap on attached page context (popup slices to less already). */
const MAX_ATTACH_TEXT_CHARS = 4000;
/** Turns kept in storage for display — older ones roll off. */
const MAX_STORED_TURNS = 60;

/** Accept only a well-formed attachment, with every field length-bounded. */
function sanitizeAttachment(raw: unknown): ChatAttachment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Partial<ChatAttachment>;
  if (typeof a.text !== "string" || !a.text.trim()) return undefined;
  return {
    title: typeof a.title === "string" ? a.title.slice(0, 200) : "",
    url: typeof a.url === "string" ? a.url.slice(0, 500) : "",
    selected: !!a.selected,
    text: a.text.slice(0, MAX_ATTACH_TEXT_CHARS),
  };
}

function emptyChatState(): ChatState {
  return { turns: [], pending: false, gen: 0 };
}

// In-memory fallback so chat still works (per-SW-lifetime) on the rare
// Chrome build without chrome.storage.session.
let memState: ChatState = emptyChatState();

async function loadChatState(): Promise<ChatState> {
  try {
    if (!chrome.storage.session) return memState;
    const res = await chrome.storage.session.get(CHAT_STORAGE_KEY);
    const state = res[CHAT_STORAGE_KEY] as ChatState | undefined;
    if (
      state &&
      Array.isArray(state.turns) &&
      typeof state.pending === "boolean" &&
      typeof state.gen === "number"
    ) {
      return state;
    }
  } catch {
    // fall through to empty
  }
  return emptyChatState();
}

async function saveChatState(state: ChatState): Promise<void> {
  memState = state;
  if (!chrome.storage.session) return;
  await chrome.storage.session.set({ [CHAT_STORAGE_KEY]: state });
}

// Single-writer discipline, same as the other stores: append-user,
// append-assistant and clear must never interleave on a stale snapshot.
let mutationChain: Promise<unknown> = Promise.resolve();
function serialized<T>(op: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(op, op);
  mutationChain = run.catch(() => {});
  return run;
}

function pushTrimmed(state: ChatState, turn: ChatTurn): void {
  state.turns.push(turn);
  if (state.turns.length > MAX_STORED_TURNS) {
    state.turns.splice(0, state.turns.length - MAX_STORED_TURNS);
  }
}

export async function getChatState(): Promise<{ success: true } & ChatState> {
  const state = await loadChatState();
  return { success: true, ...state };
}

/** Abort handle for the request currently in flight (stream path). */
let activeChatAbort: AbortController | null = null;

export async function clearChat(): Promise<{ success: true }> {
  // Stop wasting tokens on a reply that is about to be dropped anyway —
  // the gen bump below guarantees it can't land in the fresh conversation.
  activeChatAbort?.abort();
  await serialized(async () => {
    const prev = await loadChatState();
    // gen bump: an in-flight reply from before the clear must not be
    // appended onto the fresh conversation when it eventually lands.
    await saveChatState({ turns: [], pending: false, gen: prev.gen + 1 });
  });
  return { success: true };
}

/**
 * A service-worker (re)start means any previously in-flight request died
 * with the old worker — clear a stuck pending flag so the popup isn't
 * blocked behind an answer that can never arrive. Called at SW startup.
 */
export function resetStaleChatPending(): void {
  void serialized(async () => {
    const state = await loadChatState();
    if (state.pending) {
      state.pending = false;
      await saveChatState(state);
    }
  });
}

function systemPromptFor(settings: AstraSettings, lang: UiLanguage): string {
  const answerLang =
    lang === "zh-CN"
      ? "Simplified Chinese"
      : lang === "ja-JP"
        ? "Japanese"
        : "English";
  const custom = settings.chatPrompt?.trim();
  return (custom || DEFAULT_CHAT_PROMPT).replace(/\{\{lang\}\}/g, answerLang);
}

/**
 * One full exchange: append the user's message, call the provider with
 * bounded context (streaming deltas to `onDelta` when given), append the
 * reply (or an error turn). Every step is persisted, so a popup that closes
 * mid-request finds the finished answer on reopen.
 */
async function runChatExchange(
  rawText: string,
  rawAttachment?: unknown,
  onDelta?: (delta: string) => void
): Promise<ChatResponse> {
  const text = rawText.trim().slice(0, MAX_INPUT_CHARS);
  const attachment = sanitizeAttachment(rawAttachment);
  const settings = await getSettings();
  const lang: UiLanguage = settings.uiLanguage || "zh-CN";

  if (!text) {
    return { success: false, error: t(lang, "chat.failed"), appended: false };
  }
  if (!settings.apiKey) {
    return {
      success: false,
      error: t(lang, "error.apiKeyNotConfigured"),
      errorCode: "API_KEY_MISSING",
      appended: false,
    };
  }

  // Claim the pending slot and append the user turn atomically.
  const claim = await serialized(async () => {
    const state = await loadChatState();
    if (state.pending) return null;
    const userTurn: ChatTurn = { role: "user", content: text, ts: Date.now() };
    if (attachment) userTurn.attachment = attachment;
    pushTrimmed(state, userTurn);
    state.pending = true;
    await saveChatState(state);
    return { gen: state.gen, context: buildChatContext(state.turns) };
  });
  if (!claim) {
    return {
      success: false,
      error: t(lang, "chat.busy"),
      errorCode: "CHAT_BUSY",
      appended: false,
    };
  }

  const controller = new AbortController();
  activeChatAbort = controller;

  let reply: ChatTurn;
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPromptFor(settings, lang) },
      ...claim.context,
    ];
    const content = onDelta
      ? await chatViaProviderStream(settings, messages, onDelta, lang, controller.signal)
      : await chatViaProvider(settings, messages, lang);
    reply = { role: "assistant", content, ts: Date.now() };
  } catch (err) {
    const message =
      err instanceof AstraError
        ? err.message
        : err instanceof Error && err.message
          ? err.message
          : t(lang, "chat.failed");
    reply = { role: "assistant", content: message, ts: Date.now(), error: true };
  } finally {
    if (activeChatAbort === controller) activeChatAbort = null;
  }

  const committed = await serialized(async () => {
    const state = await loadChatState();
    // Cleared while we were waiting — this reply belongs to a conversation
    // that no longer exists. pending is owned by the newer generation.
    if (state.gen !== claim.gen) return false;
    pushTrimmed(state, reply);
    state.pending = false;
    await saveChatState(state);
    return true;
  });

  if (!committed) {
    // Deliberately quiet: the user cleared the conversation mid-flight, so
    // there is nothing to render and no error worth surfacing.
    return { success: false, errorCode: "CHAT_CANCELLED", appended: false };
  }

  return reply.error
    ? { success: false, error: reply.content, appended: true }
    : { success: true, appended: true };
}

/** One-shot exchange (fallback path when the stream port is unavailable). */
export async function sendChatMessage(
  rawText: string,
  rawAttachment?: unknown
): Promise<ChatResponse> {
  return runChatExchange(rawText, rawAttachment);
}

/**
 * Streaming exchange over a long-lived port: {type:"delta"} per fragment,
 * then {type:"done"} carrying the same ChatResponse shape as the one-shot
 * path. The port closing mid-stream does NOT cancel the request — the reply
 * still persists to storage so the reopened popup finds it. Only CLEAR_CHAT
 * aborts an in-flight request.
 */
export async function handleChatStream(
  msg: ChatStreamRequest,
  rawPost: (event: ChatStreamEvent) => void
): Promise<void> {
  const requestId =
    typeof msg.payload?.requestId === "string" ? msg.payload.requestId : undefined;
  const post = (event: ChatStreamEvent): void => {
    rawPost(requestId ? { ...event, requestId } : event);
  };

  const result = await runChatExchange(
    typeof msg.payload?.text === "string" ? msg.payload.text : "",
    msg.payload?.attachment,
    (delta) => post({ type: "delta", text: delta })
  );
  post({ type: "done", ...result });
}
