// ============================================================
// Astra Translate – Floating Ball (Content Script)
// ============================================================

import { t, type UiLanguage } from "../shared/i18n";
import { injectThemeVars } from "./selectionBubble";

const BALL_PREFIX = "ast-ball";
const STORAGE_POS_KEY = "ast_ball_pos";

let ball: HTMLElement | null = null;
let settingsPanel: HTMLElement | null = null;
let cachedLang: UiLanguage = "zh-CN";
let currentOpacity = 0.8;
let currentSize = 48;
let isEnabled = true;
let hasInitialized = false;
let onTranslatePage: (() => void) | null = null;

// Drag state
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let ballStartX = 0;
let ballStartY = 0;
let hasMoved = false;

/** Initialize the floating ball. */
export function initFloatingBall(opts: {
  enabled: boolean;
  opacity: number;
  size?: number;
  lang?: UiLanguage;
  onTranslatePage?: () => void;
}): void {
  cachedLang = opts.lang || "zh-CN";
  currentOpacity = opts.opacity;
  currentSize = opts.size || 48;
  isEnabled = opts.enabled;
  onTranslatePage = opts.onTranslatePage || null;
  hasInitialized = true;

  if (isEnabled) {
    show();
  }
}

/** Recreate injected floating-ball UI if the page removed it during navigation. */
export function ensureFloatingBallMounted(): void {
  if (!hasInitialized) return;
  if (!isEnabled) return;
  if (!ball || !ball.isConnected || ball.ownerDocument !== document) {
    ball = null;
    closeSettingsPanel();
    show();
  }
}

/** Update floating ball settings. */
export function updateFloatingBall(opts: {
  enabled?: boolean;
  opacity?: number;
  size?: number;
  lang?: UiLanguage;
}): void {
  hasInitialized = true;
  if (opts.lang !== undefined) cachedLang = opts.lang;
  if (opts.opacity !== undefined) currentOpacity = opts.opacity;
  if (opts.size !== undefined) currentSize = opts.size;

  if (opts.enabled !== undefined) {
    isEnabled = opts.enabled;
    if (isEnabled && !ball) {
      show();
    } else if (!isEnabled && ball) {
      hide();
    }
  }

  if (ball) {
    applyBallStyles(ball);
  }
}

function applyBallStyles(el: HTMLElement): void {
  el.style.opacity = String(currentOpacity);
  el.style.width = currentSize + "px";
  el.style.height = currentSize + "px";
  const iconSize = Math.round(currentSize * 0.58);
  const icon = el.querySelector(`.${BALL_PREFIX}-icon`) as HTMLElement | null;
  if (icon) {
    icon.style.width = iconSize + "px";
    icon.style.height = iconSize + "px";
  }
}

function show(): void {
  if (ball && (!ball.isConnected || ball.ownerDocument !== document)) {
    ball = null;
  }
  if (ball) return;
  injectThemeVars();
  createBall();
}

function hide(): void {
  closeSettingsPanel();
  ball?.remove();
  ball = null;
}

function createBall(): void {
  const el = document.createElement("div");
  el.className = `${BALL_PREFIX}-container`;

  // Restore saved position
  const savedPos = loadPosition();
  if (savedPos) {
    el.style.left = savedPos.x + "px";
    el.style.top = savedPos.y + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
  }

  const iconSize = Math.round(currentSize * 0.58);

  el.innerHTML = `
    <img src="${chrome.runtime.getURL("icons/icon48.png")}" class="${BALL_PREFIX}-icon"
         style="width:${iconSize}px;height:${iconSize}px;" />
    <div class="${BALL_PREFIX}-pulse"></div>
  `;

  applyBallStyles(el);

  // Left-click → translate page
  el.addEventListener("click", (e) => {
    if (isDragging || hasMoved) return;
    e.preventDefault();
    e.stopPropagation();
    triggerPageTranslation();
  });

  // Right-click → settings panel
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleSettingsPanel();
  });

  // Drag
  el.addEventListener("mousedown", onDragStart);

  document.body.appendChild(el);
  ball = el;
}

function onDragStart(e: MouseEvent): void {
  if (e.button !== 0) return;
  isDragging = false;
  hasMoved = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;

  const rect = ball!.getBoundingClientRect();
  ballStartX = rect.left;
  ballStartY = rect.top;

  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup", onDragEnd);
  e.preventDefault();
}

function onDragMove(e: MouseEvent): void {
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;

  if (!isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
    isDragging = true;
    hasMoved = true;
    ball!.style.transition = "none";
  }

  if (!isDragging) return;

  let nx = ballStartX + dx;
  let ny = ballStartY + dy;

  nx = Math.max(0, Math.min(nx, window.innerWidth - currentSize - 4));
  ny = Math.max(0, Math.min(ny, window.innerHeight - currentSize - 4));

  ball!.style.left = nx + "px";
  ball!.style.top = ny + "px";
  ball!.style.right = "auto";
  ball!.style.bottom = "auto";
}

function onDragEnd(): void {
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup", onDragEnd);

  if (isDragging && ball) {
    const rect = ball.getBoundingClientRect();
    savePosition(rect.left, rect.top);
    ball.style.transition = "";
  }

  setTimeout(() => {
    isDragging = false;
    hasMoved = false;
  }, 50);
}

function savePosition(x: number, y: number): void {
  try {
    localStorage.setItem(STORAGE_POS_KEY, JSON.stringify({ x, y }));
  } catch {
    // ignore
  }
}

function loadPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_POS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return null;
}

function triggerPageTranslation(): void {
  if (onTranslatePage) {
    onTranslatePage();
  }
}

function toggleSettingsPanel(): void {
  if (settingsPanel) {
    closeSettingsPanel();
  } else {
    openSettingsPanel();
  }
}

function openSettingsPanel(): void {
  if (settingsPanel || !ball) return;

  const panel = document.createElement("div");
  panel.className = `${BALL_PREFIX}-settings`;

  const rect = ball.getBoundingClientRect();
  let px = rect.left - 220 - 10;
  let py = rect.top;

  if (px < 8) px = rect.right + 10;
  if (py + 220 > window.innerHeight) py = window.innerHeight - 230;
  if (py < 8) py = 8;

  panel.style.left = px + "px";
  panel.style.top = py + "px";

  const opacityPercent = Math.round(currentOpacity * 100);

  panel.innerHTML = `
    <div class="${BALL_PREFIX}-settings-header">
      <span class="${BALL_PREFIX}-settings-title">${t(cachedLang, "ball.settings")}</span>
      <button class="${BALL_PREFIX}-settings-close" title="${t(cachedLang, "bubble.close")}">×</button>
    </div>
    <div class="${BALL_PREFIX}-settings-body">
      <div class="${BALL_PREFIX}-settings-row">
        <label class="${BALL_PREFIX}-settings-label">${t(cachedLang, "ball.size")}</label>
        <div class="${BALL_PREFIX}-slider-group">
          <input type="range" class="${BALL_PREFIX}-slider ${BALL_PREFIX}-size-slider" min="32" max="80" value="${currentSize}" />
          <span class="${BALL_PREFIX}-slider-value">${currentSize}px</span>
        </div>
      </div>
      <div class="${BALL_PREFIX}-settings-row">
        <label class="${BALL_PREFIX}-settings-label">${t(cachedLang, "ball.opacity")}</label>
        <div class="${BALL_PREFIX}-slider-group">
          <input type="range" class="${BALL_PREFIX}-slider ${BALL_PREFIX}-opacity-slider" min="10" max="100" value="${opacityPercent}" />
          <span class="${BALL_PREFIX}-slider-value">${opacityPercent}%</span>
        </div>
      </div>
      <button class="${BALL_PREFIX}-settings-translate">${t(cachedLang, "ball.translatePage")}</button>
      <button class="${BALL_PREFIX}-settings-hide">${t(cachedLang, "ball.close")}</button>
    </div>
  `;

  // Close button
  const closeBtn = panel.querySelector(`.${BALL_PREFIX}-settings-close`);
  closeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSettingsPanel();
  });

  // Size slider
  const sizeSlider = panel.querySelector(`.${BALL_PREFIX}-size-slider`) as HTMLInputElement;
  const sizeValue = sizeSlider?.parentElement?.querySelector(`.${BALL_PREFIX}-slider-value`);
  sizeSlider?.addEventListener("input", () => {
    const val = parseInt(sizeSlider.value);
    currentSize = val;
    if (ball) applyBallStyles(ball);
    if (sizeValue) sizeValue.textContent = val + "px";

    chrome.runtime.sendMessage({
      type: "SAVE_FLOATING_BALL_SIZE",
      payload: { size: currentSize },
    }).catch(() => {});
  });

  // Opacity slider
  const opacitySlider = panel.querySelector(`.${BALL_PREFIX}-opacity-slider`) as HTMLInputElement;
  const opacityValue = opacitySlider?.parentElement?.querySelector(`.${BALL_PREFIX}-slider-value`);
  opacitySlider?.addEventListener("input", () => {
    const val = parseInt(opacitySlider.value);
    currentOpacity = val / 100;
    if (ball) ball.style.opacity = String(currentOpacity);
    if (opacityValue) opacityValue.textContent = val + "%";

    chrome.runtime.sendMessage({
      type: "SAVE_FLOATING_BALL_OPACITY",
      payload: { opacity: currentOpacity },
    }).catch(() => {});
  });

  // Translate button
  const translateBtn = panel.querySelector(`.${BALL_PREFIX}-settings-translate`);
  translateBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSettingsPanel();
    triggerPageTranslation();
  });

  // Hide button
  const hideBtn = panel.querySelector(`.${BALL_PREFIX}-settings-hide`);
  hideBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSettingsPanel();
    hide();
    isEnabled = false;
    chrome.runtime.sendMessage({
      type: "SAVE_FLOATING_BALL_ENABLED",
      payload: { enabled: false },
    }).catch(() => {});
  });

  document.body.appendChild(panel);
  settingsPanel = panel;

  setTimeout(() => {
    document.addEventListener("mousedown", onOutsideClick);
  }, 50);
}

function closeSettingsPanel(): void {
  if (!settingsPanel) return;
  document.removeEventListener("mousedown", onOutsideClick);
  settingsPanel.remove();
  settingsPanel = null;
}

function onOutsideClick(e: MouseEvent): void {
  if (!settingsPanel) return;
  if (settingsPanel.contains(e.target as Node)) return;
  if (ball?.contains(e.target as Node)) return;
  closeSettingsPanel();
}
