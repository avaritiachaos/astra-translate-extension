// ============================================================
// Astra Translate – Live Subtitle HUD Component
// (Ultimate Cinema-Grade Non-Deforming Subtitle Overlay)
// ============================================================

import type { LiveTranslateStatusKind } from "../shared/types";

interface LiveHudOptions {
  showOriginal?: boolean;
  fontSize?: number;
  bgOpacity?: number;
}

const STORAGE_KEY_WIDTH = "astra_hud_width";
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
  private toggleOrigBtn: HTMLButtonElement | null = null;

  private isVisible = false;
  private showOriginal = false; // Default: Single language (translated text only)
  private fontSize = 22;
  private bgOpacity = 80;
  private currentStatus: LiveTranslateStatusKind = "connecting";

  // Hover & Auto-hide toolbar timer
  private hideToolbarTimer: ReturnType<typeof setTimeout> | null = null;
  private isToolbarHovered = false;

  // Dragging state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private posX = -1;
  private posY = -1;
  private customWidth = -1;

  // Subtitle history in content script for export
  private historyItems: Array<{ original: string; translation: string; timestamp: number }> = [];

  constructor() {
    this.handleFullscreenChange = this.handleFullscreenChange.bind(this);
    document.addEventListener("fullscreenchange", this.handleFullscreenChange);
    this.loadSavedLayout();
  }

  private loadSavedLayout(): void {
    try {
      // Clean up any legacy height that caused box deformation
      localStorage.removeItem("astra_hud_height");

      const savedW = localStorage.getItem(STORAGE_KEY_WIDTH);
      if (savedW) this.customWidth = parseInt(savedW, 10);
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
      if (options.fontSize !== undefined && this.fontSize === 22) this.fontSize = options.fontSize;
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
      this.showToolbar();
      this.hideToolbar(2200);
    }
  }

  public hide(): void {
    if (this.container) {
      this.container.style.display = "none";
    }
    if (this.hideToolbarTimer) {
      clearTimeout(this.hideToolbarTimer);
      this.hideToolbarTimer = null;
    }
    this.isVisible = false;
  }

  private formatRollingText(text: string, isCjk = true): string {
    if (!text) return "";
    const clean = text.trim();
    const maxLen = isCjk ? 42 : 80;
    if (clean.length <= maxLen) return clean;

    // Split into sentences / clauses by punctuation: 。！？!?\n
    const clauses = clean.split(/(?<=[。！？!?\n])/g).filter((s) => s.trim().length > 0);
    if (clauses.length > 1) {
      const last = clauses[clauses.length - 1].trim();
      const prev = clauses[clauses.length - 2].trim();
      if ((prev + last).length <= maxLen + 10) {
        return prev + last;
      }
      return last;
    }

    // Split by comma / semicolon
    const subClauses = clean.split(/(?<=[，,；;])/g).filter((s) => s.trim().length > 0);
    if (subClauses.length > 2) {
      const lastTwo = subClauses.slice(-2).join("").trim();
      if (lastTwo.length <= maxLen + 10) return lastTwo;
      return subClauses.slice(-1).join("").trim();
    }

    return clean.slice(-maxLen);
  }

  public updateSubtitle(deltaText?: string, deltaOrig?: string, fullTrans?: string, fullOrig?: string, isFinal?: boolean): void {
    if (!this.isVisible) this.show();

    if (fullTrans !== undefined && this.translationEl) {
      this.translationEl.textContent = this.formatRollingText(fullTrans, true) || (this.currentStatus === "connected" ? "……" : "");
    } else if (deltaText && this.translationEl) {
      const curr = (this.translationEl.textContent === "……" || this.translationEl.textContent === "等待音频输入…") ? "" : (this.translationEl.textContent || "");
      this.translationEl.textContent = this.formatRollingText(curr + deltaText, true);
    }

    if (this.showOriginal && this.originalEl) {
      if (fullOrig !== undefined) {
        this.originalEl.textContent = this.formatRollingText(fullOrig, false);
      } else if (deltaOrig) {
        const curr = this.originalEl.textContent || "";
        this.originalEl.textContent = this.formatRollingText(curr + deltaOrig, false);
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
        this.statusDot.style.background = "#10B981";
        this.statusDot.style.boxShadow = "0 0 8px #10B981";
      } else if (status === "connecting") {
        this.statusDot.style.background = "#F59E0B";
        this.statusDot.style.boxShadow = "0 0 8px #F59E0B";
      } else if (status === "error") {
        this.statusDot.style.background = "#EF4444";
        this.statusDot.style.boxShadow = "0 0 8px #EF4444";
      } else {
        this.statusDot.style.background = "#6B7280";
        this.statusDot.style.boxShadow = "none";
      }
    }

    if (this.statusText) {
      this.statusText.textContent = status === "connected" ? "同传中" : status === "connecting" ? "连接中" : "实时同传";
    }

    if (this.levelBar && level !== undefined) {
      this.levelBar.style.width = `${Math.min(100, Math.max(0, level))}%`;
    }
  }

  public destroy(): void {
    document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
    if (this.hideToolbarTimer) {
      clearTimeout(this.hideToolbarTimer);
      this.hideToolbarTimer = null;
    }
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

  private showToolbar(): void {
    if (this.hideToolbarTimer) {
      clearTimeout(this.hideToolbarTimer);
      this.hideToolbarTimer = null;
    }
    if (this.headerEl) {
      this.headerEl.style.opacity = "1";
      this.headerEl.style.maxHeight = "36px";
      this.headerEl.style.marginBottom = "6px";
      this.headerEl.style.pointerEvents = "auto";
    }
    if (this.container) {
      this.container.style.padding = "8px 18px 10px 18px";
    }
  }

  private hideToolbar(delayMs = 0): void {
    if (this.hideToolbarTimer) {
      clearTimeout(this.hideToolbarTimer);
      this.hideToolbarTimer = null;
    }
    if (delayMs > 0) {
      this.hideToolbarTimer = setTimeout(() => this.hideToolbar(0), delayMs);
      return;
    }
    if (this.isToolbarHovered || this.isDragging) return;
    if (this.headerEl) {
      this.headerEl.style.opacity = "0";
      this.headerEl.style.maxHeight = "0px";
      this.headerEl.style.marginBottom = "0px";
      this.headerEl.style.pointerEvents = "none";
    }
    if (this.container) {
      this.container.style.padding = "6px 16px 8px 16px";
    }
  }

  private createDom(): void {
    const container = document.createElement("div");
    container.id = "astra-live-subtitle-hud";
    container.style.cssText = `
      position: fixed;
      left: 50%;
      bottom: 50px;
      transform: translateX(-50%);
      width: min(780px, 90vw);
      min-width: 320px;
      max-width: 95vw;
      height: auto;
      min-height: auto;
      max-height: 80vh;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      padding: 6px 16px 8px 16px;
      border-radius: 14px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.12) inset;
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      transition: padding 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease, opacity 0.2s ease;
      user-select: none;
      overflow: hidden;
      cursor: grab;
    `;

    // Header toolbar (Hover-revealed)
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      max-height: 0px;
      margin-bottom: 0px;
      opacity: 0;
      pointer-events: none;
      overflow: hidden;
      user-select: none;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      gap: 6px;
      white-space: nowrap;
    `;

    // Left status info (Concise badge so it never squashes buttons)
    const leftInfo = document.createElement("div");
    leftInfo.style.cssText = "display: flex; align-items: center; gap: 5px; font-size: 11px; color: rgba(255,255,255,0.75); pointer-events: none; flex-shrink: 0;";

    const dot = document.createElement("span");
    dot.style.cssText = "width: 7px; height: 7px; border-radius: 50%; background: #F59E0B; transition: all 0.3s ease;";
    this.statusDot = dot;

    const statusText = document.createElement("span");
    statusText.textContent = "实时同传";
    this.statusText = statusText;

    const levelTrack = document.createElement("div");
    levelTrack.style.cssText = "width: 28px; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.2); overflow: hidden;";
    const levelBar = document.createElement("div");
    levelBar.style.cssText = "width: 0%; height: 100%; background: #10B981; transition: width 0.1s ease;";
    levelTrack.appendChild(levelBar);
    this.levelBar = levelBar;

    leftInfo.appendChild(dot);
    leftInfo.appendChild(statusText);
    leftInfo.appendChild(levelTrack);

    // Right action buttons (Auto flex-shrink protected)
    const rightActions = document.createElement("div");
    rightActions.style.cssText = "display: flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: auto;";

    const makeBtn = (label: string, title: string, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.title = title;
      btn.style.cssText = `
        background: rgba(255, 255, 255, 0.14);
        border: 1px solid rgba(255, 255, 255, 0.18);
        color: #FFFFFF;
        border-radius: 6px;
        padding: 2px 6px;
        font-size: 11px;
        cursor: pointer;
        outline: none;
        transition: all 0.15s ease;
        line-height: 1.35;
        white-space: nowrap;
      `;
      btn.onmouseenter = () => (btn.style.background = "rgba(255, 255, 255, 0.32)");
      btn.onmouseleave = () => (btn.style.background = "rgba(255, 255, 255, 0.14)");
      btn.onclick = (e) => {
        e.stopPropagation();
        onClick();
      };
      return btn;
    };

    // Width Presets: 标准 780px -> 宽屏 1060px -> 紧凑 540px -> 自适应
    const widthPresets = [780, 1060, 540, -1];
    let currentWidthIdx = 0;
    const cycleWidthBtn = makeBtn("↔ 宽", "切换宽度 (标准 780px / 宽屏 1060px / 紧凑 540px / 自适应)", () => {
      currentWidthIdx = (currentWidthIdx + 1) % widthPresets.length;
      const targetW = widthPresets[currentWidthIdx];
      if (targetW === -1) {
        this.customWidth = -1;
        this.container!.style.width = "fit-content";
        localStorage.removeItem(STORAGE_KEY_WIDTH);
      } else {
        this.customWidth = targetW;
        this.container!.style.width = `${targetW}px`;
        localStorage.setItem(STORAGE_KEY_WIDTH, String(targetW));
      }
    });

    // Opacity Presets: 80% -> 50% -> 20% -> 95% -> 0% (纯文字)
    const opacityPresets = [80, 50, 20, 95, 0];
    let currentOpacityIdx = 0;
    const cycleOpacityBtn = makeBtn("🌗 透", "切换背景透明度 (80% / 50% / 20% / 95% / 纯文字0%)", () => {
      currentOpacityIdx = (currentOpacityIdx + 1) % opacityPresets.length;
      this.bgOpacity = opacityPresets[currentOpacityIdx];
      this.updateStyles();
      localStorage.setItem(STORAGE_KEY_OPACITY, String(this.bgOpacity));
    });

    // Toggle original/bilingual
    const toggleOrigBtn = makeBtn(this.showOriginal ? "🌐 双语" : "🌐 单译", "切换双语/单语显示", () => {
      this.showOriginal = !this.showOriginal;
      toggleOrigBtn.textContent = this.showOriginal ? "🌐 双语" : "🌐 单译";
      if (this.originalEl) {
        this.originalEl.style.display = this.showOriginal ? "block" : "none";
      }
    });
    this.toggleOrigBtn = toggleOrigBtn;

    // Font size -
    const fontMinusBtn = makeBtn("A-", "减小字号", () => {
      this.fontSize = Math.max(14, this.fontSize - 2);
      this.updateStyles();
      localStorage.setItem(STORAGE_KEY_FONT_SIZE, String(this.fontSize));
    });

    // Font size +
    const fontPlusBtn = makeBtn("A+", "加大字号", () => {
      this.fontSize = Math.min(42, this.fontSize + 2);
      this.updateStyles();
      localStorage.setItem(STORAGE_KEY_FONT_SIZE, String(this.fontSize));
    });

    // Export SRT
    const exportBtn = makeBtn("📥 SRT", "导出 SRT 字幕文件", () => {
      this.exportSrt();
    });

    // Close button
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

    // Subtitle content body (Movie-grade clean typography)
    const originalEl = document.createElement("div");
    originalEl.id = "astra-hud-original";
    originalEl.style.cssText = `
      color: rgba(255, 255, 255, 0.75);
      margin-bottom: 3px;
      line-height: 1.35;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95), 0 0 2px rgba(0, 0, 0, 1);
      word-break: break-word;
      transition: font-size 0.15s ease;
      text-align: center;
      display: ${this.showOriginal ? "block" : "none"};
    `;
    this.originalEl = originalEl;

    const translationEl = document.createElement("div");
    translationEl.id = "astra-hud-translation";
    translationEl.style.cssText = `
      color: #FFFFFF;
      font-weight: 600;
      line-height: 1.42;
      text-shadow: 0 2px 4px rgba(0, 0, 0, 0.95), 0 0 2px rgba(0, 0, 0, 1), 0 0 8px rgba(0, 0, 0, 0.6);
      word-break: break-word;
      transition: font-size 0.15s ease;
      text-align: center;
    `;
    translationEl.textContent = "等待音频输入…";
    this.translationEl = translationEl;

    // Hover listeners to reveal toolbar
    container.addEventListener("mouseenter", () => {
      this.isToolbarHovered = true;
      this.showToolbar();
    });
    container.addEventListener("mousemove", () => {
      this.showToolbar();
      if (this.hideToolbarTimer) clearTimeout(this.hideToolbarTimer);
      this.hideToolbarTimer = setTimeout(() => {
        if (!this.isDragging) {
          this.hideToolbar(0);
        }
      }, 2500);
    });
    container.addEventListener("mouseleave", () => {
      this.isToolbarHovered = false;
      this.hideToolbar(250);
    });

    container.appendChild(header);
    container.appendChild(originalEl);
    container.appendChild(translationEl);

    // Setup dragging anywhere on container
    this.setupDragging(container);

    document.body.appendChild(container);
    this.container = container;
  }

  private setupDragging(target: HTMLElement): void {
    target.addEventListener("mousedown", (e) => {
      if (e.target instanceof HTMLButtonElement) return;
      this.isDragging = true;
      this.showToolbar();
      const rect = target.getBoundingClientRect();
      this.dragStartX = e.clientX - rect.left;
      this.dragStartY = e.clientY - rect.top;
      target.style.cursor = "grabbing";
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
        if (this.container) this.container.style.cursor = "grab";
        if (this.posX >= 0 && this.posY >= 0) {
          try {
            localStorage.setItem(STORAGE_KEY_POS_X, String(this.posX));
            localStorage.setItem(STORAGE_KEY_POS_Y, String(this.posY));
          } catch {}
        }
        if (!this.isToolbarHovered) {
          this.hideToolbar(1200);
        }
      }
    });
  }

  private restorePositionAndSize(): void {
    if (!this.container) return;

    if (this.customWidth > 0) {
      this.container.style.width = `${this.customWidth}px`;
    } else {
      this.container.style.width = "min(780px, 90vw)";
    }
    // Always keep height automatic
    this.container.style.height = "auto";

    if (this.posX >= 0 && this.posY >= 0) {
      const maxL = window.innerWidth - (this.container.offsetWidth || 400) - 10;
      const maxT = window.innerHeight - (this.container.offsetHeight || 80) - 10;
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
    this.container.style.bottom = "50px";
    this.container.style.top = "auto";
    this.container.style.transform = "translateX(-50%)";
  }

  private updateStyles(): void {
    if (!this.container) return;
    const bgAlpha = (this.bgOpacity / 100).toFixed(2);
    if (this.bgOpacity === 0) {
      this.container.style.backgroundColor = "transparent";
      this.container.style.boxShadow = "none";
      this.container.style.backdropFilter = "none";
      this.container.style.setProperty("-webkit-backdrop-filter", "none");
    } else {
      this.container.style.backgroundColor = `rgba(15, 15, 20, ${bgAlpha})`;
      this.container.style.boxShadow = "0 8px 28px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.12) inset";
      this.container.style.backdropFilter = "blur(24px) saturate(180%)";
      this.container.style.setProperty("-webkit-backdrop-filter", "blur(24px) saturate(180%)");
    }

    if (this.toggleOrigBtn) {
      this.toggleOrigBtn.textContent = this.showOriginal ? "🌐 双语" : "🌐 单译";
    }

    if (this.originalEl) {
      this.originalEl.style.fontSize = `${Math.round(this.fontSize * 0.72)}px`;
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
