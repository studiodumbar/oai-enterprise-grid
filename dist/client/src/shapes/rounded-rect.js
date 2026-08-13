const FULL_CIRCLE_EPSILON = 1e-6;

export const IDENTITY_CELL_TRANSFORM = Object.freeze({
  scaleX: 1,
  scaleY: 1,
  scaleAxis: 0,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
});

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeRoundness(roundness) {
  return Math.max(0, Math.min(1, finiteOr(Number(roundness), 1)));
}

export function roundnessForKind(kind) {
  if (kind === "circle") return 1;
  if (kind === "square") return 0;
  throw new Error(`Unknown rounded shape kind "${kind}". Use "circle" or "square".`);
}

export function addRoundedRectPath(
  context,
  x,
  y,
  halfSize,
  roundness = 1,
  transform = IDENTITY_CELL_TRANSFORM,
) {
  const radius = Math.max(0, finiteOr(Number(halfSize), 0));
  const normalized = normalizeRoundness(roundness);
  const scaleX = finiteOr(Number(transform?.scaleX), 1);
  const scaleY = finiteOr(Number(transform?.scaleY), 1);
  const scaleAxis = finiteOr(Number(transform?.scaleAxis), 0);
  const rotation = finiteOr(Number(transform?.rotation), 0);
  const offsetX = finiteOr(Number(transform?.offsetX), 0);
  const offsetY = finiteOr(Number(transform?.offsetY), 0);

  context.save();
  context.translate(x + offsetX, y + offsetY);
  context.rotate(rotation);
  if (scaleAxis !== 0) context.rotate(scaleAxis);
  context.scale(scaleX, scaleY);
  if (scaleAxis !== 0) context.rotate(-scaleAxis);

  if (normalized >= 1 - FULL_CIRCLE_EPSILON) {
    context.moveTo(radius, 0);
    context.arc(0, 0, radius, 0, Math.PI * 2);
  } else {
    context.roundRect(-radius, -radius, radius * 2, radius * 2, radius * normalized);
  }

  context.restore();
}

export class RoundedRectRenderer {
  addPath(context, x, y, halfSize, roundness = 1, transform = IDENTITY_CELL_TRANSFORM) {
    addRoundedRectPath(context, x, y, halfSize, roundness, transform);
  }
}

export function createRoundedRectRenderer() {
  return new RoundedRectRenderer();
}

export default RoundedRectRenderer;
