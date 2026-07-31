// ============================================================
// Astra Translate – Ephemeral chat service (popup "chat" mode)
// ============================================================
// One browser-session conversation stored in chrome.storage.session:
// it survives popup close and service-worker idle death, and clears
// when the browser exits. The service worker owns every mutation;
// the popup renders from storage change events, so an answer that
// finishes while the popup is closed is waiting on next open.
//
// Optional "web supplement": when the user toggles it on for a turn,
// we run the built-in public search first, inject the hits into the user
// message context, and hang the sources on the assistant turn for
// citation chips. Translation paths never touch this.

import {
  CHAT_STORAGE_KEY,
  type AstraSettings,
  type ChatAttachment,
  type ChatResponse,
  type ChatSearchSource,
  type ChatState,
  type ChatStreamEvent,
  type ChatStreamPhase,
  type ChatStreamRequest,
  type ChatTurn,
} from "../shared/types";
import { buildChatContext, type ChatContextTurn } from "../shared/chatContext";
import { buildChatSearchQuery } from "../shared/chatSearch";
import { DEFAULT_CHAT_PROMPT } from "../shared/prompts";
import { t, type UiLanguage } from "../shared/i18n";
import { getSettings } from "../shared/storage";
import {
  chatViaProvider,
  chatViaProviderStream,
  type ChatMessage,
} from "./providerClient";
import { AstraError } from "./errors";
import { webSearch } from "./webSearchClient";

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

function systemPromptFor(
  settings: AstraSettings,
  lang: UiLanguage,
  withSearch: boolean
): string {
  const answerLang =
    lang === "zh-CN"
      ? "Simplified Chinese"
      : lang === "ja-JP"
        ? "Japanese"
        : "English";
  const custom = settings.chatPrompt?.trim();
  let prompt = (custom || DEFAULT_CHAT_PROMPT).replace(/\{\{lang\}\}/g, answerLang);
  if (withSearch) {
    prompt +=
      "\n\nWhen web search results are provided with the question, treat them " +
      "as primary evidence. Prefer short citations like [1] / [2] next to " +
      "claims drawn from them. If sources conflict, note the uncertainty.";
  }
  return prompt;
}

/** Build the search query from the question and a small page-title hint. */
function searchQueryFor(text: string, attachment?: ChatAttachment): string {
  return buildChatSearchQuery(text, attachment?.title);
}

interface RunOpts {
  rawText: string;
  rawAttachment?: unknown;
  webSearchRequested?: boolean;
  onDelta?: (delta: string) => void;
  onPhase?: (phase: ChatStreamPhase) => void;
}

/**
 * One full exchange: append the user's message, optionally search the web,
 * call the provider with bounded context (streaming deltas to `onDelta`
 * when given), append the reply (or an error turn). Every step is persisted,
 * so a popup that closes mid-request finds the finished answer on reopen.
 */
async function runChatExchange(opts: RunOpts): Promise<ChatResponse> {
  const text = opts.rawText.trim().slice(0, MAX_INPUT_CHARS);
  const attachment = sanitizeAttachment(opts.rawAttachment);
  const settings = await getSettings();
  const lang: UiLanguage = settings.uiLanguage || "zh-CN";
  const wantSearch = !!opts.webSearchRequested;

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

  // Pre-flight for web search: the user must enable it globally, but no
  // secondary search-provider credential is needed.
  if (wantSearch && !settings.chatWebSearchEnabled) {
    return {
      success: false,
      error: t(lang, "chat.searchDisabled"),
      errorCode: "SEARCH_DISABLED",
      appended: false,
    };
  }

  // Claim the pending slot and append the user turn atomically.
  const claim = await serialized(async () => {
    const state = await loadChatState();
    if (state.pending) return null;
    const userTurn: ChatTurn = { role: "user", content: text, ts: Date.now() };
    if (attachment) userTurn.attachment = attachment;
    if (wantSearch) userTurn.webSearch = true;
    pushTrimmed(state, userTurn);
    state.pending = true;
    await saveChatState(state);
    return { gen: state.gen, turns: state.turns.slice() };
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

  let sources: ChatSearchSource[] = [];
  let ungroundedSearchFallback = false;
  let reply: ChatTurn;
  try {
    if (wantSearch) {
      opts.onPhase?.("searching");
      // Search transport/HTTP failures stay explicit. A completed search with
      // no sources is different: answer normally, but label it as ungrounded.
      const search = await webSearch(
        searchQueryFor(text, attachment),
        lang,
        controller.signal
      );
      sources = search.sources;
      ungroundedSearchFallback = search.noResults;
    }

    opts.onPhase?.("answering");

    // Inject fresh search hits only onto the newest user turn for the model.
    const contextTurns: ChatContextTurn[] = claim.turns.map((turn, i) => {
      const base: ChatContextTurn = {
        role: turn.role,
        content: turn.content,
        error: turn.error,
        attachment: turn.attachment,
      };
      if (
        sources.length > 0 &&
        i === claim.turns.length - 1 &&
        turn.role === "user"
      ) {
        base.searchSources = sources;
      }
      return base;
    });

    const messages: ChatMessage[] = [
      { role: "system", content: systemPromptFor(settings, lang, wantSearch) },
      ...buildChatContext(contextTurns),
    ];
    const content = opts.onDelta
      ? await chatViaProviderStream(
          settings,
          messages,
          opts.onDelta,
          lang,
          controller.signal
        )
      : await chatViaProvider(settings, messages, lang);
    reply = { role: "assistant", content, ts: Date.now() };
    if (sources.length > 0) reply.sources = sources;
    if (ungroundedSearchFallback) reply.ungroundedSearchFallback = true;
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
  rawAttachment?: unknown,
  webSearchRequested?: boolean
): Promise<ChatResponse> {
  return runChatExchange({
    rawText,
    rawAttachment,
    webSearchRequested: !!webSearchRequested,
  });
}

/**
 * Streaming exchange over a long-lived port: optional {type:"phase"} for
 * search/answer progress, {type:"delta"} per fragment, then {type:"done"}
 * carrying the same ChatResponse shape as the one-shot path. The port
 * closing mid-stream does NOT cancel the request — the reply still persists
 * to storage so the reopened popup finds it. Only CLEAR_CHAT aborts an
 * in-flight request.
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

  const result = await runChatExchange({
    rawText: typeof msg.payload?.text === "string" ? msg.payload.text : "",
    rawAttachment: msg.payload?.attachment,
    webSearchRequested: !!msg.payload?.webSearch,
    onDelta: (delta) => post({ type: "delta", text: delta }),
    onPhase: (phase) => post({ type: "phase", phase }),
  });
  post({ type: "done", ...result });
}
