// Shared per-cell palette sampling. Base is the visual reference: sample every
// glyph in finest-subdivision units, then let cell-scoped noise rank-spread the
// complete palette instead of reducing a whole parent cell to one color.
export const FLICKER_DOTS_PER_CELL_AXIS = 16;

export function flickerPaletteIndicesAtCoordinates({
  flicker,
  coordinates,
  time,
  basePosition = 0.5,
  amount = flicker?.amount,
}) {
  if (!flicker || typeof flicker.sampleAt !== "function") {
    throw new TypeError("Cell flicker requires a flicker controller.");
  }
  if (!Array.isArray(coordinates)) {
    throw new TypeError("Cell flicker coordinates must be an array.");
  }
  const samples = new Float32Array(coordinates.length);
  const order = Array.from({ length: coordinates.length }, (_, index) => index);

  for (let index = 0; index < coordinates.length; index += 1) {
    const coordinate = coordinates[index];
    if (!Number.isFinite(coordinate?.x) || !Number.isFinite(coordinate?.y)) {
      throw new TypeError("Cell flicker coordinates must contain finite x and y values.");
    }
    samples[index] = flicker.sampleAt(coordinate.x, coordinate.y, time);
  }

  const paletteCount = flicker.paletteColors.length;
  const useRank = flicker.spreadsRankAcrossCell(coordinates.length);
  if (useRank) {
    order.sort((first, second) => samples[first] - samples[second] || first - second);
  }

  const indices = new Uint16Array(coordinates.length);
  for (let rank = 0; rank < coordinates.length; rank += 1) {
    const index = useRank ? order[rank] : rank;
    if (useRank) {
      const target = Math.min(
        paletteCount - 1,
        Math.floor(rank * paletteCount / coordinates.length),
      ) / Math.max(1, paletteCount - 1);
      indices[index] = flicker.paletteIndexFromSample(
        basePosition,
        target,
        amount,
      );
    } else if (flicker.distribution === "level") {
      indices[index] = flicker.paletteIndexFromSample(
        basePosition,
        samples[index],
        amount,
      );
    } else {
      indices[index] = flicker.paletteIndexFromNoise(
        basePosition,
        samples[index],
        amount,
      );
    }
  }
  return indices;
}

export function flickerPaletteIndicesForCell({
  flicker,
  level,
  time,
  parentColumn = 0,
  parentRow = 0,
  basePosition = 0.5,
  amount = flicker?.amount,
  dotsPerCellAxis = FLICKER_DOTS_PER_CELL_AXIS,
}) {
  if (!Number.isInteger(level) || level < 0) {
    throw new RangeError("Cell flicker level must be a non-negative integer.");
  }
  const subdivisions = 1 << level;
  const glyphCount = subdivisions * subdivisions;
  const coordinateStep = dotsPerCellAxis / subdivisions;
  const halfStep = coordinateStep * 0.5;
  const originX = flicker.scope === "cell"
    ? halfStep
    : parentColumn * dotsPerCellAxis + halfStep;
  const originY = flicker.scope === "cell"
    ? halfStep
    : parentRow * dotsPerCellAxis + halfStep;
  const coordinates = Array.from({ length: glyphCount }, (_, glyphIndex) => ({
    x: originX + (glyphIndex % subdivisions) * coordinateStep,
    y: originY + Math.floor(glyphIndex / subdivisions) * coordinateStep,
  }));
  return flickerPaletteIndicesAtCoordinates({
    flicker,
    coordinates,
    time,
    basePosition,
    amount,
  });
}
