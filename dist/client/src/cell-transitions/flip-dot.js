import {
  CellStateBuffer,
  resolveCellStateBuffer,
} from "./cell-state-buffer.js";
import {
  clampBrightness,
  FourLevelSubdivisionPolicy,
} from "../grid/subdivision-policy.js";
import {
  roundnessForKind,
} from "../shapes/rounded-rect.js";

const MAX_TRANSITION_WIDTH = 0.124;
const BOUNDARY_INTERVAL = 0.25;

export const DEFAULT_FLIP_DOT_CONFIG = Object.freeze({
  animate: true,
  baseKind: "circle",
  axisDegrees: 0,
  direction: 1,
  reverseLevelOrder: false,
  brightnessTransitionWidth: 0.1,
  foldCurve: Object.freeze([0.42, 0, 0.58, 1]),
  bounceCurve: Object.freeze([0.22, 0.72, 0.32, 1.18]),
  projectionPower: 1,
  liftInDots: 0.035,
  hideSkippedThresholds: true,
  quantizePalette: true,
  paletteValues: Object.freeze([0, 1 / 3, 2 / 3, 1]),
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function displayLevelFor(energyLevel, reverseLevelOrder) {
  return reverseLevelOrder ? 3 - energyLevel : energyLevel;
}

function cubicCoordinate(t, firstControl, secondControl) {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * firstControl
    + 3 * inverse * t * t * secondControl
    + t * t * t;
}

function cubicDerivative(t, firstControl, secondControl) {
  const inverse = 1 - t;
  return 3 * inverse * inverse * firstControl
    + 6 * inverse * t * (secondControl - firstControl)
    + 3 * t * t * (1 - secondControl);
}

export function normalizeBezierCurve(curve) {
  if (!Array.isArray(curve) || curve.length !== 4) {
    throw new TypeError("bounceCurve must be an array of four numbers.");
  }
  const values = curve.map(Number);
  if (!values.every(Number.isFinite)) {
    throw new TypeError("bounceCurve values must be finite numbers.");
  }
  if (values[0] < 0 || values[0] > 1 || values[2] < 0 || values[2] > 1) {
    throw new RangeError("bounceCurve X control points must be between 0 and 1.");
  }
  return values;
}

// CSS-style cubic-bezier evaluation: progress is X, so solve for the curve's
// parameter before sampling Y. Y is intentionally not clamped; the small
// overshoot is what gives the flip its soft mechanical bounce.
function cubicBezierAtNormalized(progress, curve) {
  const x = clamp01(Number(progress) || 0);
  const [x1, y1, x2, y2] = curve;
  if (x === 0 || x === 1) return x;
  let parameter = x;
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const difference = cubicCoordinate(parameter, x1, x2) - x;
    const derivative = cubicDerivative(parameter, x1, x2);
    if (Math.abs(difference) < 1e-7 || Math.abs(derivative) < 1e-7) break;
    parameter = clamp01(parameter - difference / derivative);
  }

  // Newton converges quickly for normal timing curves. Bisection makes the
  // evaluator deterministic even for unusually flat but valid X handles.
  if (Math.abs(cubicCoordinate(parameter, x1, x2) - x) > 1e-6) {
    let lower = 0;
    let upper = 1;
    for (let iteration = 0; iteration < 20; iteration += 1) {
      parameter = (lower + upper) * 0.5;
      if (cubicCoordinate(parameter, x1, x2) < x) lower = parameter;
      else upper = parameter;
    }
  }

  return cubicCoordinate(parameter, y1, y2);
}

export function cubicBezierAt(progress, curve = DEFAULT_FLIP_DOT_CONFIG.bounceCurve) {
  return cubicBezierAtNormalized(progress, normalizeBezierCurve(curve));
}

export function flipDotPoseAtPhase(
  phase,
  config = DEFAULT_FLIP_DOT_CONFIG,
  curveSampler = cubicBezierAt,
) {
  const normalizedPhase = clamp01(Number(phase) || 0);
  let angularPhase;
  if (normalizedPhase < 0.5) {
    const foldCurve = config.foldCurve ?? DEFAULT_FLIP_DOT_CONFIG.foldCurve;
    angularPhase = curveSampler(normalizedPhase * 2, foldCurve) * 0.5;
  } else {
    const bounceCurve = config.bounceCurve ?? DEFAULT_FLIP_DOT_CONFIG.bounceCurve;
    angularPhase = 0.5
      + curveSampler((normalizedPhase - 0.5) * 2, bounceCurve) * 0.5;
  }

  // Canvas has no X/Y-axis 3D rotation. The absolute cosine is its 2D
  // projection; callers swap faces only at the zero-width pose.
  const rawProjection = Math.abs(Math.cos(Math.PI * angularPhase));
  const projectionPower = Number(config.projectionPower)
    || DEFAULT_FLIP_DOT_CONFIG.projectionPower;
  const projection = rawProjection < 1e-12
    ? 0
    : rawProjection ** projectionPower;
  const direction = Number(config.direction) === -1 ? -1 : 1;
  const lift = direction * Math.sin(Math.PI * 2 * normalizedPhase);

  return {
    phase: normalizedPhase,
    angularPhase,
    projection,
    lift,
  };
}

export function flipDotStateAt(
  brightness,
  config = DEFAULT_FLIP_DOT_CONFIG,
  subdivisionPolicy = new FourLevelSubdivisionPolicy(),
  curveSampler = cubicBezierAt,
) {
  const value = clampBrightness(brightness);
  const energyLevel = subdivisionPolicy.levelAt(value);
  const reverseLevelOrder = config.reverseLevelOrder
    ?? DEFAULT_FLIP_DOT_CONFIG.reverseLevelOrder;
  const level = displayLevelFor(energyLevel, reverseLevelOrder);
  const width = Math.max(
    0,
    Math.min(MAX_TRANSITION_WIDTH, Number(config.brightnessTransitionWidth) || 0),
  );

  if (config.animate === false || width === 0) {
    return {
      level,
      energyLevel,
      boundary: null,
      phase: null,
      projection: 1,
      lift: 0,
    };
  }

  let boundaryLevel = null;
  let phase = null;
  const lowerBoundary = energyLevel * BOUNDARY_INTERVAL;
  const upperBoundary = (energyLevel + 1) * BOUNDARY_INTERVAL;

  if (energyLevel > 0 && value <= lowerBoundary + width) {
    boundaryLevel = energyLevel;
    phase = 0.5 + (value - lowerBoundary) / (2 * width);
  } else if (energyLevel < 3 && value >= upperBoundary - width) {
    boundaryLevel = energyLevel + 1;
    phase = (value - (upperBoundary - width)) / (2 * width);
  }

  if (phase === null) {
    return {
      level,
      energyLevel,
      boundary: null,
      phase: null,
      projection: 1,
      lift: 0,
    };
  }

  const pose = flipDotPoseAtPhase(phase, config, curveSampler);

  return {
    level,
    energyLevel,
    boundary: boundaryLevel * BOUNDARY_INTERVAL,
    ...pose,
  };
}

export class FlipDotTransition {
  constructor(config = {}, subdivisionPolicy = new FourLevelSubdivisionPolicy()) {
    this.config = { ...DEFAULT_FLIP_DOT_CONFIG, ...config };
    // Keep the former string axis as a compatibility alias for saved recipes.
    if (!Object.hasOwn(config, "axisDegrees") && Object.hasOwn(config, "axis")) {
      this.config.axisDegrees = config.axis === "auto"
        ? "auto"
        : config.axis === "vertical" ? 90 : 0;
    }
    this.config.foldCurve = normalizeBezierCurve(this.config.foldCurve);
    this.config.bounceCurve = normalizeBezierCurve(this.config.bounceCurve);
    if (
      this.config.foldCurve[1] < 0
      || this.config.foldCurve[1] > 1
      || this.config.foldCurve[3] < 0
      || this.config.foldCurve[3] > 1
    ) {
      throw new RangeError("flip-dot foldCurve Y control points must be between 0 and 1.");
    }
    if (
      this.config.bounceCurve[1] < 0
      || this.config.bounceCurve[1] > 2
      || this.config.bounceCurve[3] < 0
      || this.config.bounceCurve[3] > 2
    ) {
      throw new RangeError("flip-dot bounceCurve Y control points must be between 0 and 2.");
    }
    this.config.liftInDots = Number(this.config.liftInDots);
    if (!Number.isFinite(this.config.liftInDots) || this.config.liftInDots < 0) {
      throw new RangeError("flip-dot liftInDots must be a finite non-negative number.");
    }
    this.config.projectionPower = Number(this.config.projectionPower);
    if (!Number.isFinite(this.config.projectionPower) || this.config.projectionPower <= 0) {
      throw new RangeError("flip-dot projectionPower must be a finite positive number.");
    }
    this.config.direction = Number(this.config.direction);
    if (this.config.direction !== 1 && this.config.direction !== -1) {
      throw new RangeError("flip-dot direction must be 1 or -1.");
    }
    if (!Array.isArray(this.config.paletteValues) || this.config.paletteValues.length !== 4) {
      throw new TypeError("flip-dot paletteValues must contain four values.");
    }
    this.config.paletteValues = this.config.paletteValues.map(Number);
    if (
      !this.config.paletteValues.every(
        value => Number.isFinite(value) && value >= 0 && value <= 1,
      )
    ) {
      throw new RangeError("flip-dot paletteValues must all be between 0 and 1.");
    }
    const requestedAxis = this.config.axisDegrees;
    this.autoAxis = typeof requestedAxis === "string"
      && requestedAxis.trim().toLowerCase() === "auto";
    if (this.autoAxis) {
      this.config.axisDegrees = "auto";
      this.axisRadians = 0;
    } else {
      this.config.axisDegrees = Number(requestedAxis);
      if (!Number.isFinite(this.config.axisDegrees)) {
        throw new RangeError('flip-dot axisDegrees must be a finite number or "auto".');
      }
      this.axisRadians = this.config.axisDegrees * Math.PI / 180;
    }
    if (typeof this.config.reverseLevelOrder !== "boolean") {
      throw new TypeError("flip-dot reverseLevelOrder must be true or false.");
    }
    // Validate the shape kind immediately instead of failing during animation.
    roundnessForKind(this.config.baseKind);
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

  updateCell(index, { energy, previousEnergy, layout }, cellState, frame) {
    const output = resolveCellStateBuffer(cellState, this.buffer);
    let pose = flipDotStateAt(
      energy,
      this.config,
      this.subdivisionPolicy,
      cubicBezierAtNormalized,
    );
    const hasPreviousEnergy = Number.isFinite(previousEnergy);
    const previousEnergyLevel = hasPreviousEnergy
      ? this.subdivisionPolicy.levelAt(previousEnergy)
      : pose.energyLevel;
    if (
      this.config.animate !== false
      && this.config.hideSkippedThresholds !== false
      && hasPreviousEnergy
      && previousEnergyLevel !== pose.energyLevel
    ) {
      // A real frame can skip over the exact threshold. Force the crossing
      // frame edge-on so the subdivision and face-value swap always stays hidden.
      pose = {
        ...pose,
        boundary: Math.max(previousEnergyLevel, pose.energyLevel) * BOUNDARY_INTERVAL,
        phase: 0.5,
        angularPhase: 0.5,
        projection: 0,
        lift: 0,
        crossedBoundary: true,
      };
    }
    const subdivisions = 1 << pose.level;
    const dotSize = layout?.cellSize > 0 ? layout.cellSize / subdivisions : 0;
    const lift = pose.lift * dotSize * this.config.liftInDots;
    const axisRadians = this.autoAxis && Number.isFinite(frame?.motionAxisRadians)
      ? frame.motionAxisRadians
      : this.axisRadians;

    output.level[index] = pose.level;
    output.roundness[index] = roundnessForKind(this.config.baseKind);
    if (this.config.quantizePalette) {
      output.paletteValue[index] = this.config.paletteValues[pose.energyLevel];
    }
    output.glyphScaleY[index] = pose.projection;
    output.glyphScaleAxis[index] = axisRadians;
    output.glyphOffsetX[index] = -Math.sin(axisRadians) * lift;
    output.glyphOffsetY[index] = Math.cos(axisRadians) * lift;
    return pose;
  }

  dispose() {
    // The grid owns buffers passed to resize(); do not invalidate shared state.
    this.buffer = new CellStateBuffer();
  }
}

export const FlipDotCellTransition = FlipDotTransition;

export function createFlipDotTransition(config, subdivisionPolicy) {
  return new FlipDotTransition(config, subdivisionPolicy);
}

export default FlipDotTransition;
