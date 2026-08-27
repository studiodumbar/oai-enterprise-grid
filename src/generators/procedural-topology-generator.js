import { CircleGridSceneGenerator } from "./circle-grid-scene-generator.js";
import {
  PROCEDURAL_TOPOLOGY_STRATEGIES,
  createProceduralTopologySceneAt,
} from "./grid-scene-strategies.js";

export const DEFAULT_PROCEDURAL_TOPOLOGY_OPTIONS = Object.freeze({
  cycleSeconds: 2.4,
  stepCount: 4,
  longSideCells: 9,
  dotMargin: 0.08,
  palette: "green",
  flipSeconds: 0.04,
  siteCount: 4,
  boundaryWhitespace: 0.18,
  targetCount: 6,
  explorationCount: 18,
  explorationStepCount: 2048,
  trailEnergyDiscount: 0.55,
  trailDecayBeats: 1.5,
  trailReuseBonusBeats: 0.5,
  proliferationDelayBeatsPerCell: 0.45,
  proliferationGlyphsPerBeat: 32,
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
  if (options.strategy === "mold") {
    if (
      !Number.isInteger(options.targetCount)
      || options.targetCount < 1
      || options.targetCount > 16
    ) {
      throw new RangeError("targetCount must be an integer between 1 and 16.");
    }
    if (
      !Number.isInteger(options.explorationCount)
      || options.explorationCount < options.targetCount
      || options.explorationCount > 64
    ) {
      throw new RangeError(
        "explorationCount must be an integer between targetCount and 64.",
      );
    }
    if (
      !Number.isInteger(options.explorationStepCount)
      || options.explorationStepCount < 2
      || options.explorationStepCount > 4096
    ) {
      throw new RangeError(
        "explorationStepCount must be an integer between 2 and 4096.",
      );
    }
    if (
      !Number.isFinite(options.trailEnergyDiscount)
      || options.trailEnergyDiscount < 0
      || options.trailEnergyDiscount > 1
    ) {
      throw new RangeError("trailEnergyDiscount must be between 0 and 1.");
    }
    if (
      !Number.isFinite(options.trailDecayBeats)
      || options.trailDecayBeats <= 0
      || options.trailDecayBeats > 16
    ) {
      throw new RangeError("trailDecayBeats must be between 0 and 16.");
    }
    if (
      !Number.isFinite(options.trailReuseBonusBeats)
      || options.trailReuseBonusBeats < 0
      || options.trailReuseBonusBeats > 8
    ) {
      throw new RangeError("trailReuseBonusBeats must be between 0 and 8.");
    }
    if (
      !Number.isFinite(options.proliferationDelayBeatsPerCell)
      || options.proliferationDelayBeatsPerCell <= 0
      || options.proliferationDelayBeatsPerCell > 2
    ) {
      throw new RangeError(
        "proliferationDelayBeatsPerCell must be between 0 and 2.",
      );
    }
    if (
      !Number.isFinite(options.proliferationGlyphsPerBeat)
      || options.proliferationGlyphsPerBeat <= 0
      || options.proliferationGlyphsPerBeat > 256
    ) {
      throw new RangeError(
        "proliferationGlyphsPerBeat must be between 0 and 256.",
      );
    }
    return;
  }
  if (options.strategy === "l-tree") {
    const envelope = options.flicker?.envelope ?? {};
    const edgeFraction = envelope.layerEdgeFraction ?? 0.2;
    if (!Number.isFinite(edgeFraction) || edgeFraction <= 0 || edgeFraction > 0.5) {
      throw new RangeError("layerEdgeFraction must be between zero and 0.5.");
    }
    const terminalRamp = envelope.terminalRampFraction ?? 0.24;
    if (!Number.isFinite(terminalRamp) || terminalRamp <= 0 || terminalRamp > 1) {
      throw new RangeError("terminalRampFraction must be between zero and one.");
    }
    return;
  }
  if (options.strategy !== "voronoi") return;
  if (
    !Number.isInteger(options.siteCount)
    || options.siteCount < 2
    || options.siteCount > 16
  ) {
    throw new RangeError("siteCount must be an integer between 2 and 16.");
  }
  // Above 0.7 the boundary swallows the territory interiors, leaving nothing
  // for the region-interior palette motion to animate.
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
