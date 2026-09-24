import {
  cancelMangaTab,
  activeMangaJobs,
  startMangaJob,
  cancelMangaJob,
  mangaJobStatus,
  onMangaIdle,
} from "./manga/mangaJobRunner";
// ============================================================
// Astra Translate – Offscreen Audio Capture & Gemini Live Client
// ============================================================

import type { LiveTranslateStatusKind } from "../shared/types";
import { langCode } from "../shared/lang";

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 1600; // ~100ms at 16kHz
const MAX_PENDING_AUDIO_SAMPLES = TARGET_SAMPLE_RATE * 2;
const VAD_HANGOVER_CHUNKS = 8; // Keep sending ~800ms after speech ends
const WS_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

interface StartCapturePayload {
  streamId: string;
  apiKey: string;
  model: string;
  targetLang: string;
  prompt?: string;
  vadEnabled?: boolean;
  vadThreshold?: number;
  showOriginal?: boolean;
}

let activeStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let processorNode: ScriptProcessorNode | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;

let ws: WebSocket | null = null;
// Gemini Live accepts realtime input only after it acknowledges the setup
// message. Audio capture can start first, so keep the two states separate.
let wsSetupComplete = false;
let isRunning = false;
let sessionGeneration = 0;
let resumeHandle = "";
let currentPayload: StartCapturePayload | null = null;

// Audio buffer accumulation for 16kHz
let pcm16Accumulator: Int16Array = new Int16Array(0);
let pendingAudioChunks: Int16Array[] = [];
let pendingAudioSamples = 0;
let hangoverCounter = 0;
let lastLevelReportTime = 0;

function toGeminiLangCode(lang: string): string {
  const map: Record<string, string> = {
    "Simplified Chinese": "zh-CN",
    "Traditional Chinese": "zh-TW",
    zh: "zh-CN",
    "zh-CN": "zh-CN",
    "zh-TW": "zh-TW",
    English: "en",
    Japanese: "ja",
    Korean: "ko",
    Spanish: "es",
    French: "fr",
    German: "de",
    Russian: "ru",
    Portuguese: "pt",
    Arabic: "ar",
    Italian: "it",
    Dutch: "nl",
    Polish: "pl",
    Turkish: "tr",
    Vietnamese: "vi",
    Thai: "th",
    Indonesian: "id",
    Malay: "ms",
    Hindi: "hi",
  };
  return map[lang] || langCode(lang) || "zh-CN";
}

function normalizeModel(model: string): string {
  if (!model) return "models/gemini-3.5-live-translate-preview";
  if (model.startsWith("models/")) return model;
  return `models/${model}`;
}

function broadcastStatus(
  status: LiveTranslateStatusKind,
  message?: string,
  level?: number,
) {
  try {
    chrome.runtime.sendMessage({
      type: "LIVE_TRANSLATE_STATUS",
      payload: {
        running: isRunning,
        status,
        message,
        level,
      },
    });
  } catch {
    // runtime might not be listening
  }
}

function broadcastSubtitle(
  deltaTranslation?: string,
  deltaOriginal?: string,
  isFinal?: boolean,
) {
  try {
    chrome.runtime.sendMessage({
      type: "LIVE_SUBTITLE_DATA",
      payload: {
        text: deltaTranslation,
        original: deltaOriginal,
        isFinal,
        timestamp: Date.now(),
      },
    });
  } catch {
    // ignore
  }
}

function base64EncodePcm16(pcm16: Int16Array): string {
  const uint8 = new Uint8Array(
    pcm16.buffer,
    pcm16.byteOffset,
    pcm16.byteLength,
  );
  let binary = "";
  const len = uint8.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

/**
 * Resamples float32 audio from input sample rate to 16000 Hz
 * and converts to Int16 PCM.
 */
function resampleAndConvert(
  inputData: Float32Array,
  inputSampleRate: number,
): { pcm16: Int16Array; rms: number } {
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.round(inputData.length / ratio);
  const pcm16 = new Int16Array(outputLength);

  let sumSquares = 0;

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, inputData.length - 1);
    const fraction = srcIndex - i0;

    // Linear interpolation
    const sample = inputData[i0] * (1 - fraction) + inputData[i1] * fraction;

    // Clamp between -1.0 and 1.0
    const clamped = Math.max(-1.0, Math.min(1.0, sample));
    const int16Val = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    pcm16[i] = int16Val;

    sumSquares += int16Val * int16Val;
  }

  const rms = Math.sqrt(sumSquares / (outputLength || 1));
  return { pcm16, rms };
}

function appendPcm16(existing: Int16Array, incoming: Int16Array): Int16Array {
  const combined = new Int16Array(existing.length + incoming.length);
  combined.set(existing, 0);
  combined.set(incoming, existing.length);
  return combined;
}

async function startAudioCapture(payload: StartCapturePayload) {
  stopAudioCapture();
  // A stopped session's resumption handle must not leak into a new capture.
  // Handles are retained only while reconnecting the same live session.
  resumeHandle = "";
  wsSetupComplete = false;
  currentPayload = payload;
  isRunning = true;
  sessionGeneration++;
  const gen = sessionGeneration;

  broadcastStatus("connecting", "正在获取音频流…");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: payload.streamId,
        },
      } as any,
      video: false,
    });

    if (!isRunning || sessionGeneration !== gen) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    activeStream = stream;
    audioContext = new AudioContext();
    if (audioContext.state === "suspended") {
      // Offscreen documents do not always inherit the popup's user gesture.
      // A rejected resume must not discard an otherwise valid tab stream.
      try {
        await audioContext.resume();
      } catch (resumeError) {
        console.debug("[Astra Offscreen] AudioContext resume deferred:", resumeError);
      }
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.onmute = () =>
        broadcastStatus("info", "标签页音频被浏览器暂时静音");
      audioTrack.onunmute = () =>
        broadcastStatus("connected", "已恢复监听标签页声音");
      audioTrack.onended = () =>
        broadcastStatus("error", "标签页音频流已结束");
    }

    // Loopback: route tab audio to speakers so user can still hear
    sourceNode = audioContext.createMediaStreamSource(stream);
    sourceNode.connect(audioContext.destination);

    // Audio processor node for PCM sampling
    processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    const vadThreshold = payload.vadThreshold ?? 200;
    const vadEnabled = payload.vadEnabled !== false;

    processorNode.onaudioprocess = (e) => {
      if (!isRunning || sessionGeneration !== gen) return;

      if (audioContext?.state === "suspended") {
        audioContext.resume().catch(() => {});
      }

      const inputBuffer = e.inputBuffer.getChannelData(0);
      const { pcm16, rms } = resampleAndConvert(
        inputBuffer,
        audioContext?.sampleRate || 48000,
      );

      // Report volume level periodically
      const now = Date.now();
      if (now - lastLevelReportTime > 250) {
        lastLevelReportTime = now;
        const normalizedLevel = Math.min(100, Math.round((rms / 2000) * 100));
        broadcastStatus(
          wsSetupComplete ? "connected" : "connecting",
          undefined,
          normalizedLevel,
        );
      }

      const isVoice = !vadEnabled || rms >= vadThreshold;

      if (isVoice) {
        hangoverCounter = VAD_HANGOVER_CHUNKS;
      } else if (hangoverCounter > 0) {
        hangoverCounter--;
      }

      const shouldSend = isVoice || hangoverCounter > 0;

      if (shouldSend) {
        pcm16Accumulator = appendPcm16(pcm16Accumulator, pcm16);

        while (pcm16Accumulator.length >= CHUNK_SAMPLES) {
          const chunk = pcm16Accumulator.slice(0, CHUNK_SAMPLES);
          pcm16Accumulator = pcm16Accumulator.slice(CHUNK_SAMPLES);
          sendAudioChunk(chunk);
        }
      } else {
        // Clear accumulator during silence
        pcm16Accumulator = new Int16Array(0);
      }
    };

    sourceNode.connect(processorNode);
    // Connect to destination to keep ScriptProcessor running (Chrome requirement)
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    processorNode.connect(silentGain);
    silentGain.connect(audioContext.destination);

    // Start WebSocket connection
    initWebSocket(payload, gen);
  } catch (err) {
    const message = err instanceof Error ? err.message : "音频捕获失败";
    console.debug("[Astra Offscreen] Audio capture error:", err);
    stopAudioCapture("error", message);
  }
}

function initWebSocket(payload: StartCapturePayload, gen: number) {
  if (!isRunning || sessionGeneration !== gen) return;

  // A new socket has not completed the setup handshake yet. Do not send
  // realtime audio until Gemini acknowledges the setup message.
  wsSetupComplete = false;
  pendingAudioChunks = [];
  pendingAudioSamples = 0;
  const url = `${WS_ENDPOINT}?key=${encodeURIComponent(payload.apiKey)}`;
  broadcastStatus("connecting", "正在连接 Gemini Live API…");

  try {
    ws = new WebSocket(url);
  } catch (err) {
    broadcastStatus("error", "无法建立 WebSocket 连接");
    return;
  }

  const socket = ws;
  if (!socket) return;

  clearSocketSetupTimeout();
  socketSetupTimeout = setTimeout(() => {
    if (ws !== socket || !isRunning || wsSetupComplete) return;
    stopAudioCapture(
      "error",
      "Gemini Live 握手超时：检查网络、Gemini API Key 和模型访问权限",
    );
  }, SOCKET_SETUP_TIMEOUT_MS);

  socket.onopen = () => {
    if (ws !== socket || !isRunning || sessionGeneration !== gen) return;

    broadcastStatus("connecting", "已连接，等待 Gemini Live 握手…");

    const modelName = normalizeModel(payload.model);
    const isLiveTranslateModel = modelName.includes("live-translate");
    const setupPayload: any = {
      setup: {
        model: modelName,
        generationConfig: {
          responseModalities: ["AUDIO"],
          translationConfig: {
            targetLanguageCode: toGeminiLangCode(payload.targetLang),
            echoTargetLanguage: false,
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    };

    // Keep the dedicated translation model's setup equal to Google's
    // documented translation config. General Live models can use the
    // optional session/compression settings and custom instructions.
    if (!isLiveTranslateModel && resumeHandle) {
      setupPayload.setup.sessionResumption = { handle: resumeHandle };
    }

    if (payload.prompt?.trim() && !isLiveTranslateModel) {
      setupPayload.setup.systemInstruction = {
        parts: [{ text: payload.prompt.trim() }],
      };
    }

    socket.send(JSON.stringify(setupPayload));
  };

  socket.onmessage = async (event) => {
    if (ws !== socket || !isRunning || sessionGeneration !== gen) return;

    let rawText = "";
    if (typeof event.data === "string") {
      rawText = event.data;
    } else if (event.data instanceof Blob) {
      try {
        rawText = await event.data.text();
      } catch {
        return;
      }
    } else if (event.data instanceof ArrayBuffer) {
      try {
        rawText = new TextDecoder().decode(event.data);
      } catch {
        return;
      }
    }

    if (ws !== socket || !isRunning || sessionGeneration !== gen) return;
    if (!rawText || !rawText.trim().startsWith("{")) {
      return; // Ignore raw binary audio frames
    }

    try {
      const data = JSON.parse(rawText);

      if (data.sessionResumptionUpdate) {
        const upd = data.sessionResumptionUpdate;
        if (upd.newHandle) resumeHandle = upd.newHandle;
        else if (upd.handle) resumeHandle = upd.handle;
      }

      if (data.setupComplete) {
        // The Live API requires this acknowledgement before any
        // realtimeInput message is sent.
        wsSetupComplete = true;
        clearSocketSetupTimeout();
        flushPendingAudio();
        broadcastStatus("connected", "已就绪（正在监听标签页声音）");
      }

      if (data.goAway) {
        console.log(
          "[Astra Offscreen] Gemini Live session expiring (goAway), reconnecting...",
        );
        reconnectWithBackoff(payload, gen);
        return;
      }

      if (data.error) {
        const errMsg = data.error.message || JSON.stringify(data.error);
        console.debug("[Astra Offscreen] Gemini error:", errMsg);
        if (
          errMsg.toLowerCase().includes("quota") ||
          errMsg.toLowerCase().includes("rate limit") ||
          errMsg.toLowerCase().includes("resource_exhausted")
        ) {
          broadcastStatus("info", "触发配额限制，稍后重连…");
          reconnectWithBackoff(payload, gen, 3000);
        } else {
          stopAudioCapture("error", `Gemini 错误: ${errMsg}`);
        }
        return;
      }

      const serverContent = data.serverContent;
      if (serverContent) {
        // Spoken original transcript
        let deltaOriginal = "";
        if (serverContent.inputTranscription?.text) {
          deltaOriginal += serverContent.inputTranscription.text;
        } else if (serverContent.interimInputTranscription?.text) {
          deltaOriginal += serverContent.interimInputTranscription.text;
        } else if (serverContent.inputAudioTranscription?.parts) {
          for (const part of serverContent.inputAudioTranscription.parts) {
            if (part.text) deltaOriginal += part.text;
          }
        }

        // Translated text
        let deltaTranslation = "";
        if (serverContent.outputTranscription?.text) {
          deltaTranslation += serverContent.outputTranscription.text;
        } else if (serverContent.outputAudioTranscription?.parts) {
          for (const part of serverContent.outputAudioTranscription.parts) {
            if (part.text) deltaTranslation += part.text;
          }
        } else if (serverContent.modelTurn?.parts) {
          for (const part of serverContent.modelTurn.parts) {
            if (part.text) deltaTranslation += part.text;
          }
        }

        const isTurnComplete = Boolean(
          serverContent.turnComplete || serverContent.generationComplete,
        );

        if (deltaTranslation || deltaOriginal || isTurnComplete) {
          broadcastSubtitle(deltaTranslation, deltaOriginal, isTurnComplete);
        }
      }
    } catch {
      // Ignore non-JSON frames
    }
  };

  socket.onerror = () => {
    if (ws !== socket || !isRunning || sessionGeneration !== gen) return;
    // A browser WebSocket error is usually followed by a close event, but
    // repeatedly reconnecting can hide the real failure behind "connecting".
    // Stop here so the HUD can show an actionable error instead of waiting.
    stopAudioCapture(
      "error",
      "Gemini Live 连接失败；请检查 Gemini API Key、模型权限和网络",
    );
  };

  socket.onclose = (event) => {
    if (ws !== socket || !isRunning || sessionGeneration !== gen) return;
    const wasSetupComplete = wsSetupComplete;
    wsSetupComplete = false;
    clearSocketSetupTimeout();
    console.debug(
      `[Astra Offscreen] WebSocket closed: code=${event.code} reason=${event.reason}`,
    );
    if (!wasSetupComplete) {
      stopAudioCapture(
        "error",
        `Gemini Live 握手失败（WebSocket ${event.code}${event.reason ? `：${event.reason}` : ""}）`,
      );
      return;
    }
    reconnectWithBackoff(payload, gen);
  };
}

let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let socketSetupTimeout: ReturnType<typeof setTimeout> | null = null;
const SOCKET_SETUP_TIMEOUT_MS = 15_000;

function clearSocketSetupTimeout(): void {
  if (socketSetupTimeout) {
    clearTimeout(socketSetupTimeout);
    socketSetupTimeout = null;
  }
}

function reconnectWithBackoff(
  payload: StartCapturePayload,
  gen: number,
  delayMs = 1500,
) {
  clearSocketSetupTimeout();
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (!isRunning || sessionGeneration !== gen) return;

  if (ws) {
    try {
      ws.close();
    } catch {}
    ws = null;
  }

  broadcastStatus("connecting", `${Math.round(delayMs / 1000)} 秒后重新连接…`);
  reconnectTimeout = setTimeout(() => {
    if (isRunning && sessionGeneration === gen) {
      initWebSocket(payload, gen);
    }
  }, delayMs);
}

function enqueuePendingAudio(pcm16: Int16Array): void {
  const copy = pcm16.slice();
  pendingAudioChunks.push(copy);
  pendingAudioSamples += copy.length;
  while (pendingAudioSamples > MAX_PENDING_AUDIO_SAMPLES && pendingAudioChunks.length > 0) {
    const removed = pendingAudioChunks.shift();
    pendingAudioSamples -= removed?.length || 0;
  }
}

function flushPendingAudio(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN || !wsSetupComplete) return;
  const queued = pendingAudioChunks;
  pendingAudioChunks = [];
  pendingAudioSamples = 0;
  for (const chunk of queued) sendAudioChunk(chunk);
}

function sendAudioChunk(pcm16: Int16Array) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !wsSetupComplete) {
    if (isRunning) enqueuePendingAudio(pcm16);
    return;
  }

  const base64Audio = base64EncodePcm16(pcm16);
  // Send matching live-translate and Gemini Live protocol format
  const msg = {
    realtimeInput: {
      audio: {
        mimeType: "audio/pcm;rate=16000",
        data: base64Audio,
      },
    },
  };

  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    console.warn("[Astra Offscreen] sendAudioChunk error:", err);
  }
}

function stopAudioCapture(
  status: LiveTranslateStatusKind = "idle",
  message = "已停止",
) {
  isRunning = false;
  wsSetupComplete = false;
  resumeHandle = "";
  sessionGeneration++;
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  clearSocketSetupTimeout();

  if (ws) {
    try {
      ws.close();
    } catch {}
    ws = null;
  }

  if (processorNode) {
    try {
      processorNode.disconnect();
    } catch {}
    processorNode = null;
  }

  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch {}
    sourceNode = null;
  }

  if (audioContext) {
    try {
      audioContext.close();
    } catch {}
    audioContext = null;
  }

  if (activeStream) {
    try {
      activeStream.getTracks().forEach((track) => track.stop());
    } catch {}
    activeStream = null;
  }

  pcm16Accumulator = new Int16Array(0);
  pendingAudioChunks = [];
  pendingAudioSamples = 0;
  hangoverCounter = 0;
  broadcastStatus(status, message);
}

let audioStarting = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleIdleClose() {
  clearTimeout(idleTimer);
  if (isRunning || audioStarting || activeMangaJobs().length) return;
  idleTimer = setTimeout(() => {
    if (!isRunning && !audioStarting && !activeMangaJobs().length)
      void chrome.runtime
        .sendMessage({ type: "OFFSCREEN_IDLE" })
        .catch(() => {});
  }, 120_000);
}
onMangaIdle(scheduleIdleClose);
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Commands are sent by the service worker through runtime messaging. For
  // extension contexts Chrome may leave sender.url undefined; requiring an
  // extension URL here makes every command silently drop before capture starts.
  if (
    msg?.target !== "offscreen" ||
    sender.id !== chrome.runtime.id ||
    sender.tab ||
    (sender.url !== undefined &&
      !sender.url.startsWith(chrome.runtime.getURL("")))
  )
    return;
  if (msg.type === "ASTRA_HOST_PING") {
    sendResponse({ success: true });
    return;
  }
  if (msg.type === "ASTRA_HOST_STATE") {
    sendResponse({
      success: true,
      busy: isRunning || audioStarting || activeMangaJobs().length > 0,
    });
    return;
  }
  if (msg.type === "MANGA_EXECUTE") {
    clearTimeout(idleTimer);
    void startMangaJob(msg.payload)
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
        scheduleIdleClose();
      });
    return true;
  }
  if (msg.type === "MANGA_STATUS") {
    sendResponse({
      success: true,
      job: mangaJobStatus(msg.payload.id, msg.payload.owner),
    });
    return;
  }
  if (msg.type === "MANGA_CANCEL_TAB") {
    void cancelMangaTab(msg.payload.prefix).then(() => {
      sendResponse({ success: true });
      scheduleIdleClose();
    });
    return true;
  }
  if (msg.type === "MANGA_CANCEL") {
    void cancelMangaJob(msg.payload.id, msg.payload.owner).then((success) => {
      sendResponse({ success });
      scheduleIdleClose();
    });
    return true;
  }
  if (msg.type === "OFFSCREEN_START_CAPTURE") {
    clearTimeout(idleTimer);
    audioStarting = true;
    void startAudioCapture(msg.payload)
      .then(() =>
        sendResponse({
          success: isRunning,
          error: isRunning ? undefined : "音频捕获失败或已取消",
        }),
      )
      .catch((error) => sendResponse({ success: false, error: error.message }))
      .finally(() => {
        audioStarting = false;
        scheduleIdleClose();
      });
    return true;
  }
  if (msg.type === "OFFSCREEN_STOP_CAPTURE") {
    stopAudioCapture();
    sendResponse({ success: true });
    scheduleIdleClose();
    return;
  }
  if (msg.type === "OFFSCREEN_GET_STATE") {
    sendResponse({ running: isRunning });
    return;
  }
});
