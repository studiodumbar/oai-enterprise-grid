import { cubicBezierAt } from "../core/cubic-bezier.js";

function rotatingGridDots(
  topLeftColumn,
  topLeftRow,
  size,
  gridColumns,
  squareIndex,
  direction,
) {
  const positions = [];
  let left = 0;
  let right = size - 1;
  let top = 0;
  let bottom = size - 1;
  while (left <= right && top <= bottom) {
    for (let column = left; column <= right; column += 1) {
      positions.push({ column, row: top });
    }
    top += 1;
    for (let row = top; row <= bottom; row += 1) {
      positions.push({ column: right, row });
    }
    right -= 1;
    if (top <= bottom) {
      for (let column = right; column >= left; column -= 1) {
        positions.push({ column, row: bottom });
      }
      bottom -= 1;
    }
    if (left <= right) {
      for (let row = bottom; row >= top; row -= 1) {
        positions.push({ column: left, row });
      }
      left += 1;
    }
  }
  return positions.map((position, clockwiseIndex) => {
    const rotated = direction === "counter-clockwise"
      ? { column: position.row, row: position.column }
      : position;
    return {
      column: topLeftColumn + rotated.column,
      row: topLeftRow + rotated.row,
      index: (topLeftRow + rotated.row) * gridColumns
        + topLeftColumn + rotated.column,
      squareIndex,
      clockwiseIndex,
      palettePosition: clockwiseIndex / Math.max(1, positions.length - 1),
      sizeInSubdivisions: 1,
      rotationDirection: direction,
    };
  });
}

export function clockwiseGridDots(
  topLeftColumn,
  topLeftRow,
  size,
  gridColumns,
  squareIndex = 0,
) {
  return rotatingGridDots(
    topLeftColumn,
    topLeftRow,
    size,
    gridColumns,
    squareIndex,
    "clockwise",
  );
}

export function counterClockwiseGridDots(
  topLeftColumn,
  topLeftRow,
  size,
  gridColumns,
  squareIndex = 0,
) {
  return rotatingGridDots(
    topLeftColumn,
    topLeftRow,
    size,
    gridColumns,
    squareIndex,
    "counter-clockwise",
  );
}

export function clockwiseSquareDots(
  topLeftColumn,
  topLeftRow,
  gridColumns,
  squareIndex = 0,
) {
  return clockwiseGridDots(
    topLeftColumn,
    topLeftRow,
    2,
    gridColumns,
    squareIndex,
  );
}

export function clockwiseVisibleCountAt(linearProgress, dotCount, timingCurve) {
  const progress = Math.max(0, Math.min(1, Number(linearProgress) || 0));
  const easedProgress = cubicBezierAt(progress, timingCurve);
  return {
    linearProgress: progress,
    progress: easedProgress,
    visibleCount: Math.min(dotCount, Math.ceil(easedProgress * dotCount)),
  };
}

export function clockwiseDotColors(frame, palette, flicker, time) {
  if (!frame || !Array.isArray(frame.dots)) {
    throw new TypeError("Countdown clockwise colors require frame dots.");
  }
  if (!Array.isArray(palette) || palette.length === 0) {
    throw new TypeError("Countdown clockwise colors require a palette.");
  }
  if (!Number.isFinite(time)) {
    throw new TypeError("Countdown clockwise flicker time must be finite.");
  }
  const canFlicker = flicker?.enabled === true
    && typeof flicker.sampleAt === "function"
    && typeof flicker.colorFromNoise === "function";
  return frame.dots.map((dot, index) => {
    const palettePosition = Number.isFinite(dot.palettePosition)
      ? Math.max(0, Math.min(1, dot.palettePosition))
      : Math.min(dot.clockwiseIndex ?? index, palette.length - 1)
        / Math.max(1, palette.length - 1);
    const paletteIndex = Math.min(
      palette.length - 1,
      Math.round(palettePosition * (palette.length - 1)),
    );
    if (!canFlicker) return palette[paletteIndex];
    const sample = flicker.sampleAt(dot.column + 0.5, dot.row + 0.5, time);
    return flicker.colorFromNoise(
      palettePosition,
      sample,
    );
  });
}
