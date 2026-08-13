import { CircleGridSceneGenerator } from "./circle-grid-scene-generator.js";
import {
  CELLULAR_AUTOMATA_STRATEGIES,
  createCellularAutomataSceneAt,
} from "./grid-scene-strategies.js";

export const DEFAULT_CELLULAR_AUTOMATA_OPTIONS = Object.freeze({
  cycleSeconds: 2.4,
  stepCount: 8,
  longSideCells: 9,
  dotMargin: 0.08,
  palette: "green",
  flipSeconds: 0.04,
  initialDensity: 0.34,
  birthNeighbors: [3],
  survivalNeighbors: [2, 3],
  wrapEdges: false,
});

function requireNeighborRule(value, label) {
  if (
    !Array.isArray(value)
    || value.some(count => !Number.isInteger(count) || count < 0 || count > 8)
    || new Set(value).size !== value.length
  ) {
    throw new RangeError(`${label} must contain unique neighbor counts from 0 to 8.`);
  }
}

function normalizeAutomataOptions(options) {
  return {
    ...options,
    cycleSeconds: options.cycleSeconds ?? options.tokenSeconds,
    stepCount: options.stepCount
      ?? options.generationsPerCycle
      ?? options.layerPasses,
  };
}

function validateAutomataOptions(options) {
  if (
    !Number.isFinite(options.initialDensity)
    || options.initialDensity <= 0
    || options.initialDensity >= 1
  ) {
    throw new RangeError("initialDensity must be between 0 and 1.");
  }
  requireNeighborRule(options.birthNeighbors, "birthNeighbors");
  requireNeighborRule(options.survivalNeighbors, "survivalNeighbors");
  if (typeof options.wrapEdges !== "boolean") {
    throw new TypeError("wrapEdges must be a boolean.");
  }
  const edgeFraction = options.flicker?.envelope?.edgeFraction ?? 0.18;
  if (!Number.isFinite(edgeFraction) || edgeFraction <= 0 || edgeFraction > 0.5) {
    throw new RangeError("flicker.envelope.edgeFraction must be between zero and 0.5.");
  }
}

const CELLULAR_AUTOMATA_SPECIFICATION = Object.freeze({
  type: "cellular-automata",
  strategies: CELLULAR_AUTOMATA_STRATEGIES,
  defaultStrategy: "life-like",
  defaults: DEFAULT_CELLULAR_AUTOMATA_OPTIONS,
  normalizeOptions: normalizeAutomataOptions,
  validateOptions: validateAutomataOptions,
  createScene: createCellularAutomataSceneAt,
});

export class CellularAutomataGenerator extends CircleGridSceneGenerator {
  constructor(context) {
    super(context, CELLULAR_AUTOMATA_SPECIFICATION);
  }
}

export default CellularAutomataGenerator;
