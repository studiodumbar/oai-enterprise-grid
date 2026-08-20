import {
  GRID_FACE_PALETTE_STEP_COUNT,
  MAX_GRID_FACE_LEVEL,
} from "../generators/grid-scene-strategies.js";

const CIRCLE_TAU = Math.PI * 2;

export function compositionEndpointPaletteColor(
  paletteColors,
  paletteStep,
  paletteStepCount = GRID_FACE_PALETTE_STEP_COUNT,
) {
  if (!Array.isArray(paletteColors) || paletteColors.length === 0) {
    throw new TypeError("Composition endpoint rendering requires a non-empty palette.");
  }
  if (!Number.isFinite(paletteStep)) {
    throw new TypeError("Composition endpoint palette steps must be finite numbers.");
  }
  if (!Number.isSafeInteger(paletteStepCount) || paletteStepCount < 2) {
    throw new RangeError("Composition endpoint paletteStepCount must be at least two.");
  }
  const normalized = Math.max(0, Math.min(1, paletteStep / (paletteStepCount - 1)));
  return paletteColors[Math.round(normalized * (paletteColors.length - 1))];
}

function requireEndpointFrame(endpointFrame) {
  if (!endpointFrame || typeof endpointFrame !== "object") {
    throw new TypeError("Composition endpoint frame must be an object.");
  }
  const { layout } = endpointFrame;
  if (
    !layout
    || !Number.isSafeInteger(layout.columns)
    || layout.columns < 1
    || !Number.isSafeInteger(layout.rows)
    || layout.rows < 1
    || !Number.isFinite(layout.cellSize)
    || layout.cellSize <= 0
  ) {
    throw new TypeError("Composition endpoint frame needs a valid parent-cell layout.");
  }
  if (!Array.isArray(endpointFrame.cells)) {
    throw new TypeError("Composition endpoint frame cells must be an array.");
  }
  return endpointFrame;
}

/** Draws the endpoint's parent cells without depending on a generator type. */
export function drawCompositionEndpointFrame(
  context,
  endpointFrame,
  { dotMargin, colorForGlyph },
) {
  if (
    !context
    || typeof context.beginPath !== "function"
    || typeof context.save !== "function"
    || typeof context.restore !== "function"
  ) {
    throw new TypeError("Composition endpoint rendering requires a 2D drawing context.");
  }
  if (!Number.isFinite(dotMargin) || dotMargin < 0 || dotMargin >= 1) {
    throw new RangeError("Composition endpoint dotMargin must be between zero and one.");
  }
  if (typeof colorForGlyph !== "function") {
    throw new TypeError("Composition endpoint rendering requires colorForGlyph().");
  }

  const frame = requireEndpointFrame(endpointFrame);
  const { layout } = frame;
  const inheritedAlpha = Number.isFinite(context.globalAlpha)
    ? context.globalAlpha
    : 1;
  context.save();
  try {
    context.globalAlpha = inheritedAlpha;
    for (const cell of frame.cells) {
      if (
        !Number.isSafeInteger(cell.index)
        || cell.index < 0
        || cell.index >= layout.columns * layout.rows
        || !Number.isSafeInteger(cell.level)
        || cell.level < 0
        || cell.level > MAX_GRID_FACE_LEVEL
      ) {
        throw new RangeError("Composition endpoint cells need valid indices and levels.");
      }
      const subdivisions = 1 << cell.level;
      const glyphCount = subdivisions ** 2;
      const paletteSteps = cell.paletteSteps;
      if (Array.isArray(paletteSteps) && paletteSteps.length !== glyphCount) {
        throw new Error(
          `Composition endpoint cell ${cell.index} at level ${cell.level} needs `
          + `${glyphCount} palette steps; received ${paletteSteps.length}.`,
        );
      }
      const slot = layout.cellSize / subdivisions;
      const radius = slot * 0.5 * (1 - dotMargin);
      const cellColumn = cell.index % layout.columns;
      const cellRow = Math.floor(cell.index / layout.columns);
      const left = layout.offsetX + cellColumn * layout.cellSize;
      const top = layout.offsetY + cellRow * layout.cellSize;
      for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex += 1) {
        const glyphColumn = glyphIndex % subdivisions;
        const glyphRow = Math.floor(glyphIndex / subdivisions);
        const x = left + (glyphColumn + 0.5) * slot;
        const y = top + (glyphRow + 0.5) * slot;
        context.fillStyle = colorForGlyph({
          cell,
          cellColumn,
          cellRow,
          glyphIndex,
          glyphColumn,
          glyphRow,
          subdivisions,
          paletteStep: paletteSteps?.[glyphIndex] ?? frame.paletteStep,
          endpointFrame: frame,
        });
        context.beginPath();
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, CIRCLE_TAU);
        context.fill();
      }
    }
  } finally {
    context.restore();
  }
}
