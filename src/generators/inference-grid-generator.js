import { CircleGridSceneGenerator } from "./circle-grid-scene-generator.js";
import {
  INFERENCE_GRID_STRATEGIES,
  candidateFlickerAmountAt,
  createInferenceGridSceneAt,
} from "./grid-scene-strategies.js";
import {
  normalizeOrganicPaletteMotionOptions,
} from "../visuals/organic-palette-motion.js";

export const DEFAULT_INFERENCE_GRID_OPTIONS = Object.freeze({
  cycleSeconds: 2.4,
  stepCount: 7,
  longSideCells: 9,
  dotMargin: 0.14,
  palette: "thinking",
  flipSeconds: 0.04,
});

function validateInferenceOptions(options) {
  const requested = Math.max(3, Math.round(options.longSideCells));
  const resolvedLongSide = requested % 2 === 0 ? requested - 1 : requested;
  if (options.strategy === "tool-loop" && resolvedLongSide < 5) {
    throw new RangeError(
      "tool-loop requires at least 5 long-side cells for both fields and gutters.",
    );
  }
  if (options.strategy === "inference-loop" && options.candidateFlicker?.enabled) {
    candidateFlickerAmountAt({
      candidateIndex: 0,
      selectedIndex: 0,
      candidateCount: 64,
      progress: 0,
      leadFraction: options.candidateFlicker.leadFraction,
      spreadFraction: options.candidateFlicker.spreadFraction,
      rampFraction: options.candidateFlicker.rampFraction,
    });
  }
  if (options.strategy === "tool-loop" && options.highDensityFlicker) {
    normalizeOrganicPaletteMotionOptions(options.highDensityFlicker);
  }
  if (options.strategy === "context-window" && options.finalSnapshotFlicker) {
    normalizeOrganicPaletteMotionOptions(options.finalSnapshotFlicker);
  }
}

const INFERENCE_GRID_SPECIFICATION = Object.freeze({
  type: "inference-grid",
  strategies: INFERENCE_GRID_STRATEGIES,
  defaultStrategy: "inference-loop",
  defaults: DEFAULT_INFERENCE_GRID_OPTIONS,
  createScene: createInferenceGridSceneAt,
  validateOptions: validateInferenceOptions,
});

export class InferenceGridGenerator extends CircleGridSceneGenerator {
  constructor(context) {
    super(context, INFERENCE_GRID_SPECIFICATION);
  }
}

export default InferenceGridGenerator;
