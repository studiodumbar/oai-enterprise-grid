export const DEFAULT_CELL_STATE = Object.freeze({
  level: 0,
  roundness: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  glyphScaleX: 1,
  glyphScaleY: 1,
  glyphScaleAxis: 0,
  glyphRotation: 0,
  glyphOffsetX: 0,
  glyphOffsetY: 0,
  // Negative means "use the grid's live energy". Transitions can supply a
  // stable face value so color changes happen while a glyph is edge-on.
  paletteValue: -1,
  opacity: 1,
});

const STATE_KEYS = Object.freeze(Object.keys(DEFAULT_CELL_STATE));

function normalizedLength(length) {
  const value = Number(length);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`CellStateBuffer length must be a non-negative integer; received ${length}`);
  }
  return value;
}

function assertCellIndex(buffer, index) {
  if (!Number.isInteger(index) || index < 0 || index >= buffer.length) {
    throw new RangeError(`Cell index ${index} is outside a buffer of length ${buffer.length}`);
  }
}

export function isCellStateBufferLike(value) {
  return Boolean(
    value
    && Number.isInteger(value.length)
    && STATE_KEYS.every(key => ArrayBuffer.isView(value[key])),
  );
}

export function resolveCellStateBuffer(frame, fallback) {
  if (isCellStateBufferLike(frame)) return frame;

  if (frame && typeof frame === "object") {
    for (const key of ["cellState", "cellStates", "cells", "buffer", "state"]) {
      if (isCellStateBufferLike(frame[key])) return frame[key];
    }
  }

  if (isCellStateBufferLike(fallback)) return fallback;
  throw new TypeError("A CellStateBuffer is required");
}

export class CellStateBuffer {
  constructor(length = 0) {
    this.length = 0;
    this.resize(length);
  }

  resize(length) {
    this.length = normalizedLength(length);
    this.level = new Uint8Array(this.length);
    this.roundness = new Float32Array(this.length);
    this.scaleX = new Float32Array(this.length);
    this.scaleY = new Float32Array(this.length);
    this.rotation = new Float32Array(this.length);
    this.offsetX = new Float32Array(this.length);
    this.offsetY = new Float32Array(this.length);
    this.glyphScaleX = new Float32Array(this.length);
    this.glyphScaleY = new Float32Array(this.length);
    this.glyphScaleAxis = new Float32Array(this.length);
    this.glyphRotation = new Float32Array(this.length);
    this.glyphOffsetX = new Float32Array(this.length);
    this.glyphOffsetY = new Float32Array(this.length);
    this.paletteValue = new Float32Array(this.length);
    this.opacity = new Float32Array(this.length);
    this.reset();
    return this;
  }

  reset(overrides = {}) {
    const state = { ...DEFAULT_CELL_STATE, ...overrides };
    for (const key of STATE_KEYS) this[key].fill(state[key]);
    return this;
  }

  resetCell(index, overrides = {}) {
    assertCellIndex(this, index);
    const state = { ...DEFAULT_CELL_STATE, ...overrides };
    for (const key of STATE_KEYS) this[key][index] = state[key];
    return this;
  }

  dispose() {
    return this.resize(0);
  }
}

export function createCellStateBuffer(length = 0) {
  return new CellStateBuffer(length);
}

export default CellStateBuffer;
