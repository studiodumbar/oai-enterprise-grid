const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function requireViewport(viewport) {
  if (
    !viewport
    || !Number.isFinite(viewport.width)
    || viewport.width <= 0
    || !Number.isFinite(viewport.height)
    || viewport.height <= 0
  ) {
    throw new RangeError("Boom launchers need a finite positive viewport.");
  }
  return viewport;
}

function requireBoom(boom) {
  if (
    !boom
    || !Number.isFinite(boom.centerX)
    || boom.centerX < 0
    || boom.centerX > 1
    || !Number.isFinite(boom.centerY)
    || boom.centerY < 0
    || boom.centerY > 1
    || !Number.isFinite(boom.radius)
    || boom.radius <= 0
  ) {
    throw new RangeError(
      "Boom must define normalized centerX/centerY and a finite positive radius.",
    );
  }
  return boom;
}

function requireIntensity(intensity) {
  if (!Number.isSafeInteger(intensity) || intensity <= 0) {
    throw new RangeError("Boom intensity must be a positive integer.");
  }
  return intensity;
}

function distanceToViewportEdge(centerX, centerY, directionX, directionY, viewport) {
  const horizontal = directionX > 0
    ? (viewport.width - centerX) / directionX
    : directionX < 0
      ? -centerX / directionX
      : Infinity;
  const vertical = directionY > 0
    ? (viewport.height - centerY) / directionY
    : directionY < 0
      ? -centerY / directionY
      : Infinity;
  return Math.max(0, Math.min(horizontal, vertical));
}

// A sunflower distribution fills the authored disc without randomness. Each
// launch direction is radial, and edge clipping keeps every origin on canvas.
export function createBoomLaunchers(boom, viewport, intensity) {
  requireBoom(boom);
  requireViewport(viewport);
  requireIntensity(intensity);
  const centerX = boom.centerX * viewport.width;
  const centerY = boom.centerY * viewport.height;
  const radius = boom.radius * Math.min(viewport.width, viewport.height);
  const launchers = [];

  for (let index = 0; index < intensity; index += 1) {
    const angle = index * GOLDEN_ANGLE;
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const discRadius = radius * Math.sqrt((index + 0.5) / intensity);
    const edgeRadius = distanceToViewportEdge(
      centerX,
      centerY,
      directionX,
      directionY,
      viewport,
    );
    const launchRadius = Math.min(discRadius, edgeRadius);
    launchers.push({
      originX: centerX + directionX * launchRadius,
      originY: centerY + directionY * launchRadius,
      directionX,
      directionY,
    });
  }
  return launchers;
}
