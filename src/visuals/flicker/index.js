import { FlickerModeRegistry } from "./flicker-mode-registry.js";
import { FlickerController } from "./flicker-controller.js";
import { NOISE_FLICKER_MODE } from "./noise-mode.js";
import { ECHO_RING_FLICKER_MODE } from "./echo-ring-mode.js";
import { STROBE_STACK_FLICKER_MODE } from "./strobe-stack-mode.js";
import { BLOCK_DROP_FLICKER_MODE } from "./block-drop-mode.js";
import { PRISM_BLOOM_FLICKER_MODE } from "./prism-bloom-mode.js";
import { CRT_GLIDE_FLICKER_MODE } from "./crt-glide-mode.js";
import { RADAR_ARC_FLICKER_MODE } from "./radar-arc-mode.js";
import {
  flickerSettingsFromOptions,
  resolveFlickerSettings,
} from "./flicker-settings.js";

// This is the only flicker mode catalog. Porting a new flickering direction
// means adding one mode module next to this file and registering it here;
// compositions keep referring to the stable `flicker.mode` string in config.
export const flickerModes = new FlickerModeRegistry()
  .register(NOISE_FLICKER_MODE)
  .register(ECHO_RING_FLICKER_MODE)
  .register(STROBE_STACK_FLICKER_MODE)
  .register(BLOCK_DROP_FLICKER_MODE)
  .register(PRISM_BLOOM_FLICKER_MODE)
  .register(CRT_GLIDE_FLICKER_MODE)
  .register(RADAR_ARC_FLICKER_MODE);

/** Resolve authored flicker settings against the registered modes. */
export function resolveFlicker(settings, modes = flickerModes, context = {}) {
  return resolveFlickerSettings(settings, modes, context);
}

/** Resolve the flicker block a generator's options carry, legacy shape included. */
export function resolveFlickerFromOptions(options, modes = flickerModes, context = {}) {
  return resolveFlickerSettings(flickerSettingsFromOptions(options), modes, context);
}

export function createFlicker({
  palette,
  settings,
  noiseFunction,
  grid,
  autoCycleSeconds = null,
  modes = flickerModes,
}) {
  return new FlickerController({
    palette,
    settings,
    modes,
    noiseFunction,
    grid,
    autoCycleSeconds,
  });
}

export { FlickerModeRegistry } from "./flicker-mode-registry.js";
export { FlickerController } from "./flicker-controller.js";
export { FlickerPalette } from "./flicker-palette.js";
export { valueNoise3D } from "./value-noise.js";
export {
  NOISE_FLICKER_DEFAULTS,
  NOISE_FLICKER_MODE,
  NoiseFlickerField,
} from "./noise-mode.js";
export {
  ECHO_RING_FLICKER_DEFAULTS,
  ECHO_RING_FLICKER_MODE,
  EchoRingFlickerField,
  echoRingIntensityAt,
} from "./echo-ring-mode.js";
export {
  STROBE_STACK_FLICKER_DEFAULTS,
  STROBE_STACK_FLICKER_MODE,
  StrobeStackFlickerField,
} from "./strobe-stack-mode.js";
export {
  BLOCK_DROP_FLICKER_DEFAULTS,
  BLOCK_DROP_FLICKER_MODE,
  BlockDropFlickerField,
} from "./block-drop-mode.js";
export {
  PRISM_BLOOM_FLICKER_DEFAULTS,
  PRISM_BLOOM_FLICKER_MODE,
  PrismBloomFlickerField,
} from "./prism-bloom-mode.js";
export {
  CRT_GLIDE_FLICKER_DEFAULTS,
  CRT_GLIDE_FLICKER_MODE,
  CrtGlideFlickerField,
} from "./crt-glide-mode.js";
export {
  RADAR_ARC_FLICKER_DEFAULTS,
  RADAR_ARC_FLICKER_MODE,
  RadarArcFlickerField,
} from "./radar-arc-mode.js";
export { FieldGeometry } from "./field-geometry.js";
export {
  FLICKER_DOTS_PER_CELL_AXIS,
  flickerPaletteIndicesAtCoordinates,
  flickerPaletteIndicesForCell,
} from "./cell-palette.js";
export {
  AUTO_FLICKER_CYCLE_SECONDS,
  DEFAULT_FLICKER_SETTINGS,
  FLICKER_SCOPES,
  LEGACY_FLICKER_KEYS,
  flickerSettingsFromOptions,
  isResolvedFlickerSettings,
  mergeFlickerSettings,
  resolveFlickerSettings,
} from "./flicker-settings.js";
