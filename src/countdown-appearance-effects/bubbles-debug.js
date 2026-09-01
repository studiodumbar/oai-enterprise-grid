function requireDebugObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      "countdownFramed.appearance.effects.frame.debug must be an object.",
    );
  }
  return value;
}

export function resolveCountdownBubblesDebugSettings(value) {
  const debug = requireDebugObject(value);
  if (typeof debug.visualizeBubbles !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.frame.debug.visualizeBubbles "
      + "must be a boolean.",
    );
  }
  if (!Number.isFinite(debug.opacity) || debug.opacity <= 0 || debug.opacity > 1) {
    throw new RangeError(
      "countdownFramed.appearance.effects.frame.debug.opacity must be greater "
      + "than zero and no greater than one.",
    );
  }
  return Object.freeze({
    visualizeBubbles: debug.visualizeBubbles,
    opacity: debug.opacity,
  });
}

export function drawCountdownBubblesDebug(
  context,
  layout,
  bubbles,
  settings,
  subdivisionLevel,
  color,
  framePlan = null,
) {
  if (!settings.visualizeBubbles || bubbles.length === 0) return;
  const subdivisions = 1 << subdivisionLevel;
  const slot = layout.cellSize / subdivisions;

  context.save();
  context.globalAlpha *= settings.opacity;
  context.fillStyle = color;
  const squareByIndex = framePlan === null
    ? null
    : new Map(framePlan.squares.map(square => [square.squareIndex, square]));
  for (const bubble of bubbles) {
    if (framePlan !== null && Array.isArray(bubble.avoidedSquareIndices)) {
      for (const squareIndex of bubble.avoidedSquareIndices) {
        const square = squareByIndex.get(squareIndex);
        if (!square) continue;
        const columns = square.dots.map(dot => dot.column);
        const rows = square.dots.map(dot => dot.row);
        const left = layout.offsetX + Math.min(...columns) * slot;
        const top = layout.offsetY + Math.min(...rows) * slot;
        const width = (Math.max(...columns) - Math.min(...columns) + 1) * slot;
        const height = (Math.max(...rows) - Math.min(...rows) + 1) * slot;
        context.beginPath();
        context.rect(left, top, width, height);
        context.fill();
      }
      continue;
    }
    for (const circle of bubble.circles) {
      const outerRadius = circle.radius * slot;
      const innerRadius = (circle.refillRadius ?? 0) * slot;
      if (outerRadius <= innerRadius || outerRadius <= 0) continue;
      const x = layout.offsetX + circle.x * slot;
      const y = layout.offsetY + circle.y * slot;
      context.beginPath();
      context.moveTo(x + outerRadius, y);
      context.arc(x, y, outerRadius, 0, Math.PI * 2);
      if (innerRadius > 0) {
        context.moveTo(x + innerRadius, y);
        context.arc(x, y, innerRadius, 0, Math.PI * 2, true);
      }
      context.fill("evenodd");
    }
  }
  context.restore();
}
