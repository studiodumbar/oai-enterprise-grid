import { debug } from "../debug/index.js";
import {
  LEGACY_NOISE_PARAM_DEFAULTS,
  normalizeLegacyNoiseParams,
} from "../noise-fields/legacy-noise-project.js";

// all it is is to import diogos sketches 

// The old sandbox stored one flat parameter bag. Current project snapshots
// keep settings under director/export, so these names identify data that must
// cross the one-way legacy boundary before it reaches the composition system.
export const DIOGONISATOR_SETTING_NAMES = Object.freeze([
  "sizeType", "sizeScale", "sizeSpeed", "sizeContrast", "sizeSeed",
  "colorType", "colorScale", "colorSpeed", "colorContrast", "colorSeed",
  "contrastType", "contrastScale", "contrastSpeed", "contrastContrast",
  "contrastSeed", "contrastInfluence", "colorHold",
  "maskType", "maskScale", "maskSpeed", "maskContrast", "maskSeed",
  "maskThreshold", "maskSoftness", "maskHold",
  "longCells", "frameMargin", "dotMargin",
  "animate", "animDur", "cascade", "smoothing", "emptyBelow",
  "hysteresis", "gamma", "invert", "colorSet", "bgColor", "debugGrid",
  "aspect", "resolution", "resW", "resH", "exportFormat", "fps", "duration",
]);

const SETTING_NAMES = new Set(DIOGONISATOR_SETTING_NAMES);

const LEGACY_PALETTES = Object.freeze({
  green: Object.freeze(["#003415", "#00692a", "#00a240", "#04b84c", "#40c977", "#8cdfad"]),
  blue: Object.freeze(["#013566", "#004f99", "#0169cc", "#0285ff", "#48aaff"]),
  orange: Object.freeze(["#b9480d", "#e25507", "#ff7417", "#ff8549", "#ff9e6c"]),
  pink: Object.freeze(["#963c67", "#ba437a", "#ff66ad", "#ffa3ce", "#ffd4e8"]),
  yellow: Object.freeze(["#9e5e00", "#c27d00", "#e3a000", "#ffc300", "#ffdb66"]),
  purple: Object.freeze(["#532d8d", "#6b3ab4", "#924ff7", "#ad7bf9", "#ceb0fb"]),
});

function parameterBag(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
    ? payload.params
    : null;
}

function detectedSettingNames(payload) {
  const params = parameterBag(payload);
  return params === null
    ? []
    : Object.keys(params).filter(name => SETTING_NAMES.has(name));
}

export function isDiogonisatorImport(payload) {
  const nativeProject = payload?.app === "circle-grid"
    && payload?.project === "circle-grid"
    && payload?.version === 1;
  return !nativeProject && detectedSettingNames(payload).length > 0;
}

export function diogoniseNoiseSettings(source = {}) {
  const p = normalizeLegacyNoiseParams({ ...LEGACY_NOISE_PARAM_DEFAULTS, ...source });
  return {
    longSideCells: p.longCells,
    frameMargin: p.frameMargin,
    dotMargin: p.dotMargin,
    palette: p.colorSet,
    paletteColors: [...(LEGACY_PALETTES[p.colorSet] ?? LEGACY_PALETTES.green)],
    backgroundColor: p.bgColor,
    backend: "auto",
    noiseFields: {
      levelCount: 5,
      dotMargin: p.dotMargin,
      layers: {
        size: {
          mode: p.sizeType, scale: p.sizeScale, contrast: p.sizeContrast,
          seed: p.sizeSeed, cyclesPerLoop: 0, speed: p.sizeSpeed,
          gamma: p.gamma, invert: p.invert, emptyBelow: p.emptyBelow,
        },
        color: {
          mode: p.colorType, scale: p.colorScale, contrast: p.colorContrast,
          seed: p.colorSeed, cyclesPerLoop: 0, speed: p.colorSpeed,
          holdSeconds: p.colorHold,
        },
        contrast: {
          mode: p.contrastType, scale: p.contrastScale, contrast: p.contrastContrast,
          seed: p.contrastSeed, cyclesPerLoop: 0, speed: p.contrastSpeed,
          influence: p.contrastInfluence,
        },
        visibility: {
          mode: p.maskType, scale: p.maskScale, contrast: p.maskContrast,
          seed: p.maskSeed, cyclesPerLoop: 0, speed: p.maskSpeed,
          holdSeconds: p.maskHold,
          threshold: p.maskThreshold, softness: p.maskSoftness,
        },
      },
    },
    levelTransition: {
      enabled: p.animate,
      durationSeconds: p.animDur,
      cascade: p.cascade,
      smoothing: p.smoothing,
      hysteresis: p.hysteresis,
    },
    debugGrid: p.debugGrid,
    durationSeconds: p.duration,
  };
}

export function diogoniseImport(payload, currentProject) {
  const detected = detectedSettingNames(payload);
  if (!isDiogonisatorImport(payload)) return null;
  const settings = diogoniseNoiseSettings(payload.params);
  const fps = Math.max(1, Math.min(120, Math.round(Number(payload.params.fps) || 30)));
  const time = Math.max(0, Number(payload.time) || 0);
  debug.export(
    "import-converter=diogonisator settings=%d composition=noise-grid",
    detected.length,
  );
  return {
    version: 1,
    director: {
      compositionId: "noise-grid",
      generators: {
        noiseGrid: {
          version: 3,
          settings,
          timeline: payload.timeline ?? { version: 1, tracks: {} },
          time,
        },
      },
    },
    export: {
      ...(currentProject?.export ?? {}),
      mode: payload.params.exportFormat === "png" ? "static" : "motion",
      exportFormat: payload.params.exportFormat === "pngseq"
        ? "png-sequence"
        : payload.params.exportFormat,
      aspect: payload.params.aspect,
      resolution: payload.params.resolution,
      resW: payload.params.resW,
      resH: payload.params.resH,
      fps,
    },
    ...(currentProject?.seed === undefined ? {} : { seed: currentProject.seed }),
    timeline: { time, frameIndex: Math.max(0, Math.round(time * fps)) },
  };
}
