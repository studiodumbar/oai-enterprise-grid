// The overlay port.
//
// An arrangement mode normally only answers "where does this glyph sit right
// now". A mode whose phase has content of its own — a ladder of cells that is
// not in any scene, a string of text — also implements:
//
//   drawOverlay(plan, progress, context)
//
// It is called once per frame, after the render plan, with the phase progress
// already mapped so that 0 is the start of the phase in either direction. The
// caller owns save/restore, so a mode may set fillStyle, font and globalAlpha
// freely.
const CONTEXT_METHODS = ["save", "restore", "beginPath", "fill"];

export function modeDrawsOverlay(mode) {
  return typeof mode?.drawOverlay === "function";
}

export function drawArrangementOverlay(mode, plan, progress, context) {
  if (!modeDrawsOverlay(mode) || !plan) return false;
  for (const method of CONTEXT_METHODS) {
    if (typeof context?.[method] !== "function") {
      throw new TypeError(
        `An arrangement overlay requires a 2D drawing context with ${method}().`,
      );
    }
  }
  context.save();
  try {
    mode.drawOverlay(plan, Math.max(0, Math.min(1, progress)), context);
  } finally {
    context.restore();
  }
  return true;
}
