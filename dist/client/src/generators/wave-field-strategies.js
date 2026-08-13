import {
  EMPTY_GRID_FACE_LEVEL,
  GRID_FACE_PALETTE_STEP_COUNT,
  MAX_GRID_FACE_LEVEL,
} from "./grid-scene-strategies.js";

const TAU = Math.PI * 2;

export const WAVE_FIELD_STRATEGIES = Object.freeze([
  "ripple",
  "interference",
  "oscillation",
  "signal-propagation",
]);

export const DEFAULT_WAVE_FIELD_STRATEGY_OPTIONS = Object.freeze({
  stepCount: 8,
  wavelengthInCells: 3.6,
  whitespaceThreshold: 0.18,
  sourceCount: 2,
  signalWidthInCells: 0.9,
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function requireFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`);
  }
}

function requireLayout(layout) {
  if (
    !layout
    || !Number.isInteger(layout.columns)
    || layout.columns < 1
    || !Number.isInteger(layout.rows)
    || layout.rows < 1
  ) {
    throw new RangeError(
      "Wave-field layout must contain positive integer columns and rows.",
    );
  }
  return layout;
}

export function validateWaveFieldStrategyOptions(options) {
  if (
    !Number.isFinite(options.whitespaceThreshold)
    || options.whitespaceThreshold < 0
    || options.whitespaceThreshold >= 1
  ) {
    throw new RangeError("whitespaceThreshold must be between 0 and 1.");
  }
  if (options.strategy !== "signal-propagation") {
    requireFinitePositive(options.wavelengthInCells, "wavelengthInCells");
  }
  if (options.strategy === "interference") {
    if (
      !Number.isInteger(options.sourceCount)
      || options.sourceCount < 2
      || options.sourceCount > 8
    ) {
      throw new RangeError("sourceCount must be an integer between 2 and 8.");
    }
  }
  if (options.strategy === "signal-propagation") {
    requireFinitePositive(options.signalWidthInCells, "signalWidthInCells");
  }
}

export function minimumWaveFieldHoldFraction(strategy, stepCount) {
  if (!WAVE_FIELD_STRATEGIES.includes(strategy)) {
    throw new Error(
      `Unknown wave-field strategy "${strategy}". Available strategies: `
      + `${WAVE_FIELD_STRATEGIES.join(", ")}.`,
    );
  }
  if (!Number.isInteger(stepCount) || stepCount < 1) {
    throw new RangeError("stepCount must be a positive integer.");
  }
  return 1 / stepCount;
}

export function waveFieldStepAt(progress, stepCount) {
  if (!Number.isInteger(stepCount) || stepCount < 1) {
    throw new RangeError("stepCount must be a positive integer.");
  }
  return Math.min(
    stepCount - 1,
    Math.floor(clamp01(Number(progress) || 0) * stepCount),
  );
}

function hashUnit(first, second, third = 0) {
  let value = Math.imul((first | 0) ^ 0x9e3779b9, 0x85ebca6b);
  value ^= Math.imul((second | 0) ^ 0xc2b2ae35, 0x27d4eb2f);
  value ^= Math.imul((third | 0) ^ 0x165667b1, 0x9e3779b1);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function gridPointAt(layout, index) {
  return {
    column: index % layout.columns,
    row: Math.floor(index / layout.columns),
  };
}

function gridDistance(layout, firstIndex, secondIndex) {
  const first = gridPointAt(layout, firstIndex);
  const second = gridPointAt(layout, secondIndex);
  return Math.hypot(
    first.column - second.column,
    first.row - second.row,
  );
}

function deterministicSourceIndices(layout, cycleIndex, requestedCount, salt) {
  const cellCount = layout.columns * layout.rows;
  const count = Math.min(requestedCount, cellCount);
  const firstIndex = Math.min(
    cellCount - 1,
    Math.floor(hashUnit(cycleIndex, cellCount, salt) * cellCount),
  );
  const sources = [firstIndex];
  const selected = new Set(sources);

  while (sources.length < count) {
    let selectedIndex = -1;
    let selectedScore = -Infinity;
    for (let index = 0; index < cellCount; index += 1) {
      if (selected.has(index)) continue;
      const separation = Math.min(
        ...sources.map(sourceIndex => gridDistance(layout, index, sourceIndex)),
      );
      const score = separation + hashUnit(
        cycleIndex,
        index,
        salt + sources.length,
      ) * 0.05;
      if (score > selectedScore) {
        selectedScore = score;
        selectedIndex = index;
      }
    }
    sources.push(selectedIndex);
    selected.add(selectedIndex);
  }
  return sources;
}

function faceForSample(sample, role, whitespaceThreshold) {
  const value = clamp01(sample);
  if (value <= whitespaceThreshold) {
    return {
      level: EMPTY_GRID_FACE_LEVEL,
      paletteStep: 0,
      role: `${role}-whitespace`,
    };
  }
  const visibleValue = (value - whitespaceThreshold) / (1 - whitespaceThreshold);
  const level = Math.min(
    MAX_GRID_FACE_LEVEL,
    Math.floor(visibleValue * (MAX_GRID_FACE_LEVEL + 1)),
  );
  const paletteStep = Math.min(
    GRID_FACE_PALETTE_STEP_COUNT - 1,
    Math.floor(visibleValue * GRID_FACE_PALETTE_STEP_COUNT),
  );
  return { level, paletteStep, role };
}

function sampledFaces(layout, role, whitespaceThreshold, sampleAt) {
  return Array.from(
    { length: layout.columns * layout.rows },
    (_, index) => faceForSample(
      sampleAt(index, gridPointAt(layout, index)),
      role,
      whitespaceThreshold,
    ),
  );
}

function createRippleScene(input) {
  const {
    layout,
    cycleIndex,
    stepIndex,
    samplePhase,
    options,
  } = input;
  const [sourceIndex] = deterministicSourceIndices(layout, cycleIndex, 1, 1103);
  const faces = sampledFaces(
    layout,
    "ripple-band",
    options.whitespaceThreshold,
    index => {
      const distance = gridDistance(layout, sourceIndex, index);
      const angle = TAU * (distance / options.wavelengthInCells - samplePhase);
      return 0.5 + Math.cos(angle) * 0.5;
    },
  );
  return {
    key: `wave-field:ripple:${cycleIndex}:${stepIndex}`,
    phase: "sample",
    stepIndex,
    faces,
    strategy: "ripple",
    sourceIndex,
    samplePhase,
    wavelengthInCells: options.wavelengthInCells,
  };
}

function createInterferenceScene(input) {
  const {
    layout,
    cycleIndex,
    stepIndex,
    samplePhase,
    options,
  } = input;
  const sourceIndices = deterministicSourceIndices(
    layout,
    cycleIndex,
    options.sourceCount,
    1201,
  );
  const sourcePhases = sourceIndices.map(
    (sourceIndex, sourceOrder) => hashUnit(
      cycleIndex,
      sourceIndex,
      1213 + sourceOrder,
    ),
  );
  const faces = sampledFaces(
    layout,
    "interference-field",
    options.whitespaceThreshold,
    index => {
      let signedWave = 0;
      for (let sourceOrder = 0; sourceOrder < sourceIndices.length; sourceOrder += 1) {
        const distance = gridDistance(layout, sourceIndices[sourceOrder], index);
        const angle = TAU * (
          distance / options.wavelengthInCells
          - samplePhase
          + sourcePhases[sourceOrder]
        );
        signedWave += Math.cos(angle);
      }
      return Math.abs(signedWave / sourceIndices.length);
    },
  );
  return {
    key: `wave-field:interference:${cycleIndex}:${stepIndex}`,
    phase: "sample",
    stepIndex,
    faces,
    strategy: "interference",
    sourceIndices,
    requestedSourceCount: options.sourceCount,
    actualSourceCount: sourceIndices.length,
    samplePhase,
    wavelengthInCells: options.wavelengthInCells,
  };
}

function createOscillationScene(input) {
  const {
    layout,
    cycleIndex,
    stepIndex,
    samplePhase,
    options,
  } = input;
  const angleRadians = hashUnit(cycleIndex, 0, 1301) * Math.PI;
  const directionX = Math.cos(angleRadians);
  const directionY = Math.sin(angleRadians);
  const centerColumn = (layout.columns - 1) * 0.5;
  const centerRow = (layout.rows - 1) * 0.5;
  const faces = sampledFaces(
    layout,
    "oscillation-band",
    options.whitespaceThreshold,
    (index, point) => {
      const projection = (point.column - centerColumn) * directionX
        + (point.row - centerRow) * directionY;
      const angle = TAU * (projection / options.wavelengthInCells + samplePhase);
      return 0.5 + Math.sin(angle) * 0.5;
    },
  );
  return {
    key: `wave-field:oscillation:${cycleIndex}:${stepIndex}`,
    phase: "sample",
    stepIndex,
    faces,
    strategy: "oscillation",
    angleRadians,
    samplePhase,
    wavelengthInCells: options.wavelengthInCells,
  };
}

function maximumManhattanDistance(layout, sourceIndex) {
  const source = gridPointAt(layout, sourceIndex);
  const lastColumn = layout.columns - 1;
  const lastRow = layout.rows - 1;
  return Math.max(
    source.column + source.row,
    source.column + lastRow - source.row,
    lastColumn - source.column + source.row,
    lastColumn - source.column + lastRow - source.row,
  );
}

function createSignalPropagationScene(input) {
  const {
    layout,
    cycleIndex,
    stepIndex,
    options,
  } = input;
  const [sourceIndex] = deterministicSourceIndices(layout, cycleIndex, 1, 1409);
  const source = gridPointAt(layout, sourceIndex);
  const maximumRadius = maximumManhattanDistance(layout, sourceIndex);
  const frontierProgress = options.stepCount <= 1
    ? 0
    : stepIndex / (options.stepCount - 1);
  const frontierRadius = maximumRadius * frontierProgress;
  const faces = sampledFaces(
    layout,
    "signal-frontier",
    options.whitespaceThreshold,
    (index, point) => {
      const distance = Math.abs(point.column - source.column)
        + Math.abs(point.row - source.row);
      return clamp01(
        1 - Math.abs(distance - frontierRadius) / options.signalWidthInCells,
      );
    },
  );
  return {
    key: `wave-field:signal-propagation:${cycleIndex}:${stepIndex}`,
    phase: "sample",
    stepIndex,
    faces,
    strategy: "signal-propagation",
    sourceIndex,
    frontierProgress,
    frontierRadius,
    maximumRadius,
    signalWidthInCells: options.signalWidthInCells,
  };
}

const STRATEGY_FACTORIES = Object.freeze({
  ripple: createRippleScene,
  interference: createInterferenceScene,
  oscillation: createOscillationScene,
  "signal-propagation": createSignalPropagationScene,
});

export function createWaveFieldSceneAt({
  strategy,
  layout,
  cycleIndex = 0,
  progress = 0,
  options = {},
}) {
  const resolvedStrategy = strategy ?? options.strategy ?? "ripple";
  if (!WAVE_FIELD_STRATEGIES.includes(resolvedStrategy)) {
    throw new Error(
      `Unknown wave-field strategy "${resolvedStrategy}". Available strategies: `
      + `${WAVE_FIELD_STRATEGIES.join(", ")}.`,
    );
  }
  requireLayout(layout);
  const normalizedOptions = {
    ...DEFAULT_WAVE_FIELD_STRATEGY_OPTIONS,
    ...options,
    strategy: resolvedStrategy,
    stepCount: options.stepCount
      ?? options.samplesPerCycle
      ?? DEFAULT_WAVE_FIELD_STRATEGY_OPTIONS.stepCount,
  };
  if (!Number.isInteger(normalizedOptions.stepCount) || normalizedOptions.stepCount < 1) {
    throw new RangeError("stepCount must be a positive integer.");
  }
  validateWaveFieldStrategyOptions(normalizedOptions);
  const normalizedCycleIndex = Math.max(0, Math.floor(Number(cycleIndex) || 0));
  const stepIndex = waveFieldStepAt(progress, normalizedOptions.stepCount);
  const samplePhase = stepIndex / normalizedOptions.stepCount;
  return STRATEGY_FACTORIES[resolvedStrategy]({
    layout,
    cycleIndex: normalizedCycleIndex,
    stepIndex,
    samplePhase,
    options: normalizedOptions,
  });
}
