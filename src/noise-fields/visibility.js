export function noiseVisibilityFill(value, layer) {
  if (!Number.isFinite(value)) {
    throw new TypeError("Noise visibility value must be finite.");
  }
  if (!layer || !Number.isFinite(layer.threshold) || !Number.isFinite(layer.softness)) {
    throw new TypeError("Noise visibility requires threshold and softness settings.");
  }
  if (layer.softness <= 1e-7) return Number(value >= layer.threshold);
  return Math.max(0, Math.min(1, (
    value - layer.threshold + layer.softness
  ) / (2 * layer.softness)));
}
