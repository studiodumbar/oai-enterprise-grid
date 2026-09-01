import { NoiseFieldModeRegistry } from "./noise-field-registry.js";
import { VALUE_NOISE_MODE } from "./value-mode.js";
import { VORONOI_NOISE_MODE } from "./voronoi-mode.js";
import { GRADIENT_NOISE_MODE } from "./gradient-mode.js";
import { SIMPLEX_NOISE_MODE } from "./simplex-mode.js";
import { LIFE_NOISE_MODE } from "./life-mode.js";
import { INK_SHARDS_MODE } from "./ink-shards-mode.js";

export function createNoiseFieldRegistry() {
  return new NoiseFieldModeRegistry()
    .register(VALUE_NOISE_MODE)
    .register(VORONOI_NOISE_MODE)
    .register(GRADIENT_NOISE_MODE)
    .register(SIMPLEX_NOISE_MODE)
    .register(INK_SHARDS_MODE)
    .register(LIFE_NOISE_MODE);
}

export { resolveNoiseFieldSettings } from "./noise-field-settings.js";
export { NoiseFieldSampler } from "./noise-field-sampler.js";
export { noiseVisibilityFill } from "./visibility.js";
