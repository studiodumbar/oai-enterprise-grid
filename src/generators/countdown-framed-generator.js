import { debug } from "../debug/index.js";
import { createCircleGridSceneLayout } from "./circle-grid-scene-generator.js";
import { hashUnit } from "./grid-scene-strategies.js";

const CELL_SELECTION_SALT = 1879;

function requireFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`);
  }
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function boundedHashIndex(seed, tick, count) {
  return Math.min(count - 1, Math.floor(hashUnit(seed, tick, CELL_SELECTION_SALT) * count));
}

export function formatCountdown(totalSeconds) {
  const seconds = requireNonNegativeInteger(totalSeconds, "Countdown seconds");
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

/** A seeded cell sequence that never repeats the immediately previous cell. */
export function countdownCellIndex(projectSeed, tick, cellCount) {
  const seed = requireNonNegativeInteger(projectSeed, "Countdown project seed") >>> 0;
  const targetTick = requireNonNegativeInteger(tick, "Countdown tick");
  const count = requireNonNegativeInteger(cellCount, "Countdown cell count");
  if (count === 0) throw new RangeError("Countdown cell count must be greater than zero.");
  if (count === 1) return 0;

  let selected = boundedHashIndex(seed, 0, count);
  for (let index = 1; index <= targetTick; index += 1) {
    const candidate = boundedHashIndex(seed, index, count - 1);
    selected = candidate >= selected ? candidate + 1 : candidate;
  }
  return selected;
}

function resolveTextColor(options, palettes) {
  if (options.textColor !== null && options.textColor !== undefined) {
    return requireString(options.textColor, "countdownFramed.textColor");
  }
  const palette = palettes?.[options.palette];
  if (!Array.isArray(palette) || palette.length === 0) {
    throw new Error(
      `countdownFramed refers to unavailable palette "${options.palette}".`,
    );
  }
  return palette.at(-1);
}

export class CountdownFramedGenerator {
  constructor({ name, settingsKey, options, runtime, palettes }) {
    if (!runtime || typeof runtime.viewport !== "function") {
      throw new TypeError("Countdown framed requires runtime.viewport().");
    }
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Countdown framed options must be an object.");
    }
    if (!options.timing || typeof options.timing !== "object") {
      throw new TypeError("countdownFramed requires resolved composition timing.");
    }

    this.generatorInstanceId = name ?? null;
    this.settingsKey = settingsKey ?? null;
    this.runtime = runtime;
    this.countFromSeconds = requireNonNegativeInteger(
      options.countFromSeconds,
      "countdownFramed.countFromSeconds",
    );
    this.tickSeconds = requireFinitePositive(
      options.timing.beatSeconds,
      "countdownFramed.timing.beatSeconds",
    );
    this.durationSeconds = requireFinitePositive(
      options.timing.bodyDurationSeconds,
      "countdownFramed.timing.bodyDurationSeconds",
    );
    const expectedBeatCount = this.countFromSeconds + 1;
    if (options.timing.beatCount !== expectedBeatCount) {
      throw new Error(
        `countdownFramed.timing.beatCount must be ${expectedBeatCount} to include 00:00.`,
      );
    }
    this.longSideCells = requireFinitePositive(
      options.longSideCells,
      "countdownFramed.longSideCells",
    );
    this.fontFamily = requireString(options.fontFamily, "countdownFramed.fontFamily");
    this.fontWeight = requireFinitePositive(
      options.fontWeight,
      "countdownFramed.fontWeight",
    );
    this.fontSizeInCells = requireFinitePositive(
      options.fontSizeInCells,
      "countdownFramed.fontSizeInCells",
    );
    this.textColor = resolveTextColor(options, palettes);
    const authoredSeed = Number(runtime.projectSeed?.() ?? 0);
    this.projectSeed = Number.isInteger(authoredSeed) && authoredSeed >= 0
      ? authoredSeed >>> 0
      : 0;

    this.active = false;
    this.disposed = false;
    this.elapsed = 0;
    this.tick = -1;
    this.remainingSeconds = this.countFromSeconds;
    this.label = formatCountdown(this.remainingSeconds);
    this.cellIndex = 0;
    this.resize(runtime.viewport());
  }

  resize(viewport) {
    this.layout = createCircleGridSceneLayout(viewport, this.longSideCells);
    this.cellIndex = countdownCellIndex(
      this.projectSeed,
      Math.max(0, this.tick),
      this.layout.columns * this.layout.rows,
    );
  }

  enter(frame = {}) {
    if (this.disposed) throw new Error("Countdown framed has been disposed.");
    this.active = true;
    this.setTime(Number.isFinite(frame.time) ? frame.time : 0, true);
  }

  exit() {
    this.active = false;
  }

  update(frame = {}) {
    if (this.disposed) throw new Error("Countdown framed has been disposed.");
    const dt = Number.isFinite(frame.compositionDt)
      ? frame.compositionDt
      : (Number.isFinite(frame.dt) ? frame.dt : 0);
    const time = Number.isFinite(frame.time) ? frame.time : this.elapsed + Math.max(0, dt);
    this.setTime(time);
  }

  setTime(time, force = false) {
    if (!Number.isFinite(time) || time < 0) {
      throw new RangeError("Countdown framed time must be finite and non-negative.");
    }
    this.elapsed = time;
    const localTime = time % this.durationSeconds;
    const nextTick = Math.min(
      this.countFromSeconds,
      Math.floor(localTime / this.tickSeconds),
    );
    if (!force && nextTick === this.tick) return;

    this.tick = nextTick;
    this.remainingSeconds = this.countFromSeconds - nextTick;
    this.label = formatCountdown(this.remainingSeconds);
    this.cellIndex = countdownCellIndex(
      this.projectSeed,
      nextTick,
      this.layout.columns * this.layout.rows,
    );
    debug.cells(
      "countdown tick=%d label=%s cell=%d",
      this.tick,
      this.label,
      this.cellIndex,
    );
  }

  draw(frame, planEntry, context) {
    if (!this.active) return;
    const column = this.cellIndex % this.layout.columns;
    const row = Math.floor(this.cellIndex / this.layout.columns);
    const x = this.layout.offsetX + (column + 0.5) * this.layout.cellSize;
    const y = this.layout.offsetY + (row + 0.5) * this.layout.cellSize;

    context.fillStyle = this.textColor;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${this.fontWeight} `
      + `${this.layout.cellSize * this.fontSizeInCells}px ${this.fontFamily}`;
    context.fillText(this.label, x, y, this.layout.cellSize * 0.9);
  }

  animationDuration() {
    return this.durationSeconds;
  }

  seek(time) {
    if (!Number.isFinite(time) || time < 0) return false;
    this.setTime(time, true);
    return true;
  }

  contentBounds() {
    return {
      x: this.layout.offsetX,
      y: this.layout.offsetY,
      width: this.layout.patternWidth,
      height: this.layout.patternHeight,
    };
  }

  inspect() {
    return {
      generatorInstanceId: this.generatorInstanceId,
      generatorType: "countdown-framed",
      settingsKey: this.settingsKey,
      active: this.active,
      elapsed: this.elapsed,
      tick: this.tick,
      remainingSeconds: this.remainingSeconds,
      label: this.label,
      cellIndex: this.cellIndex,
      cell: {
        column: this.cellIndex % this.layout.columns,
        row: Math.floor(this.cellIndex / this.layout.columns),
      },
      layout: { ...this.layout },
      animationDuration: this.animationDuration(),
    };
  }

  dispose() {
    this.active = false;
    this.disposed = true;
  }
}
