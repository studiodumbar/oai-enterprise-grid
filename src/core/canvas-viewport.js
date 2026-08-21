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
  resizeWithWindow,
  windowViewport,
  requestedViewport,
} = {}) {
  if (typeof resizeWithWindow !== "boolean") {
    debug.config(
      "canvas viewport failed field=resizeWithWindow value=%j",
      resizeWithWindow,
    );
    throw new TypeError("GLOBAL_CONFIG.canvas.resizeWithWindow must be a boolean.");
  }

  const mode = resizeWithWindow ? "window" : "requested";
  const source = resizeWithWindow ? windowViewport : requestedViewport;
  const viewport = {
    width: positiveDimension(source?.width, `${mode} viewport width`),
    height: positiveDimension(source?.height, `${mode} viewport height`),
  };
  debug.config(
    "canvas viewport resolved mode=%s width=%d height=%d",
    mode,
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
