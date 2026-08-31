import {
  ASPECT_RATIO_PRESETS,
  LONG_EDGE_PRESETS,
  sizeFromAspect,
} from "./resolution.js";

export const EXPORT_MODES = Object.freeze({
  STATIC: "static",
  MOTION: "motion",
});

export const STATIC_EXPORT_FORMATS = Object.freeze(["png", "svg"]);
export const MOTION_EXPORT_FORMATS = Object.freeze(["mp4", "webm", "png-sequence"]);
export const MAX_EXPORT_DIMENSION = 16384;
export const MAX_EXPORT_FPS = 120;

export const EXPORT_STATE_DEFAULTS = Object.freeze({
  mode: EXPORT_MODES.MOTION,
  exportFormat: "mp4",
  aspect: "16:9",
  resolution: 1920,
  resW: 1920,
  resH: 1080,
  fps: 30,
  transparentBg: false,
  embedProjectState: true,
});

function boundedInteger(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

export function createExportState(overrides = {}) {
  if (
    Object.hasOwn(overrides, "aspect")
    && !ASPECT_RATIO_PRESETS.includes(overrides.aspect)
  ) {
    throw new RangeError(
      `Initial export aspect must be one of: ${ASPECT_RATIO_PRESETS.join(", ")}.`,
    );
  }
  const state = {
    ...EXPORT_STATE_DEFAULTS,
    ...overrides,
  };
  if (
    (Object.hasOwn(overrides, "aspect") || Object.hasOwn(overrides, "resolution"))
    && !Object.hasOwn(overrides, "resW")
    && !Object.hasOwn(overrides, "resH")
  ) {
    const size = sizeFromAspect(state.aspect, state.resolution);
    state.resW = size.width;
    state.resH = size.height;
  }
  normalizeExportState(state);
  return state;
}

export function allowedFormatsForMode(mode) {
  return mode === EXPORT_MODES.MOTION
    ? MOTION_EXPORT_FORMATS
    : STATIC_EXPORT_FORMATS;
}

export function normalizeExportState(state) {
  state.mode = state.mode === EXPORT_MODES.MOTION
    ? EXPORT_MODES.MOTION
    : EXPORT_MODES.STATIC;
  const allowed = allowedFormatsForMode(state.mode);
  if (!allowed.includes(state.exportFormat)) state.exportFormat = allowed[0];
  if (!ASPECT_RATIO_PRESETS.includes(state.aspect)) {
    state.aspect = EXPORT_STATE_DEFAULTS.aspect;
  }
  state.resW = boundedInteger(
    state.resW,
    EXPORT_STATE_DEFAULTS.resW,
    2,
    MAX_EXPORT_DIMENSION,
  );
  state.resH = boundedInteger(
    state.resH,
    EXPORT_STATE_DEFAULTS.resH,
    2,
    MAX_EXPORT_DIMENSION,
  );
  state.fps = boundedInteger(
    state.fps,
    EXPORT_STATE_DEFAULTS.fps,
    1,
    MAX_EXPORT_FPS,
  );
  const resolutionValues = Object.values(LONG_EDGE_PRESETS);
  state.resolution = resolutionValues.includes(Number(state.resolution))
    ? Number(state.resolution)
    : EXPORT_STATE_DEFAULTS.resolution;
  state.transparentBg = Boolean(state.transparentBg);
  state.embedProjectState = state.embedProjectState !== false;
  return state;
}

export function exportStateSnapshot(state) {
  const snapshot = {};
  for (const key of Object.keys(EXPORT_STATE_DEFAULTS)) snapshot[key] = state[key];
  return structuredClone(snapshot);
}

export function applyKnownExportState(state, saved) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return state;
  for (const key of Object.keys(EXPORT_STATE_DEFAULTS)) {
    if (Object.hasOwn(saved, key)) state[key] = saved[key];
  }
  return normalizeExportState(state);
}

export function formatVisibility(state) {
  const format = state.exportFormat;
  return {
    transparency: format === "png" || format === "png-sequence",
    fps: format === "mp4" || format === "webm" || format === "png-sequence",
    metadata: format !== "webm",
  };
}
