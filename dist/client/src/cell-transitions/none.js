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
import {
  createStatePlan,
  identityStatePresentation,
} from "./state-plan.js";

export const DEFAULT_NONE_CONFIG = Object.freeze({
  baseKind: "circle",
});

export class NoneTransition {
  constructor(config = {}, subdivisionPolicy = new FourLevelSubdivisionPolicy()) {
    this.config = { ...DEFAULT_NONE_CONFIG, ...config };
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
    output.reset({ roundness: roundnessForKind(this.config.baseKind) });
    return output;
  }

  updateCell(index, { energy }, cellState) {
    const output = resolveCellStateBuffer(cellState, this.buffer);
    const level = this.subdivisionPolicy.levelAt(energy);

    output.level[index] = level;
    output.roundness[index] = roundnessForKind(this.config.baseKind);
    output.scaleX[index] = 1;
    output.scaleY[index] = 1;
    output.rotation[index] = 0;
    output.offsetX[index] = 0;
    output.offsetY[index] = 0;
    output.opacity[index] = 1;
    return level;
  }

  createPlan(event) {
    return createStatePlan(event);
  }

  presentationAt() {
    return identityStatePresentation();
  }

  dispose() {
    // The grid owns buffers passed to resize(); do not invalidate shared state.
    this.buffer = new CellStateBuffer();
  }
}

export const NoneCellTransition = NoneTransition;

export function createNoneTransition(config, subdivisionPolicy) {
  return new NoneTransition(config, subdivisionPolicy);
}

export default NoneTransition;
