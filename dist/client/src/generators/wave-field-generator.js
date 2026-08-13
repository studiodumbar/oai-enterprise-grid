import { CircleGridSceneGenerator } from "./circle-grid-scene-generator.js";
import {
  DEFAULT_WAVE_FIELD_STRATEGY_OPTIONS,
  WAVE_FIELD_STRATEGIES,
  createWaveFieldSceneAt,
  minimumWaveFieldHoldFraction,
  validateWaveFieldStrategyOptions,
} from "./wave-field-strategies.js";

export {
  WAVE_FIELD_STRATEGIES,
  createWaveFieldSceneAt,
  minimumWaveFieldHoldFraction,
};

export const DEFAULT_WAVE_FIELD_OPTIONS = Object.freeze({
  cycleSeconds: 2.4,
  ...DEFAULT_WAVE_FIELD_STRATEGY_OPTIONS,
  longSideCells: 9,
  dotMargin: 0.1,
  palette: "green",
  flipSeconds: 0.04,
});

function normalizeWaveFieldOptions(options) {
  return {
    ...options,
    cycleSeconds: options.cycleSeconds ?? options.periodSeconds,
    stepCount: options.stepCount ?? options.samplesPerCycle,
  };
}

export const WAVE_FIELD_SPECIFICATION = Object.freeze({
  type: "wave-field",
  strategies: WAVE_FIELD_STRATEGIES,
  defaultStrategy: "ripple",
  defaults: DEFAULT_WAVE_FIELD_OPTIONS,
  normalizeOptions: normalizeWaveFieldOptions,
  validateOptions: validateWaveFieldStrategyOptions,
  minimumHoldFraction: minimumWaveFieldHoldFraction,
  createScene: createWaveFieldSceneAt,
});

export class WaveFieldGenerator extends CircleGridSceneGenerator {
  constructor(context) {
    super(context, WAVE_FIELD_SPECIFICATION);
  }
}

export default WaveFieldGenerator;
