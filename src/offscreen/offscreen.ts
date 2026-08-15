// ============================================================
// Astra Translate – Offscreen Audio Capture & Gemini Live Client
// ============================================================

import type { LiveTranslateStatusKind } from "../shared/types";
import { langCode } from "../shared/lang";

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 1600; // ~100ms at 16kHz
const VAD_HANGOVER_CHUNKS = 8; // Keep sending ~800ms after speech ends
const WS_ENDPOINT = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

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
let isRunning = false;
let sessionGeneration = 0;
let resumeHandle = "";
let currentPayload: StartCapturePayload | null = null;

// Audio buffer accumulation for 16kHz
let pcm16Accumulator: Int16Array = new Int16Array(0);
let hangoverCounter = 0;
let lastLevelReportTime = 0;

function toGeminiLangCode(lang: string): string {
  const map: Record<string, string> = {
    "Simplified Chinese": "zh-CN",
    "Traditional Chinese": "zh-TW",
    "zh": "zh-CN",
    "zh-CN": "zh-CN",
    "zh-TW": "zh-TW",
    "English": "en",
    "Japanese": "ja",
    "Korean": "ko",
    "Spanish": "es",
    "French": "fr",
    "German": "de",
    "Russian": "ru",
    "Portuguese": "pt",
    "Arabic": "ar",
    "Italian": "it",
    "Dutch": "nl",
    "Polish": "pl",
    "Turkish": "tr",
    "Vietnamese": "vi",
    "Thai": "th",
    "Indonesian": "id",
    "Malay": "ms",
    "Hindi": "hi",
  };
  return map[lang] || langCode(lang) || "zh-CN";
}

function normalizeModel(model: string): string {
  if (!model) return "models/gemini-3.5-live-translate-preview";
  if (model.startsWith("models/")) return model;
  return `models/${model}`;
}

function broadcastStatus(status: LiveTranslateStatusKind, message?: string, level?: number) {
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

function broadcastSubtitle(deltaTranslation?: string, deltaOriginal?: string, isFinal?: boolean) {
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
  const uint8 = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
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
  inputSampleRate: number
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
      await audioContext.resume();
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
      const { pcm16, rms } = resampleAndConvert(inputBuffer, audioContext?.sampleRate || 48000);

      // Report volume level periodically
      const now = Date.now();
      if (now - lastLevelReportTime > 250) {
        lastLevelReportTime = now;
        const normalizedLevel = Math.min(100, Math.round((rms / 2000) * 100));
        broadcastStatus("connected", undefined, normalizedLevel);
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
    console.debug("[Astra Offscreen] Audio capture error:", err);
    isRunning = false;
    broadcastStatus("error", err instanceof Error ? err.message : "音频捕获失败");
  }
}

function initWebSocket(payload: StartCapturePayload, gen: number) {
  if (!isRunning || sessionGeneration !== gen) return;

  const url = `${WS_ENDPOINT}?key=${encodeURIComponent(payload.apiKey)}`;
  broadcastStatus("connecting", "正在连接 Gemini Live API…");

  try {
    ws = new WebSocket(url);
  } catch (err) {
    broadcastStatus("error", "无法建立 WebSocket 连接");
    return;
  }

  ws.onopen = () => {
    if (!isRunning || sessionGeneration !== gen || !ws) return;

    broadcastStatus("connecting", "已建立连接，正在完成握手…");

    const setupPayload: any = {
      setup: {
        model: normalizeModel(payload.model),
        generationConfig: {
          responseModalities: ["AUDIO"],
          translationConfig: {
            targetLanguageCode: toGeminiLangCode(payload.targetLang),
            echoTargetLanguage: false,
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: {
          triggerTokens: "0",
          slidingWindow: { targetTokens: "0" },
        },
        sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
      },
    };

    if (payload.prompt?.trim()) {
      setupPayload.setup.systemInstruction = {
        parts: [{ text: payload.prompt.trim() }],
      };
    }

    ws.send(JSON.stringify(setupPayload));
  };

  ws.onmessage = async (event) => {
    if (!isRunning || sessionGeneration !== gen) return;

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
        broadcastStatus("connected", "已就绪（正在监听标签页声音）");
      }

      if (data.goAway) {
        console.log("[Astra Offscreen] Gemini Live session expiring (goAway), reconnecting...");
        reconnectWithBackoff(payload, gen);
        return;
      }

      if (data.error) {
        const errMsg = data.error.message || JSON.stringify(data.error);
        console.debug("[Astra Offscreen] Gemini error:", errMsg);
        if (errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("rate limit") || errMsg.toLowerCase().includes("resource_exhausted")) {
          broadcastStatus("info", "触发配额限制，稍后重连…");
          reconnectWithBackoff(payload, gen, 3000);
        } else {
          broadcastStatus("error", `Gemini 错误: ${errMsg}`);
        }
        return;
      }

      const serverContent = data.serverContent;
      if (serverContent) {
        // Spoken original transcript
        let deltaOriginal = "";
        if (serverContent.inputTranscription?.text) {
          deltaOriginal += serverContent.inputTranscription.text;
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

        const isTurnComplete = Boolean(serverContent.turnComplete || serverContent.generationComplete);

        if (deltaTranslation || deltaOriginal || isTurnComplete) {
          broadcastSubtitle(deltaTranslation, deltaOriginal, isTurnComplete);
        }
      }
    } catch {
      // Ignore non-JSON frames
    }
  };

  ws.onerror = () => {
    // Suppress unhandled event errors in extensions UI
  };

  ws.onclose = (event) => {
    if (!isRunning || sessionGeneration !== gen) return;
    console.debug(`[Astra Offscreen] WebSocket closed: code=${event.code} reason=${event.reason}`);
    reconnectWithBackoff(payload, gen);
  };
}

let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
function reconnectWithBackoff(payload: StartCapturePayload, gen: number, delayMs = 1500) {
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

function sendAudioChunk(pcm16: Int16Array) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

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


function stopAudioCapture() {
  isRunning = false;
  sessionGeneration++;
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

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
  hangoverCounter = 0;
  broadcastStatus("idle", "已停止");
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "OFFSCREEN_START_CAPTURE") {
    startAudioCapture(msg.payload);
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === "OFFSCREEN_STOP_CAPTURE") {
    stopAudioCapture();
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === "OFFSCREEN_GET_STATE") {
    sendResponse({
      running: isRunning,
      payload: currentPayload,
    });
    return true;
  }
});
