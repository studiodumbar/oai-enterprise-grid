import { firstPoseFlags, normalizeArrangementItems } from "./arrangement-items.js";
import { debug } from "../debug/index.js";
import {
  isAutomaticDurationSetting,
  resolveAutomaticDuration,
} from "../core/automatic-duration.js";

const IDENTITY_PRESENTATION = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  opacity: 1,
  scale: 1,
});

const HIDDEN_PRESENTATION = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  opacity: 0,
  scale: 1,
});

export const TEXT_COLOR_MAPPINGS = Object.freeze(["level", "dot"]);

// The hold cannot eat the whole phase; the cascade has to fit on both sides of
// it. A phase shorter than the authored hold is clamped to this share and says
// so on the transition channel.
export const MAXIMUM_TEXT_HOLD_SHARE = 0.6;

export const DEFAULT_TEXT_REVEAL_SETTINGS = Object.freeze({
  text: "TEXT",
  // Type size in parent cells, so the letters and the dot grid stay
  // proportional at any export resolution.
  sizeInCells: 1.5,
  offsetX: 0,
  offsetY: 0,
  // Seconds the text stays uncovered; "auto" takes the phase's hold window.
  visibleSeconds: 1,
  // Palette entries the ramp shifts by on every cascade step, so the colors
  // travel with the motion instead of standing still. 0 keeps them fixed.
  colorDrift: 1,
  // Masks the text behind each cell. null takes the canvas background.
  backgroundColor: null,
  // Deepest subdivision in the ladder: level 4 is 256 dots in one cell, so the
  // cascade runs 1, 4, 16, 64, 256 outward from the centre.
  levels: 4,
  // Only used when the event carries no cell size of its own.
  longSideCells: 5,
  dotMargin: 0.08,
  // null inherits the composition's palette, which inherits the app-wide one.
  // A palette name or an explicit list of colors both work.
  palette: null,
  // How palette colors land on the ladder: one color per subdivision level, or
  // spread across the dots inside each cell.
  colorBy: "level",
  // null takes the palette's last color.
  textColor: null,
  // Generators that expose the noise-visibility effect ramp toward this pose
  // while the string is uncovered. Other generators ignore the effect.
  noiseVisibility: Object.freeze({
    threshold: 1,
    contrast: 0.01,
    softness: 0,
  }),
  fontFamily: "'OpenAI Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  fontWeight: 700,
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`text ${label} must be a finite number.`);
  }
  return value;
}

function requireNoiseVisibility(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("text noiseVisibility must be an object.");
  }
  const { threshold, contrast, softness } = value;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError("text noiseVisibility.threshold must be between 0 and 1.");
  }
  if (!Number.isFinite(contrast) || contrast <= 0) {
    throw new RangeError("text noiseVisibility.contrast must be a finite positive number.");
  }
  if (!Number.isFinite(softness) || softness < 0 || softness > 0.5) {
    throw new RangeError("text noiseVisibility.softness must be between 0 and 0.5.");
  }
  return Object.freeze({ threshold, contrast, softness });
}

function requireColorList(value, label) {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.some(color => typeof color !== "string" || color.trim() === "")
  ) {
    throw new TypeError(`text ${label} must be a non-empty list of color strings.`);
  }
  return value;
}

/**
 * A cycle-boundary phase that hides a centered string behind a ladder of
 * subdivided cells and takes the ladder apart to show it.
 *
 * One cycle is a palindrome around the held text:
 *
 *   1. expand   — one big dot in the middle, then a cell subdivided one step
 *                 finer on each side, then one finer again, out to `levels`
 *   2. uncover  — the cells leave in the order they arrived, centre first,
 *                 showing the text that was drawn behind them all along
 *   3. hold     — the text alone, for `visibleSeconds`
 *   4. cover    — the cells come back outermost first, covering the text one
 *                 step at a time: the uncover, played backward
 *   5. collapse — and then leave outermost first, down to the single big centre
 *                 dot the cycle started from: the expand, played backward
 *
 * Every change is a cut. Nothing fades and nothing slides: a cell is either
 * drawn or not, and each one masks the text under its own footprint with the
 * canvas background so the string is never visible between the dots. Palette
 * colors shift by `colorDrift` on every cascade step, which is the one thing
 * that does not mirror — the ramp keeps travelling in one direction.
 *
 * Because the second half is the first half backward, the phase begins and ends
 * on the same single centre dot, and an outro is the same plan read in reverse.
 */
export class TextRevealArrangementMode {
  constructor(options = {}) {
    const defaults = DEFAULT_TEXT_REVEAL_SETTINGS;
    const text = options.text ?? defaults.text;
    if (typeof text !== "string" || text.trim() === "") {
      throw new TypeError("text text must be a non-empty string.");
    }
    const sizeInCells = options.sizeInCells ?? defaults.sizeInCells;
    if (!Number.isFinite(sizeInCells) || sizeInCells <= 0) {
      throw new RangeError("text sizeInCells must be a finite positive number.");
    }
    const visibleSeconds = options.visibleSeconds ?? defaults.visibleSeconds;
    if (
      (!Number.isFinite(visibleSeconds) || visibleSeconds < 0)
      && !isAutomaticDurationSetting(visibleSeconds)
    ) {
      throw new RangeError(
        "text visibleSeconds must be finite and non-negative, \"auto\", or "
        + '"calc(auto * n)" with a positive multiplier.',
      );
    }
    const levels = options.levels ?? defaults.levels;
    if (!Number.isSafeInteger(levels) || levels < 0 || levels > 6) {
      throw new RangeError("text levels must be an integer between 0 and 6.");
    }
    const longSideCells = options.longSideCells ?? defaults.longSideCells;
    if (!Number.isSafeInteger(longSideCells) || longSideCells < 1) {
      throw new RangeError("text longSideCells must be a positive integer.");
    }
    const dotMargin = options.dotMargin ?? defaults.dotMargin;
    if (!Number.isFinite(dotMargin) || dotMargin < 0 || dotMargin >= 1) {
      throw new RangeError(
        "text dotMargin must be between 0 (inclusive) and 1 (exclusive).",
      );
    }
    const colorDrift = options.colorDrift ?? defaults.colorDrift;
    if (!Number.isSafeInteger(colorDrift)) {
      throw new RangeError("text colorDrift must be an integer.");
    }
    const backgroundColor = options.backgroundColor ?? defaults.backgroundColor;
    if (
      backgroundColor !== null
      && (typeof backgroundColor !== "string" || backgroundColor.trim() === "")
    ) {
      throw new TypeError("text backgroundColor must be null or a color string.");
    }
    const colorBy = options.colorBy ?? defaults.colorBy;
    if (!TEXT_COLOR_MAPPINGS.includes(colorBy)) {
      throw new RangeError(
        `text colorBy must be one of ${TEXT_COLOR_MAPPINGS.join(", ")}.`,
      );
    }
    const textColor = options.textColor ?? defaults.textColor;
    if (textColor !== null && (typeof textColor !== "string" || textColor.trim() === "")) {
      throw new TypeError("text textColor must be null or a color string.");
    }
    const fontFamily = options.fontFamily ?? defaults.fontFamily;
    if (typeof fontFamily !== "string" || fontFamily.trim() === "") {
      throw new TypeError("text fontFamily must be a non-empty string.");
    }

    this.text = text;
    this.sizeInCells = sizeInCells;
    this.offsetX = requireFinite(options.offsetX ?? defaults.offsetX, "offsetX");
    this.offsetY = requireFinite(options.offsetY ?? defaults.offsetY, "offsetY");
    this.visibleSeconds = visibleSeconds;
    this.levels = levels;
    this.longSideCells = longSideCells;
    this.dotMargin = dotMargin;
    this.colorBy = colorBy;
    this.colorDrift = colorDrift;
    this.backgroundColor = backgroundColor;
    this.textColor = textColor;
    this.noiseVisibility = requireNoiseVisibility(
      options.noiseVisibility ?? defaults.noiseVisibility,
    );
    this.fontFamily = fontFamily;
    this.fontWeight = options.fontWeight ?? defaults.fontWeight;
    // Resolved by whoever owns the palette table — the overlay driver. The
    // presentation port never needs colors, so a mode built only to place
    // glyphs is allowed to have none.
    this.colors = options.colors === undefined || options.colors === null
      ? null
      : Object.freeze([...requireColorList(options.colors, "colors")]);
    // A palette name is data for the driver, not for this mode.
    this.palette = options.palette ?? defaults.palette;
  }

  /**
   * The ladder: one cell per level on each side of centre, every cell the same
   * parent footprint and subdivided one step finer than its inward neighbour.
   */
  ladderFor(width, height, cellSize) {
    const horizontal = width >= height;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const cells = [];
    for (let level = 0; level <= this.levels; level += 1) {
      // The centre cell has no mirror.
      for (const side of level === 0 ? [0] : [-1, 1]) {
        const offset = side * level * cellSize;
        cells.push({
          level,
          side,
          step: level,
          x: centerX + (horizontal ? offset : 0),
          y: centerY + (horizontal ? 0 : offset),
        });
      }
    }
    return cells;
  }

  /**
   * The hold owns its share of the phase first and the four cascade windows
   * split what is left evenly. Automatic timing takes the largest supported
   * hold. Only the first half is described here; the second reads it backward.
   */
  windowsFor(durationSeconds, { logClamp = true } = {}) {
    const maximumHoldSeconds = durationSeconds * MAXIMUM_TEXT_HOLD_SHARE;
    const requestedHoldSeconds = isAutomaticDurationSetting(this.visibleSeconds)
      ? resolveAutomaticDuration(this.visibleSeconds, {
        label: "text visibleSeconds",
        candidates: [{ source: "phase-hold-window", seconds: maximumHoldSeconds }],
      }).seconds
      : this.visibleSeconds;
    const holdSeconds = Math.min(
      requestedHoldSeconds,
      maximumHoldSeconds,
    );
    if (logClamp && holdSeconds < requestedHoldSeconds) {
      debug.transition(
        "text hold clamped authored=%s requested=%.3f applied=%.3f phase=%.3f",
        this.visibleSeconds,
        requestedHoldSeconds,
        holdSeconds,
        durationSeconds,
      );
    }
    const holdShare = durationSeconds > 0 ? holdSeconds / durationSeconds : 0;
    const cascadeShare = (1 - holdShare) / 4;
    return {
      holdSeconds,
      holdShare,
      cascadeShare,
      expandEnd: cascadeShare,
      holdStart: cascadeShare * 2,
      holdEnd: cascadeShare * 2 + holdShare,
      slot: cascadeShare / (this.levels + 1),
    };
  }

  createPlan({
    items,
    indices,
    layout,
    key = "scene",
    durationSeconds = 1,
  }) {
    const width = Number(layout?.width);
    const height = Number(layout?.height);
    if (!(width > 0) || !(height > 0)) {
      throw new TypeError("text requires layout width and height.");
    }
    // Prefer the composition's own cell size so the ladder lands on its grid;
    // the overlay driver has only a viewport, and falls back to longSideCells.
    const cellSize = Number.isFinite(layout?.cellSize) && layout.cellSize > 0
      ? layout.cellSize
      : Math.max(width, height) / this.longSideCells;
    const targets = items === undefined && indices === undefined
      ? []
      : normalizeArrangementItems({ items, indices, layout }, "text");
    const totalDurationSeconds = Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : 1;
    return {
      targets,
      targetOrderById: new Map(targets.map((target, order) => [target.id, order])),
      drawsTarget: firstPoseFlags(targets),
      cells: this.ladderFor(width, height, cellSize),
      cellSize,
      centerX: width * 0.5,
      centerY: height * 0.5,
      levels: this.levels,
      totalDurationSeconds,
      ...this.windowsFor(totalDurationSeconds),
      staggerSeconds: 0,
      key,
      // The ladder is the mode's own content, so the phase never depends on a
      // previous scene.
      fadeIn: true,
      sourceItemCount: 0,
    };
  }

  /**
   * Fold the phase onto its first half. Everything after the hold is the same
   * cascade read backward, which is what makes covering the mirror image of
   * uncovering instead of a jump back to a full ladder.
   */
  foldedAmountAt(plan, amount) {
    if (amount <= plan.holdStart) return amount;
    if (amount < plan.holdEnd) return plan.holdStart;
    return 1 - amount;
  }

  /** Is this cell drawn at `amount`? Two windows and a fold, all cuts. */
  cellVisibleAt(plan, cell, amount) {
    const folded = this.foldedAmountAt(plan, amount);
    // Expanding: the centre dot first, then one pair per level outward.
    if (folded < plan.expandEnd) return folded >= cell.step * plan.slot;
    // Uncovering: they leave in the order they arrived, centre first.
    return folded < plan.expandEnd + (cell.step + 1) * plan.slot;
  }

  /**
   * The text is drawn from the moment the first cell leaves until the last one
   * is back, so it is always masked rather than switched off in the open.
   */
  textVisibleAt(plan, amount) {
    return this.foldedAmountAt(plan, amount) >= plan.expandEnd;
  }

  /**
   * Clear the composition while the ladder uncovers the string, then restore
   * it during the mirrored cover so the authored field is back before the
   * string disappears.
   */
  noiseVisibilityAmountAt(plan, amount) {
    const progress = clamp01(amount);
    if (progress <= plan.expandEnd) return 0;
    if (progress < plan.holdStart) {
      const ramp = (progress - plan.expandEnd) / (plan.holdStart - plan.expandEnd);
      return ramp >= 1 - 1e-12 ? 1 : ramp;
    }
    if (progress <= plan.holdEnd) return 1;
    const coverEnd = plan.holdEnd + plan.cascadeShare;
    if (progress < coverEnd) {
      const ramp = 1 - (progress - plan.holdEnd) / plan.cascadeShare;
      return ramp <= 1e-12 ? 0 : ramp;
    }
    return 0;
  }

  phaseEffectsAt(plan, progress) {
    return {
      noiseVisibility: {
        amount: this.noiseVisibilityAmountAt(plan, progress),
        ...this.noiseVisibility,
      },
    };
  }

  phaseEffectsFor({ progress, durationSeconds }) {
    return this.phaseEffectsAt(
      this.windowsFor(durationSeconds, { logClamp: false }),
      progress,
    );
  }

  /**
   * The palette ramp travels one `colorDrift` per cascade step. This reads the
   * raw phase progress, not the folded one: the geometry mirrors, the colors
   * keep going.
   */
  colorOffsetAt(plan, amount) {
    if (this.colorDrift === 0) return 0;
    return Math.floor(clamp01(amount) / plan.slot) * this.colorDrift;
  }

  requireBackgroundColor() {
    if (this.backgroundColor === null) {
      throw new Error(
        "text has no background color to mask with. The overlay driver passes "
        + "the canvas background; author modes.text.backgroundColor to override.",
      );
    }
    return this.backgroundColor;
  }

  requireColors() {
    if (!this.colors) {
      throw new Error(
        "text has no palette colors. The overlay driver resolves them, so a "
        + "mode built for glyph placement alone cannot draw.",
      );
    }
    return this.colors;
  }

  /** Spread `count` slots across the palette, in order, then rotate by `offset`. */
  colorAt(index, count, offset = 0) {
    const colors = this.requireColors();
    const spread = colors.length === 1 || count <= 1
      ? 0
      : Math.max(0, Math.min(
        colors.length - 1,
        Math.round(index / (count - 1) * (colors.length - 1)),
      ));
    const rotated = (spread + offset) % colors.length;
    return colors[rotated < 0 ? rotated + colors.length : rotated];
  }

  textFillStyle() {
    if (this.textColor !== null) return this.textColor;
    const colors = this.requireColors();
    return colors[colors.length - 1];
  }

  /**
   * The composition is dark for the whole phase and cuts in as it ends. With no
   * fades there is nothing to hand over with.
   */
  presentationsAt(plan, targetId, progress) {
    const order = plan.targetOrderById.get(targetId);
    if (order === undefined) return [IDENTITY_PRESENTATION];
    if (clamp01(progress) >= 1) {
      return plan.drawsTarget[order] ? [IDENTITY_PRESENTATION] : [];
    }
    return plan.drawsTarget[order] ? [HIDDEN_PRESENTATION] : [];
  }

  presentationAt(plan, targetId, progress) {
    if (!plan.targetOrderById.has(targetId)) return IDENTITY_PRESENTATION;
    return clamp01(progress) >= 1 ? IDENTITY_PRESENTATION : HIDDEN_PRESENTATION;
  }

  /**
   * The overlay port: the string first, then the cells that hide it.
   */
  drawOverlay(plan, progress, context) {
    const amount = clamp01(progress);
    if (this.textVisibleAt(plan, amount)) this.drawText(plan, context);
    const offset = this.colorOffsetAt(plan, amount);
    for (const cell of plan.cells) {
      if (this.cellVisibleAt(plan, cell, amount)) {
        this.drawCell(plan, cell, offset, context);
      }
    }
  }

  drawText(plan, context) {
    context.fillStyle = this.textFillStyle();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${this.fontWeight} `
      + `${plan.cellSize * this.sizeInCells}px ${this.fontFamily}`;
    context.fillText(
      this.text,
      plan.centerX + this.offsetX,
      plan.centerY + this.offsetY,
    );
  }

  drawCell(plan, cell, offset, context) {
    const subdivisions = 1 << cell.level;
    const slot = plan.cellSize / subdivisions;
    const radius = slot * 0.5 * (1 - this.dotMargin);
    const left = cell.x - plan.cellSize * 0.5;
    const top = cell.y - plan.cellSize * 0.5;
    const dotCount = subdivisions * subdivisions;
    // A cell hides the text under its whole footprint, not only under its dots,
    // so the string never shows through the gaps in the grid.
    context.fillStyle = this.requireBackgroundColor();
    context.fillRect(left, top, plan.cellSize, plan.cellSize);
    if (this.colorBy === "level") {
      context.fillStyle = this.colorAt(cell.level, plan.levels + 1, offset);
    }
    for (let index = 0; index < dotCount; index += 1) {
      if (this.colorBy === "dot") {
        context.fillStyle = this.colorAt(index, dotCount, offset);
      }
      const x = left + (index % subdivisions + 0.5) * slot;
      const y = top + (Math.floor(index / subdivisions) + 0.5) * slot;
      context.beginPath();
      context.moveTo(x + radius, y);
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
  }
}
