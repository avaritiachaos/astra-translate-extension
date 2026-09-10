import type {
  MangaJob,
  Rect,
  PositionedRegion,
} from "../../shared/manga/types";
import { imagePlacement } from "../../shared/manga/imageGeometry";
import { followMangaFullscreen } from "./mangaFullscreen";
import {
  mangaImageSize,
  visibleMangaImageRect,
  intersectRects,
  type MangaImage,
} from "./mangaImage";
import {
  layoutMangaText,
  comparisonCardRect,
  markerRect,
  type MangaMarkerReason,
} from "../../shared/manga/textLayout";
import { isolateMangaControls, MANGA_CARD_OPEN_EVENT } from "./mangaControls";
import {
  translationPresentation,
  type MangaTranslationResult,
} from "../../shared/manga/translationPresentation";
import { t, type UiLanguage } from "../../shared/i18n";
export function imageBox(image: MangaImage) {
  const rect = image.getBoundingClientRect(),
    style = getComputedStyle(image);
  for (let el: Element | null = image; el; el = el.parentElement) {
    const transform = getComputedStyle(el).transform;
    if (transform !== "none") {
      const matrix = new DOMMatrix(transform);
      if (
        !matrix.is2D ||
        Math.abs(matrix.b) > 0.001 ||
        Math.abs(matrix.c) > 0.001 ||
        matrix.a <= 0 ||
        matrix.d <= 0
      )
        throw new Error("MANGA_LAYOUT_UNSUPPORTED");
    }
  }
  const number = (value: string) => parseFloat(value) || 0;
  const sx = rect.width / Math.max(1, image.offsetWidth),
    sy = rect.height / Math.max(1, image.offsetHeight);
  const content = {
    x:
      rect.left +
      (number(style.borderLeftWidth) + number(style.paddingLeft)) * sx,
    y:
      rect.top + (number(style.borderTopWidth) + number(style.paddingTop)) * sy,
    width: Math.max(
      1,
      (image.clientWidth -
        number(style.paddingLeft) -
        number(style.paddingRight)) *
        sx,
    ),
    height: Math.max(
      1,
      (image.clientHeight -
        number(style.paddingTop) -
        number(style.paddingBottom)) *
        sy,
    ),
  };
  const size = mangaImageSize(image);
  return {
    content,
    drawn: imagePlacement(
      size.width,
      size.height,
      content,
      style.objectFit,
      style.objectPosition,
    ),
  };
}
const css = `
:host{all:initial;position:fixed;inset:0;margin:0;border:0;padding:0;width:100%;height:100%;max-width:none;max-height:none;background:transparent;overflow:visible;z-index:2147483600;pointer-events:none;font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#24242a}
*{box-sizing:border-box}button{font:inherit;cursor:pointer;border:0}button:focus-visible{outline:3px solid #7771f5;outline-offset:2px}[hidden]{display:none!important}
.status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.frame{position:absolute;overflow:hidden;pointer-events:none}
.region{position:absolute;display:flex;align-items:center;justify-content:center;padding:4px;margin:0;border-radius:5px;pointer-events:auto;overflow:hidden;background:#fff;color:#24242a;text-align:center;box-shadow:none;white-space:normal;line-height:1.35}
.region.uncertain:not(.marker){box-shadow:inset 0 0 0 1px #b1833855}.region.uncertain:not(.marker)::after{content:"?";position:absolute;top:1px;right:2px;color:#95681d;font-size:10px;line-height:1}
.region:hover{outline:1px dashed #7771f580;outline-offset:1px}.region .text{display:block;max-width:100%;max-height:100%;overflow:hidden;overflow-wrap:anywhere;word-break:normal}
.region.vertical .text{writing-mode:vertical-rl;text-orientation:mixed;line-height:1.3;letter-spacing:0;height:100%;width:auto}
.region:not(.vertical) .text{width:100%;height:auto}
.region.marker{padding:7px;border-radius:50%;color:#fff;background:transparent!important;border:0;font-size:12px;font-weight:600;line-height:1;opacity:1;overflow:visible;touch-action:none}.region.marker .text{width:26px!important;height:26px!important;flex:none;max-width:100%;max-height:100%;display:grid;place-items:center;border-radius:50%;background:#655ce6;color:white;border:1px solid #ffffffd9;box-shadow:0 1px 5px #0003;line-height:1.4}.region.marker:hover{outline:none;background:#8070f326!important}.region.marker:hover .text,.region.marker[aria-expanded=true] .text{background:#5147d3}.region.marker.uncertain .text{background:#a36f28}.region.marker.untranslated .text{background:#f5f3f8;color:#736779;border:1px dashed #95899d}
.compare{position:absolute;pointer-events:auto;width:400px;max-width:calc(100vw - 24px);max-height:calc(100vh - 32px);overflow:auto;background:#fff;border:1px solid #e8e6f3;border-radius:16px;box-shadow:0 12px 45px #17132930;padding:16px;color:#24242a;font-size:16px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
.compare header{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;color:#85808f;margin-bottom:8px}.compare header button{background:#f1f0f7;color:#645b7a;border-radius:50%;width:26px;height:26px;line-height:1;font-size:18px}.card-reason{font-size:12px;line-height:1.5;color:#746989;background:#f6f3ff;border-radius:8px;padding:8px 10px;margin:0 0 10px}.card-reason[data-state=uncertain]{color:#825915;background:#fff6e5}.card-reason[data-state=untranslated]{color:#706477;background:#f0edf3}.preview-hint{font-size:11px;line-height:1.4;color:#90889a;margin-top:10px}.translation{margin:0 0 14px;font-size:18px}.source-label{font-size:11px;color:#8c8696;border-top:1px solid #eeedf5;padding-top:10px}.source{margin-top:4px;color:#75717e;font-size:14px}
.frame.fallback{left:auto!important;top:20px!important;right:16px;width:320px!important;height:auto!important;max-height:65vh;overflow:auto;padding:8px;pointer-events:auto;background:#f7f7fb;border:1px solid #eeedf5;border-radius:14px}.fallback .region{position:relative;left:auto!important;top:auto!important;width:100%!important;height:auto!important;min-height:40px;display:block;margin:4px 0;padding:10px;text-align:left;font-size:14px!important;line-height:1.5;opacity:1}.fallback .region .text{writing-mode:horizontal-tb;height:auto;max-height:none}
`;
export interface MangaViewState {
  status: string;
  phase: "working" | "ready" | "error";
  needsSetup: boolean;
  errorCode?: string;
  markers: number;
  translations: MangaTranslationResult[];
  translationsRevision: number;
}
interface RegionNode {
  node: HTMLButtonElement;
  text: HTMLSpanElement;
  region: PositionedRegion;
  index: number;
  layoutKey?: string;
  marker?: boolean;
  markerReason?: MangaMarkerReason;
}
export class MangaOverlay {
  private host = document.createElement("div");
  private root = this.host.attachShadow({ mode: "open" });
  private frame = document.createElement("div");
  private status = document.createElement("span");
  private card = document.createElement("section");
  private cardTranslation = document.createElement("div");
  private cardReason = document.createElement("div");
  private cardHint = document.createElement("div");
  private cardSource = document.createElement("div");
  private nodes: RegionNode[] = [];
  private job?: MangaJob;
  private crop?: Rect;
  private revision = -1;
  private original = false;
  private selected?: RegionNode;
  private pinned = false;
  private previewTimer?: ReturnType<typeof setTimeout>;
  private dismissTimer?: ReturnType<typeof setTimeout>;
  private suppressed = false;
  private disposed = false;
  private stopFollowing: () => void;
  private stopControls: () => void;
  private measuring = document.createElement("canvas").getContext("2d")!;
  private dockMove = () => this.closeCard();
  private otherCard = (event: Event) => {
    if ((event as CustomEvent).detail !== this.host) this.closeCard();
  };
  private outside = (event: Event) => {
    if (!event.composedPath().includes(this.host)) this.closeCard();
  };
  readonly state: MangaViewState = {
    status: "",
    phase: "working",
    needsSetup: false,
    markers: 0,
    translations: [],
    translationsRevision: 0,
  };
  constructor(
    private image: MangaImage,
    private lang: UiLanguage,
    private changed: () => void = () => {},
  ) {
    this.host.className = "ast-manga-root";
    this.host.dataset.astraManga = "true";
    const style = document.createElement("style");
    style.textContent = css;
    this.frame.className = "frame";
    this.status.className = "status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.card.className = "compare";
    this.card.hidden = true;
    this.card.setAttribute("role", "dialog");
    this.card.setAttribute("aria-label", t(lang, "manga.compare"));
    const header = document.createElement("header"),
      label = document.createElement("span"),
      close = document.createElement("button");
    label.textContent = t(lang, "manga.compare");
    close.textContent = "×";
    close.setAttribute("aria-label", t(lang, "bubble.close"));
    close.onclick = () => this.closeCard();
    header.append(label, close);
    const sourceLabel = document.createElement("div");
    sourceLabel.className = "source-label";
    sourceLabel.textContent = t(lang, "manga.sourceLabel");
    this.cardTranslation.className = "translation";
    this.cardSource.className = "source";
    this.cardReason.className = "card-reason";
    this.cardHint.className = "preview-hint";
    this.card.append(
      header,
      this.cardReason,
      this.cardTranslation,
      sourceLabel,
      this.cardSource,
      this.cardHint,
    );
    this.card.addEventListener("pointerenter", () =>
      clearTimeout(this.dismissTimer),
    );
    this.card.addEventListener("pointerleave", () => this.dismissPreview());
    this.root.append(style, this.status, this.frame, this.card);
    this.host.setAttribute("popover", "manual");
    this.stopFollowing = followMangaFullscreen(this.host, () => this.layout());
    this.stopControls = isolateMangaControls(this.host, this.root, () => {
      if (!this.selected && this.previewTimer === undefined) return false;
      this.closeCard();
      return true;
    });
    window.addEventListener("pointerdown", this.outside, true);
    document.addEventListener("astra-manga-dock-move", this.dockMove);
    document.addEventListener(MANGA_CARD_OPEN_EVENT, this.otherCard);
    this.message(t(lang, "manga.loading"));
    this.layout();
  }
  message(value: string) {
    this.state.status = value;
    this.status.textContent = value;
    this.changed();
  }
  error(value: string, code?: string) {
    this.state.phase = "error";
    this.state.errorCode = code;
    this.message(value);
  }
  configurationError(value: string) {
    this.state.needsSetup = true;
    this.error(value);
  }
  setCrop(crop?: Rect) {
    this.crop = crop;
  }
  hide(hidden: boolean) {
    this.suppressed = hidden;
    if (hidden) {
      this.cancelPreviewTimer();
      if (!this.pinned) this.closeCard();
    }
    this.host.style.visibility = hidden ? "hidden" : "visible";
  }
  setOriginal(original: boolean) {
    this.original = original;
    this.frame.style.visibility = original ? "hidden" : "";
    if (original) this.closeCard();
  }
  update(job: MangaJob) {
    this.state.errorCode = job.errorCode;
    this.job = job;
    this.state.phase =
      job.phase === "ready"
        ? "ready"
        : ["failed", "cancelled", "interrupted"].includes(job.phase)
          ? "error"
          : "working";
    this.state.needsSetup = job.errorCode === "MODEL_NOT_FOUND";
    const phaseKey = "manga." + job.phase;
    const progress = job.total ? ` ${job.completed}/${job.total}` : "";
    this.message(
      job.error ||
        (job.phase === "ready" && !job.regions.length
          ? t(this.lang, "manga.noText")
          : t(this.lang, phaseKey) + progress) +
          (this.crop ? " · " + t(this.lang, "manga.visiblePart") : ""),
    );
    if (job.revision !== this.revision) {
      this.revision = job.revision;
      this.closeCard();
      this.frame.replaceChildren();
      this.nodes = job.regions.map((region, index) => {
        const node = document.createElement("button"),
          text = document.createElement("span");
        node.type = "button";
        node.className = "region";
        text.className = "text";
        node.append(text);
        node.title = t(this.lang, "manga.openTranslation");
        node.setAttribute(
          "aria-label",
          t(this.lang, "manga.regionLabel", { number: index + 1 }),
        );
        node.setAttribute("aria-expanded", "false");
        const item: RegionNode = { node, text, region, index };
        node.setAttribute("aria-haspopup", "dialog");
        node.onclick = () =>
          this.selected === item && this.pinned
            ? this.closeCard()
            : this.openCard(item, true);
        node.addEventListener("pointerenter", (event) => {
          if (event.pointerType !== "touch") this.preview(item);
        });
        node.addEventListener("pointerleave", () => {
          this.cancelPreviewTimer();
          if (this.selected === item) this.dismissPreview();
        });
        node.addEventListener("focus", () => this.preview(item));
        node.addEventListener("blur", () => this.dismissPreview());
        this.frame.append(node);
        return item;
      });
    }
    this.layout();
    this.publishTranslations();
    this.changed();
  }
  private cancelPreviewTimer() {
    clearTimeout(this.previewTimer);
    this.previewTimer = undefined;
  }
  private closeCard() {
    this.cancelPreviewTimer();
    clearTimeout(this.dismissTimer);
    this.previewTimer = undefined;
    this.dismissTimer = undefined;
    this.selected?.node.setAttribute("aria-expanded", "false");
    this.selected = undefined;
    this.pinned = false;
    this.card.hidden = true;
  }
  private preview(item: RegionNode) {
    if (
      !item.marker ||
      this.pinned ||
      this.original ||
      this.suppressed ||
      this.disposed
    )
      return;
    this.cancelPreviewTimer();
    clearTimeout(this.dismissTimer);
    this.previewTimer = setTimeout(() => {
      this.previewTimer = undefined;
      if (
        item.node.isConnected &&
        !this.original &&
        !this.suppressed &&
        !this.disposed &&
        !this.pinned
      )
        this.openCard(item, false);
    }, 160);
  }
  private dismissPreview() {
    this.cancelPreviewTimer();
    clearTimeout(this.dismissTimer);
    if (!this.selected || this.pinned) return;
    this.dismissTimer = setTimeout(() => {
      this.dismissTimer = undefined;
      if (!this.pinned) this.closeCard();
    }, 200);
  }
  private openCard(item: RegionNode, pinned: boolean) {
    if (this.original || this.suppressed || this.disposed) return;
    this.closeCard();
    this.selected = item;
    this.pinned = pinned;
    item.node.setAttribute("aria-expanded", "true");
    const presentation = translationPresentation(
      item.region,
      item.markerReason,
      this.lang,
    );
    this.cardTranslation.textContent =
      item.region.translatedText.trim() ||
      t(this.lang, "manga.noReliableTranslation");
    this.cardSource.textContent =
      item.region.sourceText || t(this.lang, "manga.noSourceText");
    this.cardReason.textContent = presentation.description;
    this.cardReason.dataset.state = presentation.state;
    this.cardReason.hidden = !presentation.description;
    this.cardHint.textContent = t(this.lang, "manga.previewHint");
    this.cardHint.hidden = pinned;
    this.card.hidden = false;
    this.host.hidePopover?.();
    this.host.showPopover?.();
    document.dispatchEvent(
      new CustomEvent(MANGA_CARD_OPEN_EVENT, { detail: this.host }),
    );
    this.layoutCard();
  }
  private describeRegion(item: RegionNode) {
    const presentation = translationPresentation(
      item.region,
      item.markerReason,
      this.lang,
    );
    const label = t(this.lang, "manga.regionStatus", {
      number: item.index + 1,
      state: presentation.label,
    });
    item.node.setAttribute(
      "aria-label",
      label + (item.marker ? ". " + t(this.lang, "manga.markerOpenHint") : ""),
    );
    item.node.title = [
      label,
      presentation.description,
      item.region.translatedText.trim().slice(0, 180),
    ]
      .filter(Boolean)
      .join("\n");
    item.node.dataset.translationState = presentation.state;
    item.node.dataset.markerReason = item.markerReason ?? "";
    item.node.classList.toggle("uncertain", presentation.state === "uncertain");
    item.node.classList.toggle(
      "untranslated",
      presentation.state === "untranslated",
    );
    if (item.marker && presentation.state === "untranslated")
      item.text.textContent = "?";
    if (this.selected === item) {
      this.cardReason.textContent = presentation.description;
      this.cardReason.dataset.state = presentation.state;
      this.cardReason.hidden = !presentation.description;
    }
  }
  private publishTranslations() {
    const translations = this.nodes.map(
      ({ region, index, marker, markerReason }) => ({
        id: region.id,
        number: index + 1,
        sourceText: region.sourceText,
        translatedText: region.translatedText,
        uncertain: region.uncertain,
        folded: Boolean(marker),
        markerReason,
      }),
    );
    const previous = this.state.translations;
    if (
      previous.length === translations.length &&
      translations.every((item, index) => {
        const old = previous[index];
        return (
          old.id === item.id &&
          old.sourceText === item.sourceText &&
          old.translatedText === item.translatedText &&
          old.uncertain === item.uncertain &&
          old.folded === item.folded &&
          old.markerReason === item.markerReason
        );
      })
    )
      return;
    this.state.translations = translations;
    this.state.translationsRevision++;
    this.changed();
  }
  private layoutCard() {
    if (!this.selected) return;
    const viewport = { x: 0, y: 0, width: innerWidth, height: innerHeight };
    // Re-measure at the final width without the previous card's height cap.
    // Otherwise opening a short card first can leave later text unnecessarily scrollable.
    Object.assign(this.card.style, {
      width: Math.min(400, innerWidth - 24) + "px",
      height: "auto",
      minHeight: "0",
      maxHeight: "none",
    });
    const natural = Math.max(200, this.card.scrollHeight + 2);
    const height = Math.min(
      natural,
      Math.max(0, innerHeight - 24),
      Math.max(320, innerHeight * 0.75),
    );
    const reader = document
      .querySelector(".ast-manga-reader")
      ?.getBoundingClientRect();
    const box = comparisonCardRect(
      this.selected.node.getBoundingClientRect(),
      viewport,
      height,
      reader,
    );
    Object.assign(this.card.style, {
      left: box.x + "px",
      top: box.y + "px",
      width: box.width + "px",
      minHeight: Math.min(200, box.height) + "px",
      maxHeight: box.height + "px",
    });
  }
  layout() {
    if (!this.image.isConnected) {
      this.dispose();
      return;
    }
    try {
      const { content, drawn } = imageBox(this.image),
        visible = visibleMangaImageRect(this.image);
      const frameBox = visible && intersectRects(content, visible);
      this.host.style.display = frameBox ? "block" : "none";
      if (!frameBox) {
        this.closeCard();
        return;
      }
      this.frame.classList.remove("fallback");
      Object.assign(this.frame.style, {
        left: frameBox.x + "px",
        top: frameBox.y + "px",
        width: frameBox.width + "px",
        height: frameBox.height + "px",
      });
      if (!this.job?.width || !this.job.height) return;
      const job = this.job,
        size = mangaImageSize(this.image);
      const crop = this.crop ?? {
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
      };
      const map = (rect: Rect): Rect => ({
        x:
          drawn.x -
          frameBox.x +
          ((crop.x + (rect.x / job.width) * crop.width) / size.width) *
            drawn.width,
        y:
          drawn.y -
          frameBox.y +
          ((crop.y + (rect.y / job.height) * crop.height) / size.height) *
            drawn.height,
        width:
          (((rect.width / job.width) * crop.width) / size.width) * drawn.width,
        height:
          (((rect.height / job.height) * crop.height) / size.height) *
          drawn.height,
      });
      const page = {
        x: 0,
        y: 0,
        width: frameBox.width,
        height: frameBox.height,
      };
      const textRects = this.nodes.map((item) => map(item.region.rect));
      const occupied: Rect[] = [];
      let markers = 0;
      for (const item of this.nodes) {
        const { node, text, region, index } = item;
        const layoutKey = JSON.stringify([
          map(region.rect),
          region.bubble && map(region.bubble),
          page,
        ]);
        if (item.layoutKey === layoutKey) {
          if (item.marker) {
            markers++;
            occupied.push({
              x: parseFloat(node.style.left),
              y: parseFloat(node.style.top),
              width: parseFloat(node.style.width),
              height: parseFloat(node.style.height),
            });
          }
          continue;
        }
        const layout = layoutMangaText(
          {
            text: region.translatedText,
            rect: map(region.rect),
            bubble: region.bubble ? map(region.bubble) : undefined,
            page,
            flat: region.background?.flat === true,
            vertical: region.writingDirection === "vertical",
            unsafe: region.kind === "sfx",
            unsafeReason: "sfx",
          },
          (value, font) => {
            this.measuring.font = `${font}px "Segoe UI","Microsoft YaHei",sans-serif`;
            return this.measuring.measureText(value).width;
          },
        );
        let marker = layout.mode === "marker";
        let markerReason = layout.markerReason;
        node.classList.toggle(
          "vertical",
          !marker && layout.writingMode === "vertical-rl",
        );
        node.classList.toggle("uncertain", region.uncertain);
        node.classList.toggle("marker", marker);
        const apply = (rect: Rect) =>
          Object.assign(node.style, {
            left: rect.x + "px",
            top: rect.y + "px",
            width: rect.width + "px",
            height: rect.height + "px",
          });
        let bounds = marker
          ? markerRect(map(region.rect), page, textRects, occupied)
          : layout.rect;
        apply(bounds);
        node.style.fontSize = layout.fontSize + "px";
        node.style.backgroundColor = marker
          ? ""
          : region.background?.flat
            ? region.background.color
            : "#fff";
        text.textContent = marker ? String(index + 1) : layout.text;
        if (!marker) {
          // Browser shaping and line-breaking are authoritative. An estimate
          // must never be allowed to produce visible overflow or tiny text.
          for (let font = layout.fontSize; font >= 12; font--) {
            node.style.fontSize = font + "px";
            if (
              text.scrollWidth <= text.clientWidth + 1 &&
              text.scrollHeight <= text.clientHeight + 1
            )
              break;
            if (font === 12) {
              marker = true;
              markerReason = "space";
            }
          }
          if (marker) {
            node.classList.add("marker");
            node.classList.remove("vertical");
            node.style.backgroundColor = "";
            node.style.fontSize = "12px";
            text.textContent = String(index + 1);
            bounds = markerRect(map(region.rect), page, textRects, occupied);
            apply(bounds);
          }
        }
        item.layoutKey = layoutKey;
        item.marker = marker;
        item.markerReason = marker ? markerReason : undefined;
        this.describeRegion(item);
        if (marker) {
          markers++;
          occupied.push(bounds);
        }
      }
      if (markers !== this.state.markers) {
        this.state.markers = markers;
        this.changed();
      }
      this.publishTranslations();
      this.layoutCard();
    } catch {
      this.host.style.display = "block";
      this.frame.classList.add("fallback");
      for (const item of this.nodes) {
        const { node, text, region } = item;
        item.layoutKey = undefined;
        item.marker = false;
        item.markerReason = undefined;
        node.classList.remove("marker", "vertical");
        node.style.backgroundColor = "#fff";
        text.textContent =
          region.translatedText.trim() ||
          t(this.lang, "manga.noReliableTranslation");
        this.describeRegion(item);
      }
      this.state.markers = 0;
      this.publishTranslations();
      this.message(t(this.lang, "manga.layoutUnsupported"));
    }
  }
  dispose() {
    this.disposed = true;
    this.closeCard();
    this.stopControls();
    this.stopFollowing();
    window.removeEventListener("pointerdown", this.outside, true);
    document.removeEventListener("astra-manga-dock-move", this.dockMove);
    document.removeEventListener(MANGA_CARD_OPEN_EVENT, this.otherCard);
    this.host.remove();
  }
}
