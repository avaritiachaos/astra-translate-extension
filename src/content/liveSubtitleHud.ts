// ============================================================
// Astra Translate – Live Subtitle HUD Component
// ============================================================

import type { LiveTranslateStatusKind } from "../shared/types";

interface LiveHudOptions {
  showOriginal?: boolean;
  fontSize?: number;
  bgOpacity?: number;
}

const STORAGE_KEY_WIDTH = "astra_hud_width";
const STORAGE_KEY_HEIGHT = "astra_hud_height";
const STORAGE_KEY_POS_X = "astra_hud_pos_x";
const STORAGE_KEY_POS_Y = "astra_hud_pos_y";
const STORAGE_KEY_FONT_SIZE = "astra_hud_font_size";
const STORAGE_KEY_OPACITY = "astra_hud_opacity";

export class LiveSubtitleHud {
  private container: HTMLDivElement | null = null;
  private headerEl: HTMLDivElement | null = null;
  private statusDot: HTMLSpanElement | null = null;
  private statusText: HTMLSpanElement | null = null;
  private levelBar: HTMLDivElement | null = null;
  private originalEl: HTMLDivElement | null = null;
  private translationEl: HTMLDivElement | null = null;

  private isVisible = false;
  private showOriginal = true;
  private fontSize = 20;
  private bgOpacity = 80;
  private currentStatus: LiveTranslateStatusKind = "connecting";

  // Dragging & Resizing state
  private isDragging = false;
  private isResizing = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private resizeStartX = 0;
  private resizeStartY = 0;
  private resizeStartW = 0;
  private resizeStartH = 0;
  private posX = -1;
  private posY = -1;
  private customWidth = -1;
  private customHeight = -1;

  // Subtitle history in content script for export
  private historyItems: Array<{ original: string; translation: string; timestamp: number }> = [];

  constructor() {
    this.handleFullscreenChange = this.handleFullscreenChange.bind(this);
    document.addEventListener("fullscreenchange", this.handleFullscreenChange);
    this.loadSavedLayout();
  }

  private loadSavedLayout(): void {
    try {
      const savedW = localStorage.getItem(STORAGE_KEY_WIDTH);
      if (savedW) this.customWidth = parseInt(savedW, 10);
      const savedH = localStorage.getItem(STORAGE_KEY_HEIGHT);
      if (savedH) this.customHeight = parseInt(savedH, 10);
      const savedX = localStorage.getItem(STORAGE_KEY_POS_X);
      if (savedX) this.posX = parseInt(savedX, 10);
      const savedY = localStorage.getItem(STORAGE_KEY_POS_Y);
      if (savedY) this.posY = parseInt(savedY, 10);
      const savedFont = localStorage.getItem(STORAGE_KEY_FONT_SIZE);
      if (savedFont) this.fontSize = parseInt(savedFont, 10);
      const savedOpacity = localStorage.getItem(STORAGE_KEY_OPACITY);
      if (savedOpacity) this.bgOpacity = parseInt(savedOpacity, 10);
    } catch {}
  }

  public show(options?: LiveHudOptions): void {
    if (options) {
      if (options.showOriginal !== undefined) this.showOriginal = options.showOriginal;
      if (options.fontSize !== undefined && this.fontSize === 20) this.fontSize = options.fontSize;
      if (options.bgOpacity !== undefined && this.bgOpacity === 80) this.bgOpacity = options.bgOpacity;
    }

    if (!this.container) {
      this.createDom();
    }

    if (this.container) {
      this.container.style.display = "flex";
      this.isVisible = true;
      this.updateStyles();
      this.restorePositionAndSize();
    }
  }

  public hide(): void {
    if (this.container) {
      this.container.style.display = "none";
    }
    this.isVisible = false;
  }

  public updateSubtitle(deltaText?: string, deltaOrig?: string, fullTrans?: string, fullOrig?: string, isFinal?: boolean): void {
    if (!this.isVisible) this.show();

    if (fullTrans !== undefined && this.translationEl) {
      this.translationEl.textContent = fullTrans || (this.currentStatus === "connected" ? "……" : "");
    } else if (deltaText && this.translationEl) {
      this.translationEl.textContent = (this.translationEl.textContent || "") + deltaText;
    }

    if (this.showOriginal && this.originalEl) {
      if (fullOrig !== undefined) {
        this.originalEl.textContent = fullOrig;
      } else if (deltaOrig) {
        this.originalEl.textContent = (this.originalEl.textContent || "") + deltaOrig;
      }
    }

    if (isFinal && (fullTrans || fullOrig)) {
      this.historyItems.push({
        original: fullOrig || "",
        translation: fullTrans || "",
        timestamp: Date.now(),
      });
    }
  }

  public updateStatus(status: LiveTranslateStatusKind, message?: string, level?: number): void {
    this.currentStatus = status;
    if (!this.container) return;

    if (this.statusDot) {
      if (status === "connected") {
        this.statusDot.style.background = "#10B981"; // green
        this.statusDot.style.boxShadow = "0 0 8px #10B981";
      } else if (status === "connecting") {
        this.statusDot.style.background = "#F59E0B"; // yellow
        this.statusDot.style.boxShadow = "0 0 8px #F59E0B";
      } else if (status === "error") {
        this.statusDot.style.background = "#EF4444"; // red
        this.statusDot.style.boxShadow = "0 0 8px #EF4444";
      } else {
        this.statusDot.style.background = "#6B7280"; // gray
        this.statusDot.style.boxShadow = "none";
      }
    }

    if (this.statusText && message) {
      this.statusText.textContent = message;
    }

    if (this.levelBar && level !== undefined) {
      this.levelBar.style.width = `${Math.min(100, Math.max(0, level))}%`;
    }
  }

  public destroy(): void {
    document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
  }

  private handleFullscreenChange(): void {
    const fsEl = document.fullscreenElement;
    if (!this.container) return;

    if (fsEl && fsEl !== this.container.parentElement) {
      fsEl.appendChild(this.container);
      this.repositionDefault();
    } else if (!fsEl && this.container.parentElement !== document.body) {
      document.body.appendChild(this.container);
      this.repositionDefault();
    }
  }

  private createDom(): void {
    const container = document.createElement("div");
    container.id = "astra-live-subtitle-hud";
    container.style.cssText = `
      position: fixed;
      left: 50%;
      bottom: 60px;
      transform: translateX(-50%);
      width: min(860px, 90vw);
      min-width: 320px;
      max-width: 95vw;
      min-height: 70px;
      max-height: 80vh;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      padding: 12px 18px 16px 18px;
      border-radius: 18px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 14px 44px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.14) inset;
      backdrop-filter: blur(28px) saturate(190%);
      -webkit-backdrop-filter: blur(28px) saturate(190%);
      transition: box-shadow 0.2s ease, opacity 0.2s ease;
      user-select: none;
      overflow: hidden;
    `;

    // Header toolbar (Hover-revealed)
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      margin-bottom: 8px;
      cursor: grab;
      user-select: none;
    `;

    // Left status info
    const leftInfo = document.createElement("div");
    leftInfo.style.cssText = "display: flex; align-items: center; gap: 8px; font-size: 12px; color: rgba(255,255,255,0.7); pointer-events: none;";

    const dot = document.createElement("span");
    dot.style.cssText = "width: 8px; height: 8px; border-radius: 50%; background: #F59E0B; transition: all 0.3s ease;";
    this.statusDot = dot;

    const statusText = document.createElement("span");
    statusText.textContent = "Astra 实时同传";
    this.statusText = statusText;

    const levelTrack = document.createElement("div");
    levelTrack.style.cssText = "width: 40px; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.2); overflow: hidden;";
    const levelBar = document.createElement("div");
    levelBar.style.cssText = "width: 0%; height: 100%; background: #10B981; transition: width 0.1s ease;";
    levelTrack.appendChild(levelBar);
    this.levelBar = levelBar;

    leftInfo.appendChild(dot);
    leftInfo.appendChild(statusText);
    leftInfo.appendChild(levelTrack);

    // Right action buttons
    const rightActions = document.createElement("div");
    rightActions.style.cssText = "display: flex; align-items: center; gap: 6px;";

    const makeBtn = (label: string, title: string, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.title = title;
      btn.style.cssText = `
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.18);
        color: #FFFFFF;
        border-radius: 6px;
        padding: 2px 7px;
        font-size: 11px;
        cursor: pointer;
        outline: none;
        transition: all 0.15s ease;
        line-height: 1.4;
      `;
      btn.onmouseenter = () => (btn.style.background = "rgba(255, 255, 255, 0.3)");
      btn.onmouseleave = () => (btn.style.background = "rgba(255, 255, 255, 0.12)");
      btn.onclick = (e) => {
        e.stopPropagation();
        onClick();
      };
      return btn;
    };

    // Cycle Width Presets
    const widthPresets = [560, 860, 1160, -1];
    let currentWidthIdx = 1;
    const cycleWidthBtn = makeBtn("↔ 宽度", "快速切换字幕框宽度 (紧凑 / 标准 / 宽屏 / 自适应)", () => {
      currentWidthIdx = (currentWidthIdx + 1) % widthPresets.length;
      const targetW = widthPresets[currentWidthIdx];
      if (targetW === -1) {
        this.customWidth = -1;
        this.container!.style.width = "min(860px, 90vw)";
        localStorage.removeItem(STORAGE_KEY_WIDTH);
      } else {
        this.customWidth = targetW;
        this.container!.style.width = `${targetW}px`;
        localStorage.setItem(STORAGE_KEY_WIDTH, String(targetW));
      }
    });

    // Cycle Background Opacity
    const opacityPresets = [80, 50, 20, 95];
    let currentOpacityIdx = 0;
    const cycleOpacityBtn = makeBtn("🌗 透明度", "切换背景透明度 (80% / 50% / 20% / 95%)", () => {
      currentOpacityIdx = (currentOpacityIdx + 1) % opacityPresets.length;
      this.bgOpacity = opacityPresets[currentOpacityIdx];
      this.updateStyles();
      localStorage.setItem(STORAGE_KEY_OPACITY, String(this.bgOpacity));
    });

    // Toggle original
    const toggleOrigBtn = makeBtn("🌐 双语", "切换双语/单语显示", () => {
      this.showOriginal = !this.showOriginal;
      if (this.originalEl) {
        this.originalEl.style.display = this.showOriginal ? "block" : "none";
      }
    });

    // Font size -
    const fontMinusBtn = makeBtn("A-", "减小字号", () => {
      this.fontSize = Math.max(12, this.fontSize - 2);
      this.updateStyles();
      localStorage.setItem(STORAGE_KEY_FONT_SIZE, String(this.fontSize));
    });

    // Font size +
    const fontPlusBtn = makeBtn("A+", "加大字号", () => {
      this.fontSize = Math.min(48, this.fontSize + 2);
      this.updateStyles();
      localStorage.setItem(STORAGE_KEY_FONT_SIZE, String(this.fontSize));
    });

    // Export SRT
    const exportBtn = makeBtn("📥 SRT", "导出 SRT 字幕文件", () => {
      this.exportSrt();
    });

    // Stop button
    const closeBtn = makeBtn("✕", "停止并关闭同传", () => {
      chrome.runtime.sendMessage({ type: "LIVE_TRANSLATE_STOP" });
      this.hide();
    });

    rightActions.appendChild(cycleWidthBtn);
    rightActions.appendChild(cycleOpacityBtn);
    rightActions.appendChild(toggleOrigBtn);
    rightActions.appendChild(fontMinusBtn);
    rightActions.appendChild(fontPlusBtn);
    rightActions.appendChild(exportBtn);
    rightActions.appendChild(closeBtn);

    header.appendChild(leftInfo);
    header.appendChild(rightActions);
    this.headerEl = header;

    // Subtitle content body
    const originalEl = document.createElement("div");
    originalEl.id = "astra-hud-original";
    originalEl.style.cssText = `
      color: rgba(255, 255, 255, 0.7);
      margin-bottom: 4px;
      line-height: 1.4;
      text-shadow: 0 1px 3px rgba(0,0,0,0.8);
      word-break: break-word;
      transition: font-size 0.15s ease;
    `;
    this.originalEl = originalEl;

    const translationEl = document.createElement("div");
    translationEl.id = "astra-hud-translation";
    translationEl.style.cssText = `
      color: #FFFFFF;
      font-weight: 600;
      line-height: 1.45;
      text-shadow: 0 2px 4px rgba(0,0,0,0.9);
      word-break: break-word;
      transition: font-size 0.15s ease;
    `;
    translationEl.textContent = "等待音频输入…";
    this.translationEl = translationEl;

    // Drag-to-Resize Handle at Bottom-Right Corner
    const resizeHandle = document.createElement("div");
    resizeHandle.id = "astra-hud-resize-handle";
    resizeHandle.style.cssText = `
      position: absolute;
      right: 4px;
      bottom: 4px;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
      opacity: 0.45;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.8);
      user-select: none;
      transition: opacity 0.15s ease, transform 0.15s ease;
    `;
    resizeHandle.textContent = "◢";
    resizeHandle.title = "按住拖拽调节字幕框大小 (宽/高)";
    resizeHandle.onmouseenter = () => {
      resizeHandle.style.opacity = "1";
      resizeHandle.style.transform = "scale(1.2)";
    };
    resizeHandle.onmouseleave = () => {
      resizeHandle.style.opacity = "0.45";
      resizeHandle.style.transform = "scale(1)";
    };

    container.appendChild(header);
    container.appendChild(originalEl);
    container.appendChild(translationEl);
    container.appendChild(resizeHandle);

    // Setup dragging & resizing
    this.setupDragging(header, container);
    this.setupResizing(resizeHandle, container);

    document.body.appendChild(container);
    this.container = container;
  }

  private setupDragging(handle: HTMLElement, target: HTMLElement): void {
    handle.addEventListener("mousedown", (e) => {
      if (e.target instanceof HTMLButtonElement) return;
      this.isDragging = true;
      const rect = target.getBoundingClientRect();
      this.dragStartX = e.clientX - rect.left;
      this.dragStartY = e.clientY - rect.top;
      handle.style.cursor = "grabbing";
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isDragging || !this.container) return;
      const left = Math.max(10, Math.min(window.innerWidth - this.container.offsetWidth - 10, e.clientX - this.dragStartX));
      const top = Math.max(10, Math.min(window.innerHeight - this.container.offsetHeight - 10, e.clientY - this.dragStartY));

      this.container.style.transform = "none";
      this.container.style.left = `${left}px`;
      this.container.style.top = `${top}px`;
      this.container.style.bottom = "auto";
      this.posX = left;
      this.posY = top;
    });

    window.addEventListener("mouseup", () => {
      if (this.isDragging) {
        this.isDragging = false;
        handle.style.cursor = "grab";
        if (this.posX >= 0 && this.posY >= 0) {
          try {
            localStorage.setItem(STORAGE_KEY_POS_X, String(this.posX));
            localStorage.setItem(STORAGE_KEY_POS_Y, String(this.posY));
          } catch {}
        }
      }
    });
  }

  private setupResizing(handle: HTMLElement, target: HTMLElement): void {
    handle.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.isResizing = true;
      const rect = target.getBoundingClientRect();
      this.resizeStartX = e.clientX;
      this.resizeStartY = e.clientY;
      this.resizeStartW = rect.width;
      this.resizeStartH = rect.height;
      document.body.style.cursor = "nwse-resize";
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isResizing || !this.container) return;
      const deltaX = e.clientX - this.resizeStartX;
      const deltaY = e.clientY - this.resizeStartY;

      const newW = Math.max(320, Math.min(window.innerWidth - 20, this.resizeStartW + deltaX));
      const newH = Math.max(70, Math.min(window.innerHeight - 40, this.resizeStartH + deltaY));

      this.container.style.width = `${newW}px`;
      this.container.style.height = `${newH}px`;
      this.customWidth = newW;
      this.customHeight = newH;
    });

    window.addEventListener("mouseup", () => {
      if (this.isResizing) {
        this.isResizing = false;
        document.body.style.cursor = "default";
        try {
          if (this.customWidth > 0) localStorage.setItem(STORAGE_KEY_WIDTH, String(this.customWidth));
          if (this.customHeight > 0) localStorage.setItem(STORAGE_KEY_HEIGHT, String(this.customHeight));
        } catch {}
      }
    });
  }

  private restorePositionAndSize(): void {
    if (!this.container) return;

    if (this.customWidth > 0) {
      this.container.style.width = `${this.customWidth}px`;
    }
    if (this.customHeight > 0) {
      this.container.style.height = `${this.customHeight}px`;
    }

    if (this.posX >= 0 && this.posY >= 0) {
      const maxL = window.innerWidth - (this.container.offsetWidth || 400) - 10;
      const maxT = window.innerHeight - (this.container.offsetHeight || 100) - 10;
      const safeL = Math.max(10, Math.min(maxL, this.posX));
      const safeT = Math.max(10, Math.min(maxT, this.posY));
      this.container.style.transform = "none";
      this.container.style.left = `${safeL}px`;
      this.container.style.top = `${safeT}px`;
      this.container.style.bottom = "auto";
    } else {
      this.repositionDefault();
    }
  }

  private repositionDefault(): void {
    if (!this.container) return;
    this.container.style.left = "50%";
    this.container.style.bottom = "60px";
    this.container.style.top = "auto";
    this.container.style.transform = "translateX(-50%)";
  }

  private updateStyles(): void {
    if (!this.container) return;
    const bgAlpha = (this.bgOpacity / 100).toFixed(2);
    this.container.style.backgroundColor = `rgba(18, 18, 24, ${bgAlpha})`;

    if (this.originalEl) {
      this.originalEl.style.fontSize = `${Math.round(this.fontSize * 0.75)}px`;
      this.originalEl.style.display = this.showOriginal ? "block" : "none";
    }
    if (this.translationEl) {
      this.translationEl.style.fontSize = `${this.fontSize}px`;
    }
  }

  private exportSrt(): void {
    if (this.historyItems.length === 0) {
      alert("当前暂无同传记录");
      return;
    }

    let srtContent = "";
    let idx = 1;
    const baseTime = this.historyItems[0].timestamp;

    for (let i = 0; i < this.historyItems.length; i++) {
      const item = this.historyItems[i];
      const startMs = item.timestamp - baseTime;
      const endMs = startMs + 3000;

      const formatTime = (ms: number) => {
        const totalSec = Math.floor(ms / 1000);
        const hours = String(Math.floor(totalSec / 3600)).padStart(2, "0");
        const minutes = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
        const seconds = String(totalSec % 60).padStart(2, "0");
        const millis = String(ms % 1000).padStart(3, "0");
        return `${hours}:${minutes}:${seconds},${millis}`;
      };

      srtContent += `${idx}\n`;
      srtContent += `${formatTime(startMs)} --> ${formatTime(endMs)}\n`;
      if (this.showOriginal && item.original) {
        srtContent += `${item.original}\n`;
      }
      srtContent += `${item.translation}\n\n`;
      idx++;
    }

    const blob = new Blob([srtContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Astra_LiveSubtitle_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
