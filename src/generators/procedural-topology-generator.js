import { CircleGridSceneGenerator } from "./circle-grid-scene-generator.js";
import {
  PROCEDURAL_TOPOLOGY_STRATEGIES,
  createProceduralTopologySceneAt,
} from "./grid-scene-strategies.js";
import { normalizeOrganicPaletteMotionOptions } from "../visuals/organic-palette-motion.js";

export const DEFAULT_PROCEDURAL_TOPOLOGY_OPTIONS = Object.freeze({
  cycleSeconds: 2.4,
  stepCount: 4,
  longSideCells: 9,
  dotMargin: 0.08,
  palette: "green",
  flipSeconds: 0.04,
  siteCount: 4,
  boundaryWhitespace: 0.18,
});

function normalizeProceduralOptions(options) {
  const strategy = options.strategy;
  return {
    ...options,
    cycleSeconds: options.cycleSeconds ?? options.tokenSeconds,
    stepCount: options.stepCount
      ?? (strategy === "voronoi" ? options.partitionPasses : options.generations)
      ?? options.layerPasses,
  };
}

function validateProceduralOptions(options) {
  if (options.strategy === "l-tree" && options.layerFlicker) {
    normalizeOrganicPaletteMotionOptions(options.layerFlicker);
    const edgeFraction = options.layerFlicker.layerEdgeFraction ?? 0.2;
    if (!Number.isFinite(edgeFraction) || edgeFraction <= 0 || edgeFraction > 0.5) {
      throw new RangeError("layerEdgeFraction must be between zero and 0.5.");
    }
    const terminalRamp = options.layerFlicker.terminalRampFraction ?? 0.24;
    if (!Number.isFinite(terminalRamp) || terminalRamp <= 0 || terminalRamp > 1) {
      throw new RangeError("terminalRampFraction must be between zero and one.");
    }
    return;
  }
  if (options.strategy !== "voronoi") return;
  if (options.regionFlicker) {
    normalizeOrganicPaletteMotionOptions(options.regionFlicker);
  }
  if (
    !Number.isInteger(options.siteCount)
    || options.siteCount < 2
    || options.siteCount > 8
  ) {
    throw new RangeError("siteCount must be an integer between 2 and 8.");
  }
  if (
    !Number.isFinite(options.boundaryWhitespace)
    || options.boundaryWhitespace < 0
    || options.boundaryWhitespace >= 0.7
  ) {
    throw new RangeError("boundaryWhitespace must be between 0 and 0.7.");
  }
}

const PROCEDURAL_TOPOLOGY_SPECIFICATION = Object.freeze({
  type: "procedural-topology",
  strategies: PROCEDURAL_TOPOLOGY_STRATEGIES,
  defaultStrategy: "voronoi",
  defaults: DEFAULT_PROCEDURAL_TOPOLOGY_OPTIONS,
  normalizeOptions: normalizeProceduralOptions,
  validateOptions: validateProceduralOptions,
  createScene: createProceduralTopologySceneAt,
});

export class ProceduralTopologyGenerator extends CircleGridSceneGenerator {
  constructor(context) {
    super(context, PROCEDURAL_TOPOLOGY_SPECIFICATION);
  }
}

export default ProceduralTopologyGenerator;
