/**
 * Chooses the closest equivalent of an unoriented axis. Axis angles repeat
 * after PI, so this prevents a 179° → 1° measurement from reversing a visual
 * offset in a single frame.
 */
export function nearestEquivalentAxisRadians(axis, reference) {
  if (!Number.isFinite(axis)) return reference;
  if (!Number.isFinite(reference)) return axis;

  let difference = (axis - reference) % Math.PI;
  if (difference > Math.PI / 2) difference -= Math.PI;
  if (difference < -Math.PI / 2) difference += Math.PI;

  const continuous = reference + difference;
  const tau = Math.PI * 2;
  return ((continuous % tau) + tau) % tau;
}

export default nearestEquivalentAxisRadians;
