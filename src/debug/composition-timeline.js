import { debug } from "./index.js";

const MINIMUM_FONT_SIZE = 9;
const MAXIMUM_FONT_SIZE = 16;
const HORIZONTAL_MARGIN = 12;
const BOTTOM_MARGIN = 18;
const ITEM_PADDING_X = 8;
const ITEM_PADDING_Y = 5;
const ITEM_GAP = 6;
const SEPARATOR = "·";
const FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireViewport(viewport) {
  const width = Number(viewport?.width);
  const height = Number(viewport?.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new RangeError("Composition timeline debug viewport must be positive.");
  }
  return { width, height };
}

function requireContext(context) {
  for (const method of ["save", "restore", "measureText", "fillText", "fillRect"]) {
    if (typeof context?.[method] !== "function") {
      throw new TypeError(`Composition timeline debug context requires ${method}().`);
    }
  }
  return context;
}

function normalizedItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError("Composition timeline debug items must be a non-empty array.");
  }
  const ids = new Set();
  return Object.freeze(items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TypeError(`Composition timeline debug items[${index}] must be an object.`);
    }
    const id = requireNonEmptyString(item.id, `Composition timeline debug items[${index}].id`);
    if (ids.has(id)) {
      throw new Error(`Duplicate composition timeline debug item "${id}".`);
    }
    ids.add(id);
    return Object.freeze({
      id,
      label: requireNonEmptyString(
        item.label,
        `Composition timeline debug items[${index}].label`,
      ),
    });
  }));
}

function textWidth(context, text) {
  return Number(context.measureText(text)?.width) || 0;
}

function measuredLine(context, items, fontSize) {
  context.font = `600 ${fontSize}px ${FONT_FAMILY}`;
  const separatorWidth = textWidth(context, SEPARATOR);
  const widths = items.map(item => textWidth(context, item.label) + ITEM_PADDING_X * 2);
  return {
    fontSize,
    widths,
    width: widths.reduce((sum, width) => sum + width, 0)
      + Math.max(0, items.length - 1) * (separatorWidth + ITEM_GAP * 2),
    separatorWidth,
  };
}

function fittedLine(context, items, availableWidth) {
  for (let fontSize = MAXIMUM_FONT_SIZE; fontSize > MINIMUM_FONT_SIZE; fontSize -= 1) {
    const measured = measuredLine(context, items, fontSize);
    if (measured.width <= availableWidth) return measured;
  }
  return measuredLine(context, items, MINIMUM_FONT_SIZE);
}

/**
 * A canvas-visible timeline score backed by the same change-only debug channel
 * used by headless runs. Call update every frame; it emits only when ownership
 * changes and draws only while the timeline channel is enabled.
 */
export class CompositionTimelineDebug {
  constructor({ compositionId, items, accentColor = "#93DDB1" }) {
    this.compositionId = requireNonEmptyString(
      compositionId,
      "Composition timeline debug compositionId",
    );
    this.items = normalizedItems(items);
    this.itemIds = new Set(this.items.map(item => item.id));
    this.accentColor = requireNonEmptyString(
      accentColor,
      "Composition timeline debug accentColor",
    );
    this.activeIds = new Set();
    this.elapsedSeconds = 0;
    this.loggedSignature = null;
  }

  update({ activeIds = [], elapsedSeconds = 0 } = {}) {
    if (!Array.isArray(activeIds)) {
      throw new TypeError("Composition timeline debug activeIds must be an array.");
    }
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
      throw new RangeError(
        "Composition timeline debug elapsedSeconds must be finite and non-negative.",
      );
    }
    const nextActiveIds = new Set(activeIds.map((id, index) => {
      requireNonEmptyString(id, `Composition timeline debug activeIds[${index}]`);
      if (!this.itemIds.has(id)) {
        throw new Error(`Unknown composition timeline debug item "${id}".`);
      }
      return id;
    }));
    this.activeIds = nextActiveIds;
    this.elapsedSeconds = elapsedSeconds;

    if (!debug.on.timeline) {
      this.loggedSignature = null;
      return this;
    }
    const signature = this.items.map(item => (
      `${item.id}:${nextActiveIds.has(item.id) ? "on" : "off"}`
    )).join(",");
    if (signature !== this.loggedSignature) {
      debug.timeline(
        "composition-timeline composition=%s time=%.3f active=%s states=%s",
        this.compositionId,
        elapsedSeconds,
        this.items.filter(item => nextActiveIds.has(item.id)).map(item => item.id).join(",")
          || "none",
        signature,
      );
      this.loggedSignature = signature;
    }
    return this;
  }

  draw(context, viewport, { exporting = false } = {}) {
    if (!debug.on.timeline || exporting) return false;
    requireContext(context);
    const { width, height } = requireViewport(viewport);
    const availableWidth = Math.max(1, width - HORIZONTAL_MARGIN * 2);

    context.save();
    try {
      context.textAlign = "left";
      context.textBaseline = "middle";
      const line = fittedLine(context, this.items, availableWidth);
      const lineHeight = line.fontSize + ITEM_PADDING_Y * 2;
      let cursor = (width - line.width) * 0.5;
      const top = height - BOTTOM_MARGIN - lineHeight;

      context.fillStyle = "rgba(0, 0, 0, 0.78)";
      context.fillRect(
        cursor - ITEM_GAP,
        top - 2,
        line.width + ITEM_GAP * 2,
        lineHeight + 4,
      );

      for (let index = 0; index < this.items.length; index += 1) {
        const item = this.items[index];
        const itemWidth = line.widths[index];
        const active = this.activeIds.has(item.id);
        if (active) {
          context.fillStyle = this.accentColor;
          context.fillRect(cursor, top, itemWidth, lineHeight);
        }
        context.fillStyle = active ? "#000000" : "rgba(255, 255, 255, 0.42)";
        context.fillText(item.label, cursor + ITEM_PADDING_X, top + lineHeight * 0.5);
        cursor += itemWidth;
        if (index === this.items.length - 1) continue;
        cursor += ITEM_GAP;
        context.fillStyle = "rgba(255, 255, 255, 0.24)";
        context.fillText(SEPARATOR, cursor, top + lineHeight * 0.5);
        cursor += line.separatorWidth + ITEM_GAP;
      }
    } finally {
      context.restore();
    }
    return true;
  }

  inspect() {
    return {
      compositionId: this.compositionId,
      elapsedSeconds: this.elapsedSeconds,
      items: this.items.map(item => ({
        ...item,
        active: this.activeIds.has(item.id),
      })),
    };
  }
}
