import { cubicBezierAt } from "../core/cubic-bezier.js";

export function clockwiseSquareDots(
  topLeftColumn,
  topLeftRow,
  gridColumns,
  squareIndex = 0,
) {
  return [
    { column: topLeftColumn, row: topLeftRow },
    { column: topLeftColumn + 1, row: topLeftRow },
    { column: topLeftColumn + 1, row: topLeftRow + 1 },
    { column: topLeftColumn, row: topLeftRow + 1 },
  ].map((dot, clockwiseIndex) => ({
    ...dot,
    index: dot.row * gridColumns + dot.column,
    squareIndex,
    clockwiseIndex,
  }));
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
    const paletteIndex = Math.min(
      dot.clockwiseIndex ?? index,
      palette.length - 1,
    );
    if (!canFlicker) return palette[paletteIndex];
    const sample = flicker.sampleAt(dot.column + 0.5, dot.row + 0.5, time);
    return flicker.colorFromNoise(
      paletteIndex / Math.max(1, palette.length - 1),
      sample,
    );
  });
}
