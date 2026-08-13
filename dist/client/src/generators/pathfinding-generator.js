import { CircleGridSceneGenerator } from "./circle-grid-scene-generator.js";
import {
  PATHFINDING_STRATEGIES,
  createPathfindingSceneAt,
  minimumPathfindingHoldFraction,
} from "./pathfinding-strategies.js";

export const DEFAULT_PATHFINDING_OPTIONS = Object.freeze({
  cycleSeconds: 3.2,
  stepCount: 12,
  longSideCells: 9,
  dotMargin: 0.1,
  palette: "green",
  flipSeconds: 0.04,
  obstacleDensity: 0.16,
  maximumTraversalCost: 4,
});

function normalizePathfindingOptions(options) {
  return {
    ...options,
    cycleSeconds: options.cycleSeconds ?? options.tokenSeconds,
    stepCount: options.stepCount
      ?? options.searchSteps
      ?? options.layerPasses,
    maximumTraversalCost: options.maximumTraversalCost
      ?? options.maxTraversalCost
      ?? DEFAULT_PATHFINDING_OPTIONS.maximumTraversalCost,
  };
}

function validateOptionalIndexArray(value, label) {
  if (
    value !== undefined
    && !Array.isArray(value)
    && !ArrayBuffer.isView(value)
  ) {
    throw new TypeError(`${label} must be an array or typed array.`);
  }
}

function validatePathfindingOptions(options) {
  if (
    !Number.isFinite(options.obstacleDensity)
    || options.obstacleDensity < 0
    || options.obstacleDensity >= 1
  ) {
    throw new RangeError("obstacleDensity must be between 0 (inclusive) and 1 (exclusive).");
  }
  if (
    !Number.isInteger(options.maximumTraversalCost)
    || options.maximumTraversalCost < 1
    || options.maximumTraversalCost > 64
  ) {
    throw new RangeError("maximumTraversalCost must be an integer between 1 and 64.");
  }
  for (const [label, index] of [
    ["startIndex", options.startIndex],
    ["goalIndex", options.goalIndex],
  ]) {
    if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
      throw new RangeError(`${label} must be a non-negative integer when provided.`);
    }
  }
  validateOptionalIndexArray(options.blockedIndices, "blockedIndices");
  validateOptionalIndexArray(options.traversalCosts, "traversalCosts");
}

export const PATHFINDING_SPECIFICATION = Object.freeze({
  type: "pathfinding",
  strategies: PATHFINDING_STRATEGIES,
  defaultStrategy: "bfs",
  defaults: DEFAULT_PATHFINDING_OPTIONS,
  normalizeOptions: normalizePathfindingOptions,
  validateOptions: validatePathfindingOptions,
  minimumHoldFraction: minimumPathfindingHoldFraction,
  createScene: createPathfindingSceneAt,
});

export class PathfindingGenerator extends CircleGridSceneGenerator {
  constructor(context) {
    super(context, PATHFINDING_SPECIFICATION);
  }
}

export default PathfindingGenerator;
