const POINT_EPSILON = 1e-9;

function finitePoint(point, index) {
  if (
    !point
    || typeof point !== "object"
    || Array.isArray(point)
    || !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
  ) {
    throw new TypeError(`Flock path point ${index} must contain finite x and y values.`);
  }
  return { x: point.x, y: point.y };
}

export function createArcLengthPath(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new RangeError("Flock paths require at least two points.");
  }

  const resolvedPoints = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = finitePoint(points[index], index);
    const previous = resolvedPoints.at(-1);
    if (
      previous
      && Math.hypot(point.x - previous.x, point.y - previous.y) <= POINT_EPSILON
    ) continue;
    resolvedPoints.push(point);
  }
  if (resolvedPoints.length < 2) {
    throw new RangeError("Flock paths require two distinct points.");
  }

  const segments = [];
  let length = 0;
  for (let index = 1; index < resolvedPoints.length; index += 1) {
    const from = resolvedPoints[index - 1];
    const to = resolvedPoints[index];
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const segmentLength = Math.hypot(deltaX, deltaY);
    segments.push({
      from,
      to,
      start: length,
      end: length + segmentLength,
      length: segmentLength,
      directionX: deltaX / segmentLength,
      directionY: deltaY / segmentLength,
    });
    length += segmentLength;
  }

  return { points: resolvedPoints, segments, length };
}

export function createViewportFlockPath(path, viewport) {
  if (!path || typeof path !== "object" || Array.isArray(path)) {
    throw new TypeError("Picasso steps require a path object.");
  }
  if (
    !viewport
    || !Number.isFinite(viewport.width)
    || viewport.width <= 0
    || !Number.isFinite(viewport.height)
    || viewport.height <= 0
  ) {
    throw new RangeError("Flock path viewport dimensions must be finite and positive.");
  }
  if (!Array.isArray(path.points)) {
    throw new TypeError("Picasso paths require a points array.");
  }

  const points = path.points.map((point, index) => {
    const normalized = finitePoint(point, index);
    if (
      normalized.x < 0
      || normalized.x > 1
      || normalized.y < 0
      || normalized.y > 1
    ) {
      throw new RangeError(`Picasso path point ${index} must be normalized from zero to one.`);
    }
    return {
      x: normalized.x * viewport.width,
      y: normalized.y * viewport.height,
    };
  });
  return createArcLengthPath(points);
}

export function sampleArcLengthPath(path, progress) {
  if (!path || !Array.isArray(path.segments) || !(path.length > 0)) {
    throw new TypeError("Arc-length path must be created by createArcLengthPath().");
  }
  if (!Number.isFinite(progress)) {
    throw new RangeError("Flock path progress must be finite.");
  }
  const amount = Math.max(0, Math.min(1, progress));
  const distance = amount * path.length;
  let segment = path.segments.at(-1);
  for (const candidate of path.segments) {
    if (distance < candidate.end - POINT_EPSILON) {
      segment = candidate;
      break;
    }
  }
  const local = Math.max(0, Math.min(
    1,
    (distance - segment.start) / segment.length,
  ));
  return {
    x: segment.from.x + (segment.to.x - segment.from.x) * local,
    y: segment.from.y + (segment.to.y - segment.from.y) * local,
    directionX: segment.directionX,
    directionY: segment.directionY,
    distance,
    progress: amount,
  };
}

export function dashArcLengthPath(path, {
  dashLength,
  gapLength,
  offset = 0,
}) {
  for (const [name, value] of Object.entries({ dashLength, gapLength })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`Flock path ${name} must be finite and positive.`);
    }
  }
  if (!Number.isFinite(offset)) {
    throw new RangeError("Flock path dash offset must be finite.");
  }

  const period = dashLength + gapLength;
  const phase = ((offset % period) + period) % period;
  const result = [];
  for (let dashStart = phase - period; dashStart < path.length; dashStart += period) {
    const visibleStart = Math.max(0, dashStart);
    const visibleEnd = Math.min(path.length, dashStart + dashLength);
    if (visibleEnd <= visibleStart + POINT_EPSILON) continue;
    for (const segment of path.segments) {
      const start = Math.max(visibleStart, segment.start);
      const end = Math.min(visibleEnd, segment.end);
      if (end <= start + POINT_EPSILON) continue;
      const fromProgress = (start - segment.start) / segment.length;
      const toProgress = (end - segment.start) / segment.length;
      result.push({
        from: {
          x: segment.from.x + (segment.to.x - segment.from.x) * fromProgress,
          y: segment.from.y + (segment.to.y - segment.from.y) * fromProgress,
        },
        to: {
          x: segment.from.x + (segment.to.x - segment.from.x) * toProgress,
          y: segment.from.y + (segment.to.y - segment.from.y) * toProgress,
        },
      });
    }
  }
  return result;
}
