/**
 * Patterns representing requests to retry a failed/incorrect search
 * or complaining that the previous search was wrong/missed.
 */
const SEARCH_RETRY_OR_COMPLAINT_PATTERNS = [
  /(?:我不是[给让]?你?开[了]?联网[了吗]*)/i,
  /(?:你?查[的了]?什么玩意[儿]?|你?搜[的了]?什么玩意[儿]?)/i,
  /(?:乱搜|瞎搜|搜错[了]?|查错[了]?|重新[查搜]|重新联网)/i,
];

/**
 * Patterns representing pure chitchat or pure confirmation that do NOT need search.
 */
const PURE_CHITCHAT_PATTERNS = [
  /^(?:你好|您好|嗨|hello|hi|hey|在吗|在么)+(?:啊|呀|呢|哈|嘛)?[!！~。\s]*$/i,
  /^(?:谢谢|多谢|感谢|thx|thanks|thank you)+(?:啦|了|你)?(?:啊|呀|呢|哈|嘛)?[!！~。\s]*$/i,
  /^(?:好的|收到|ok|okay|明白|了解|行)+(?:啦|了)?(?:啊|呀|呢|哈|嘛)?[!！~。\s]*$/i,
];

/**
 * Noise phrases, filler commands, and emotional words to strip from queries.
 */
const STRIP_NOISE_PATTERNS = [
  /\b(?:tmd|tm|wtf)\b/gi,
  /(?:他妈的|卧槽|我靠|我擦|凭什么|真是的|混蛋)/g,
  /(?:你自己去[查搜]一下看看(?:是不是)?|你自己去[查搜][一]?下|你去[查搜][一]?下|帮我[查搜]一下|帮我[查搜][查搜]|帮我找找)/g,
  /(?:[查搜]一下看看(?:是不是)?|[查搜]一下|[查搜]找|去[查搜]|给我[查搜])/g,
  /(?:我想知道|请问一下|请问|告诉我|能不能告诉我)/g,
  /\b(?:can you )?(?:please )?(?:search for|look up|find out|tell me about)\b/gi,
  /\b(?:google|search) (?:it|this)\b/gi,
];

/**
 * Check if the text is a complaint about previous search results or asking to re-search.
 */
export function isSearchComplaintOrRetry(text: string): boolean {
  return SEARCH_RETRY_OR_COMPLAINT_PATTERNS.some((p) => p.test(text));
}

/**
 * Clean conversational noise from query text.
 */
export function cleanQueryText(text: string): string {
  let cleaned = text.trim();
  for (const pattern of STRIP_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }
  // Strip excessive punctuation and whitespace
  cleaned = cleaned.replace(/[？?！!。，,;；"“”'‘’`~]+/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned;
}

/**
 * Rule-based fallback query cleaner.
 * If the current text is a complaint about previous search ("你查的什么玩意儿", "我不是给你开联网了吗"),
 * it extracts the query from the previous user turn if provided.
 */
export function cleanChatSearchFallback(
  text: string,
  pageTitle?: string,
  previousUserTurnText?: string
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  for (const pattern of PURE_CHITCHAT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return null;
    }
  }

  // If the user is complaining about the previous search, fallback to previous topic!
  if (isSearchComplaintOrRetry(trimmed)) {
    if (previousUserTurnText?.trim()) {
      const prevCleaned = cleanQueryText(previousUserTurnText).slice(0, 200);
      if (prevCleaned && prevCleaned.length >= 2) {
        return buildChatSearchQuery(prevCleaned, pageTitle);
      }
    }
  }

  const cleaned = cleanQueryText(trimmed).slice(0, 200);
  if (!cleaned || cleaned.length < 2) {
    // If user text had no substance but pageTitle is present and useful
    const title = pageTitle?.trim().slice(0, 80);
    return title && title.length >= 2 ? title : null;
  }

  return buildChatSearchQuery(cleaned, pageTitle);
}


/**
 * Build a concise search query from a user question and optional page title.
 * The complete question wins; a title is added only when it is meaningfully
 * useful and fits within the external search backend's 400-char limit.
 */
export function buildChatSearchQuery(text: string, pageTitle?: string): string {
  const base = text.trim().slice(0, 400);
  const title = pageTitle?.trim().slice(0, 80) ?? "";
  const titleBudget = 400 - base.length - 1;
  if (titleBudget < 10 || !title || base.includes(title)) return base;
  return `${base} ${title.slice(0, titleBudget)}`;
}

