// ============================================================
// Astra Translate – Live Translation Background Service
// ============================================================

import type {
  LiveSubtitleHistoryItem,
  LiveTranslateState,
  LiveTranslateStatusKind,
  AstraSettings,
} from "../shared/types";
import { getSettings } from "../shared/storage";
import { injectGlossaryIntoPrompt } from "../shared/glossary";

let activeTabId: number | null = null;
let currentState: LiveTranslateState = {
  running: false,
  status: "idle",
  message: "未开启",
};

let subtitleHistory: LiveSubtitleHistoryItem[] = [];
let currentSentence: {
  id: string;
  startTime: number;
  original: string;
  translation: string;
} | null = null;

let sentenceIdleTimer: ReturnType<typeof setTimeout> | null = null;
const SENTENCE_IDLE_TIMEOUT_MS = 2500;

async function ensureOffscreenDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  const existingContexts = await (chrome.runtime as any).getContexts?.({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts && existingContexts.length > 0) {
    return;
  }

  // Fallback check or create
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [
        chrome.offscreen.Reason.USER_MEDIA,
        chrome.offscreen.Reason.AUDIO_PLAYBACK,
      ],
      justification: "Capture tab audio for real-time speech translation and subtitle overlay",
    });
  } catch (err: any) {
    if (!err.message?.includes("Only a single offscreen document may be created")) {
      console.debug("[Astra Live] Failed to create offscreen document:", err);
      throw err;
    }
  }
}

export function getLiveTranslateState(): LiveTranslateState {
  return { ...currentState, tabId: activeTabId ?? undefined };
}

export function getLiveSubtitleHistory(): LiveSubtitleHistoryItem[] {
  return [...subtitleHistory];
}

export function clearLiveSubtitleHistory(): void {
  subtitleHistory = [];
  currentSentence = null;
  if (sentenceIdleTimer) {
    clearTimeout(sentenceIdleTimer);
    sentenceIdleTimer = null;
  }
}

export async function startLiveTranslation(tabId?: number): Promise<{ success: boolean; error?: string }> {
  const settings = await getSettings();

  // Determine Gemini API key
  let apiKey = "";
  if (settings.providerId === "google-gemini" && settings.apiKey) {
    apiKey = settings.apiKey;
  } else if (settings.providerConfigs?.["google-gemini"]?.apiKey) {
    apiKey = settings.providerConfigs["google-gemini"].apiKey;
  } else if (settings.apiKey) {
    apiKey = settings.apiKey;
  }

  if (!apiKey) {
    return {
      success: false,
      error: "请先在设置中配置 Google Gemini (AI Studio) 的 API Key",
    };
  }

  // Determine target tab
  let targetTab: chrome.tabs.Tab | undefined;
  if (tabId) {
    targetTab = await chrome.tabs.get(tabId).catch(() => undefined);
  } else {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    targetTab = active;
  }

  if (!targetTab?.id) {
    return { success: false, error: "未找到可捕获音频的网页标签页" };
  }

  const tabUrl = targetTab.url || "";
  if (
    tabUrl.startsWith("chrome://") ||
    tabUrl.startsWith("chrome-extension://") ||
    tabUrl.startsWith("edge://") ||
    tabUrl.startsWith("about:") ||
    tabUrl.includes("chromewebstore.google.com")
  ) {
    return {
      success: false,
      error: "Chrome 限制：无法在系统/设置页捕获音频，请在视频或普通网页（如 YouTube、B站 等）中开启同传。",
    };
  }

  const targetTabId = targetTab.id;
  activeTabId = targetTabId;

  try {
    await ensureOffscreenDocument();

    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId }, (id) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!id) {
          reject(new Error("Failed to get media stream ID"));
        } else {
          resolve(id);
        }
      });
    });

    const basePrompt = settings.liveTranslatePrompt || "Translate speech into {{targetLang}}";
    const promptWithLang = basePrompt.replace(/\{\{targetLang\}\}/g, settings.liveTranslateTargetLang);
    const effectivePrompt = injectGlossaryIntoPrompt(promptWithLang, settings.customGlossary);


    // Send start message to offscreen
    await chrome.runtime.sendMessage({
      type: "OFFSCREEN_START_CAPTURE",
      payload: {
        streamId,
        apiKey,
        model: settings.liveTranslateModel || "models/gemini-3.5-live-translate-preview",
        targetLang: settings.liveTranslateTargetLang || "Simplified Chinese",
        prompt: effectivePrompt,
        vadEnabled: settings.liveTranslateVadEnabled,
        vadThreshold: settings.liveTranslateVadThreshold,
        showOriginal: settings.liveTranslateShowOriginal,
      },
    });

    currentState = {
      running: true,
      status: "connecting",
      message: "正在连接…",
      tabId: activeTabId,
    };

    // Tell content script to show subtitle HUD
    try {
      await chrome.tabs.sendMessage(activeTabId, {
        type: "LIVE_SUBTITLE_START_HUD",
        payload: {
          showOriginal: settings.liveTranslateShowOriginal,
          fontSize: settings.liveTranslateFontSize,
          bgOpacity: settings.liveTranslateBgOpacity,
        },
      });
    } catch {}

    return { success: true };
  } catch (err: any) {
    console.warn("[Astra Live] startLiveTranslation caught error:", err);
    let errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("Extension has not been invoked") || errMsg.includes("activeTab permission")) {
      errMsg = "Chrome 限制：无法在系统/设置页捕获音频，请在视频或普通网页（如 YouTube、B站 等）中开启同传。";
    }
    currentState = {
      running: false,
      status: "error",
      message: errMsg,
    };
    return { success: false, error: errMsg };
  }
}

export async function stopLiveTranslation(): Promise<{ success: boolean }> {
  try {
    await chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP_CAPTURE" });
  } catch {}

  flushCurrentSentence();

  if (activeTabId) {
    try {
      await chrome.tabs.sendMessage(activeTabId, {
        type: "LIVE_SUBTITLE_STOP_HUD",
      });
    } catch {}
  }

  currentState = {
    running: false,
    status: "idle",
    message: "已停止",
  };
  activeTabId = null;

  return { success: true };
}

function flushCurrentSentence() {
  if (sentenceIdleTimer) {
    clearTimeout(sentenceIdleTimer);
    sentenceIdleTimer = null;
  }
  if (currentSentence && (currentSentence.translation || currentSentence.original)) {
    subtitleHistory.push({
      ...currentSentence,
      endTime: Date.now(),
    });
    // Keep max 500 history items
    if (subtitleHistory.length > 500) {
      subtitleHistory = subtitleHistory.slice(-500);
    }
  }
  currentSentence = null;
}

export function handleOffscreenStatus(payload: {
  running: boolean;
  status: LiveTranslateStatusKind;
  message?: string;
  level?: number;
}) {
  currentState = {
    running: payload.running,
    status: payload.status,
    message: payload.message || currentState.message,
    tabId: activeTabId ?? undefined,
    level: payload.level,
  };

  // Forward status to active tab content script
  broadcastToCurrentTabs({
    type: "LIVE_TRANSLATE_STATUS",
    payload: currentState,
  });
}

export function handleOffscreenSubtitle(payload: {
  text?: string;
  original?: string;
  isFinal?: boolean;
  timestamp?: number;
}) {
  const deltaText = payload.text || "";
  const deltaOrig = payload.original || "";

  if (!currentSentence) {
    currentSentence = {
      id: "sub_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      startTime: payload.timestamp || Date.now(),
      original: deltaOrig,
      translation: deltaText,
    };
  } else {
    currentSentence.original += deltaOrig;
    currentSentence.translation += deltaText;
  }

  if (sentenceIdleTimer) {
    clearTimeout(sentenceIdleTimer);
  }

  if (payload.isFinal) {
    flushCurrentSentence();
  } else {
    sentenceIdleTimer = setTimeout(() => {
      flushCurrentSentence();
    }, SENTENCE_IDLE_TIMEOUT_MS);
  }

  // Forward subtitle delta to active tab content script
  broadcastToCurrentTabs({
    type: "LIVE_SUBTITLE_DATA",
    payload: {
      text: deltaText,
      original: deltaOrig,
      isFinal: payload.isFinal,
      fullTranslation: currentSentence?.translation || "",
      fullOriginal: currentSentence?.original || "",
    },
  });
}

async function broadcastToCurrentTabs(msg: { type: string; payload: any }) {
  try {
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, msg).catch(() => {});
    }
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id && activeTab.id !== activeTabId) {
      chrome.tabs.sendMessage(activeTab.id, msg).catch(() => {});
    }
  } catch {}
}

// Automatically sync HUD when user switches between browser tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!currentState.running) return;
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    const url = tab.url || "";
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const settings = await getSettings();
      await chrome.tabs.sendMessage(activeInfo.tabId, {
        type: "LIVE_SUBTITLE_START_HUD",
        payload: {
          showOriginal: settings.liveTranslateShowOriginal,
          fontSize: settings.liveTranslateFontSize,
          bgOpacity: settings.liveTranslateBgOpacity,
        },
      }).catch(() => {});
      await chrome.tabs.sendMessage(activeInfo.tabId, {
        type: "LIVE_TRANSLATE_STATUS",
        payload: currentState,
      }).catch(() => {});
    }
  } catch {}
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    void stopLiveTranslation();
  }
});

