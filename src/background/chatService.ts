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
  type ChatResponse,
  type ChatState,
  type ChatTurn,
} from "../shared/types";
import { buildChatContext } from "../shared/chatContext";
import { t, type UiLanguage } from "../shared/i18n";
import { getSettings } from "../shared/storage";
import { chatViaProvider, type ChatMessage } from "./providerClient";
import { AstraError } from "./errors";

/** Hard cap on one user input (popup enforces the same via maxLength). */
const MAX_INPUT_CHARS = 8000;
/** Turns kept in storage for display — older ones roll off. */
const MAX_STORED_TURNS = 60;

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

export async function clearChat(): Promise<{ success: true }> {
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

function systemPromptFor(lang: UiLanguage): string {
  const answerLang =
    lang === "zh-CN"
      ? "Simplified Chinese"
      : lang === "ja-JP"
        ? "Japanese"
        : "English";
  return (
    "You are Astra, a concise general assistant built into a browser " +
    "translation extension. Users drop in with quick questions — often about " +
    "language, wording or whatever page they are reading, but anything goes. " +
    `Answer in ${answerLang} unless the user asks for another language. ` +
    "Prefer short, direct answers in plain text; no markdown headings."
  );
}

/**
 * Append the user's message, call the provider with bounded context, append
 * the reply (or an error turn). The whole exchange is persisted step by step,
 * so a popup that closes mid-request finds the finished answer on reopen.
 */
export async function sendChatMessage(rawText: string): Promise<ChatResponse> {
  const text = rawText.trim().slice(0, MAX_INPUT_CHARS);
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
    pushTrimmed(state, { role: "user", content: text, ts: Date.now() });
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

  let reply: ChatTurn;
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPromptFor(lang) },
      ...claim.context,
    ];
    const content = await chatViaProvider(settings, messages, lang);
    reply = { role: "assistant", content, ts: Date.now() };
  } catch (err) {
    const message =
      err instanceof AstraError
        ? err.message
        : err instanceof Error && err.message
          ? err.message
          : t(lang, "chat.failed");
    reply = { role: "assistant", content: message, ts: Date.now(), error: true };
  }

  await serialized(async () => {
    const state = await loadChatState();
    // Cleared while we were waiting — this reply belongs to a conversation
    // that no longer exists. pending is owned by the newer generation.
    if (state.gen !== claim.gen) return;
    pushTrimmed(state, reply);
    state.pending = false;
    await saveChatState(state);
  });

  return reply.error
    ? { success: false, error: reply.content, appended: true }
    : { success: true, appended: true };
}
