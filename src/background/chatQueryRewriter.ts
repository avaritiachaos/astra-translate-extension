// ============================================================
// Astra Translate – LLM Chat Query Rewriter & Intent Resolver
// ============================================================

import type { AstraSettings, ChatTurn } from "../shared/types.ts";
import { type UiLanguage } from "../shared/i18n.ts";
import { chatViaProvider, type ChatMessage } from "./providerClient.ts";
import { cleanChatSearchFallback, cleanQueryText } from "../shared/chatSearch.ts";

export interface ResolvedSearchQuery {
  shouldSearch: boolean;
  query?: string;
  isFallback?: boolean;
}

const REWRITE_SYSTEM_PROMPT = `You are an expert search query optimizer for an AI assistant.
Your job is to analyze the conversation history and the user's latest message to decide whether an internet search is needed, and if so, produce the single most effective web search query (1-4 concise keywords).

CRITICAL INSTRUCTIONS:
1. Context Disambiguation:
   - When the user uses pronouns, abbreviations, or refers back to earlier turns (e.g., "is it official?", "where to download?", "antigravity"), ALWAYS resolve the subject from the conversation history (e.g. "Google Antigravity 官方").
2. Handle Search Complaints & Retries:
   - If the user expresses frustration that the previous search was bad, missed, or wrong (e.g. "我不是给你开联网了吗？你查的什么玩意儿啊", "你搜的什么鬼", "重新搜", "查错了"), the user's INTENT IS TO RETRY THE SEARCH for the original unresolved topic from earlier turns! Look back at the conversation, find the core topic the user wanted to know about, and output the correct search query for it. DO NOT output NONE in this case.
3. Strip Conversational Noise:
   - Never include colloquial phrases ("你自己去查一下", "帮我搜一下", "告诉我"), emotional outbursts ("tmd", "卧槽"), complaints, or punctuation.
4. When to output NONE:
   - Output NONE only if the request is purely creative writing, code transformation, translation of provided text, greetings/thanks, or explicitly does not require web search.
5. Format:
   - Output ONLY the search query keywords or NONE. No explanations, no quotes, no markdown, no punctuation.`;

/**
 * Format the recent conversation history (up to last 4 turns) into a readable block.
 */
function formatHistory(turns: ChatTurn[]): string {
  if (!turns || turns.length === 0) return "";
  const recent = turns.slice(-4);
  const lines: string[] = [];
  for (const turn of recent) {
    const role = turn.role === "user" ? "User" : "Assistant";
    const text = (turn.content || "").trim().slice(0, 300);
    if (!text) continue;
    lines.push(`[${role}]: ${text}`);
  }
  return lines.join("\n");
}

/**
 * Clean model output into a valid search query or recognize NONE.
 */
export function sanitizeModelQueryOutput(rawOutput: string): { shouldSearch: boolean; query?: string } {
  let text = rawOutput.trim();
  // Strip code fences if present
  text = text.replace(/^```[a-z]*\s*/i, "").replace(/```$/, "").trim();
  // Strip common label prefixes like "Search Query:", "Query:", "搜索词："
  text = text.replace(/^(?:search query|query|keywords|search|搜索词|检索词|关键词)\s*[:：]\s*/i, "").trim();
  // Strip surrounding quotes
  text = text.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").trim();

  if (!text || /^none$/i.test(text) || text === "无" || text === "不需要搜索") {
    return { shouldSearch: false };
  }

  // Filter out any lingering noise or punctuation
  const cleaned = cleanQueryText(text).slice(0, 200);
  if (!cleaned || cleaned.length < 2) {
    return { shouldSearch: false };
  }

  return { shouldSearch: true, query: cleaned };
}

/**
 * Find the most recent previous user message in the conversation turns.
 */
function findPreviousUserText(historyTurns: ChatTurn[]): string | undefined {
  for (let i = historyTurns.length - 1; i >= 0; i--) {
    if (historyTurns[i].role === "user" && historyTurns[i].content?.trim()) {
      return historyTurns[i].content.trim();
    }
  }
  return undefined;
}

/**
 * Resolves the optimal web search query using the configured LLM with conversational context,
 * falling back gracefully to a robust rule-based cleaner if the model call fails or times out.
 */
export async function resolveSearchQuery(
  settings: AstraSettings,
  historyTurns: ChatTurn[],
  currentTurn: ChatTurn,
  lang: UiLanguage = "zh-CN",
  signal?: AbortSignal
): Promise<ResolvedSearchQuery> {
  const currentText = currentTurn.content || "";
  const pageTitle = currentTurn.attachment?.title;
  const prevUserText = findPreviousUserText(historyTurns);

  // If there is no API key configured, use rule-based fallback directly
  if (!settings.apiKey) {
    const fallback = cleanChatSearchFallback(currentText, pageTitle, prevUserText);
    return fallback
      ? { shouldSearch: true, query: fallback, isFallback: true }
      : { shouldSearch: false, isFallback: true };
  }

  try {
    const historyBlock = formatHistory(historyTurns);
    let userPrompt = "";
    if (historyBlock) {
      userPrompt += `Conversation history:\n${historyBlock}\n\n`;
    }
    if (pageTitle) {
      userPrompt += `Current page title hint: ${pageTitle}\n`;
    }
    userPrompt += `Latest user message: ${currentText}\n\nSearch query:`;

    const messages: ChatMessage[] = [
      { role: "system", content: REWRITE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    // Ultra-fast, single-turn query extraction with 3500ms deadline and minimum reasoning
    const rawResult = await chatViaProvider(settings, messages, lang, {
      signal,
      deadlineMs: 3500,
      maxRetries: 0,
      optionalBody: {
        max_tokens: 50,
        reasoning_effort: "low",
        thinking: { type: "disabled" },
      },
    });

    const parsed = sanitizeModelQueryOutput(rawResult);
    if (parsed.shouldSearch && parsed.query) {
      return { shouldSearch: true, query: parsed.query, isFallback: false };
    }
    return { shouldSearch: false, isFallback: false };
  } catch (err) {
    // Model timed out or errored: degrade seamlessly to rule-based fallback
    const fallback = cleanChatSearchFallback(currentText, pageTitle, prevUserText);
    return fallback
      ? { shouldSearch: true, query: fallback, isFallback: true }
      : { shouldSearch: false, isFallback: true };
  }
}
