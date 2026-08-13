import {
  CellStateBuffer,
  resolveCellStateBuffer,
} from "./cell-state-buffer.js";
import {
  FourLevelSubdivisionPolicy,
} from "../grid/subdivision-policy.js";
import {
  roundnessForKind,
} from "../shapes/rounded-rect.js";

export const AE_OUT = Object.freeze([0, 0.0062, 0.0272, 0.0674, 0.1348, 0.2447, 0.4366, 1]);
export const AE_IN = Object.freeze([0, 0.5386, 0.7443, 0.8602, 0.9305, 0.9721, 0.9936, 1]);

export const DEFAULT_SQUARIFY_CONFIG = Object.freeze({
  animate: true,
  brightnessTransitionWidth: 0.124,
  fromKind: "circle",
  toKind: "square",
});

export function sampleCurve(values, progress) {
  const value = Math.max(0, Math.min(1, progress)) * (values.length - 1);
  const index = Math.min(values.length - 2, Math.floor(value));
  return values[index] + (values[index + 1] - values[index]) * (value - index);
}

export function squarifyMixAt(brightness, level, config = DEFAULT_SQUARIFY_CONFIG) {
  if (!config.animate) return 0;

  const value = Math.max(0, Math.min(1, Number(brightness)));
  const width = Math.max(0, Math.min(0.124, Number(config.brightnessTransitionWidth)));
  if (width === 0) return 0;

  const lowerThreshold = level * 0.25;
  const upperThreshold = (level + 1) * 0.25;

  if (level > 0 && value < lowerThreshold + width) {
    const progress = (value - lowerThreshold) / width;
    return 1 - sampleCurve(AE_IN, progress);
  }
  if (level < 3 && value > upperThreshold - width) {
    const progress = (value - (upperThreshold - width)) / width;
    return sampleCurve(AE_OUT, progress);
  }
  return 0;
}

export class SquarifyTransition {
  constructor(config = {}, subdivisionPolicy = new FourLevelSubdivisionPolicy()) {
    this.config = { ...DEFAULT_SQUARIFY_CONFIG, ...config };
    this.subdivisionPolicy = subdivisionPolicy;
    this.buffer = new CellStateBuffer();
  }

  resize(length, cellState) {
    this.buffer = cellState ?? this.buffer;
    if (this.buffer.length !== length) this.buffer.resize(length);
    this.reset();
    return this.buffer;
  }

  reset(cellState) {
    const output = resolveCellStateBuffer(cellState, this.buffer);
    output.reset({ roundness: roundnessForKind(this.config.fromKind) });
    return output;
  }

  updateCell(index, { energy }, cellState) {
    const output = resolveCellStateBuffer(cellState, this.buffer);
    const level = this.subdivisionPolicy.levelAt(energy);
    const mix = squarifyMixAt(energy, level, this.config);
    const fromRoundness = roundnessForKind(this.config.fromKind);
    const toRoundness = roundnessForKind(this.config.toKind);

    output.level[index] = level;
    output.roundness[index] = fromRoundness + (toRoundness - fromRoundness) * mix;
    output.scaleX[index] = 1;
    output.scaleY[index] = 1;
    output.rotation[index] = 0;
    output.offsetX[index] = 0;
    output.offsetY[index] = 0;
    output.opacity[index] = 1;
    return level;
  }

  dispose() {
    // The grid owns buffers passed to resize(); do not invalidate shared state.
    this.buffer = new CellStateBuffer();
  }
}

export const SquarifyCellTransition = SquarifyTransition;

export function createSquarifyTransition(config, subdivisionPolicy) {
  return new SquarifyTransition(config, subdivisionPolicy);
}

export default SquarifyTransition;
