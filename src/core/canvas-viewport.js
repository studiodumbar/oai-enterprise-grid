import { debug } from "../debug/index.js";

function positiveDimension(value, label) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < 1) {
    debug.config("canvas viewport failed field=%s value=%j", label, value);
    throw new RangeError(`${label} must be a positive finite number.`);
  }
  return number;
}

/**
 * Resolve the logical canvas used by generators. The displayed canvas may be
 * CSS-scaled, but this viewport is the coordinate system captured by export.
 */
export function resolveCanvasViewport({
  requestedViewport,
} = {}) {
  const viewport = {
    width: positiveDimension(requestedViewport?.width, "requested viewport width"),
    height: positiveDimension(requestedViewport?.height, "requested viewport height"),
  };
  debug.config(
    "canvas viewport resolved mode=requested width=%d height=%d",
    viewport.width,
    viewport.height,
  );
  return viewport;
}

export function fitCanvasDisplaySize(logicalViewport, availableViewport) {
  const logicalWidth = positiveDimension(logicalViewport?.width, "logical canvas width");
  const logicalHeight = positiveDimension(logicalViewport?.height, "logical canvas height");
  const availableWidth = positiveDimension(availableViewport?.width, "available width");
  const availableHeight = positiveDimension(availableViewport?.height, "available height");
  const scale = Math.min(
    availableWidth / logicalWidth,
    availableHeight / logicalHeight,
  );
  return {
    width: logicalWidth * scale,
    height: logicalHeight * scale,
  };
}
