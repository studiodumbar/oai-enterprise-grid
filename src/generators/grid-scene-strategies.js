// Pure, deterministic scene strategies. Registered generator wrappers select
// only the strategies owned by their engine; this module has no lifecycle,
// rendering, or catalog registration responsibility.
export const EMPTY_GRID_FACE_LEVEL = -1;
export const MAX_GRID_FACE_LEVEL = 3;
export const GRID_FACE_PALETTE_STEP_COUNT = 4;

export const INFERENCE_GRID_STRATEGIES = Object.freeze([
  "inference-loop",
  "context-window",
  "tool-loop",
]);

export const PROCEDURAL_TOPOLOGY_STRATEGIES = Object.freeze([
  "voronoi",
  "l-tree",
]);

export const CELLULAR_AUTOMATA_STRATEGIES = Object.freeze([
  "life-like",
]);

export const GRID_SCENE_STRATEGIES = Object.freeze([
  ...INFERENCE_GRID_STRATEGIES,
  ...PROCEDURAL_TOPOLOGY_STRATEGIES,
  ...CELLULAR_AUTOMATA_STRATEGIES,
]);

export const INFERENCE_LOOP_PHASES = Object.freeze({
  parallelEnd: 0.64,
  candidatesEnd: 0.78,
  selectionEnd: 0.84,
  commitEnd: 0.91,
  echoEnd: 0.96,
});

export const CONTEXT_WINDOW_PHASES = Object.freeze({
  attentionEnd: 0.52,
  readoutEnd: 0.66,
  commitEnd: 0.77,
});

export const TOOL_LOOP_PHASES = Object.freeze({
  perceiveEnd: 0.08,
  inferEnd: 0.3,
  actionEnd: 0.38,
  waitEnd: 0.66,
  observationEnd: 0.75,
  assimilateEnd: 0.91,
});

export const VORONOI_PHASES = Object.freeze({
  partitionEnd: 0.6,
  consensusEnd: 0.76,
  commitEnd: 0.9,
});

export const L_TREE_PHASES = Object.freeze({
  growEnd: 0.58,
  pruneEnd: 0.78,
  commitEnd: 0.9,
});

const TAU = Math.PI * 2;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value) {
  const amount = clamp01(value);
  return amount * amount * (3 - 2 * amount);
}

function clampPaletteStep(value) {
  return Math.max(
    0,
    Math.min(GRID_FACE_PALETTE_STEP_COUNT - 1, Math.round(value)),
  );
}

export function hashUnit(first, second, third = 0) {
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

function makeFace(level, paletteStep, role, detail) {
  return {
    level,
    paletteStep: clampPaletteStep(paletteStep),
    role,
    ...(detail ? { detail } : {}),
  };
}

export function emptyGridFace(role = "whitespace") {
  return makeFace(EMPTY_GRID_FACE_LEVEL, 0, role);
}

function faceArray(layout, role = "whitespace") {
  return Array.from(
    { length: layout.columns * layout.rows },
    () => emptyGridFace(role),
  );
}

export function gridFaceSignature(face) {
  if (!face || face.level === EMPTY_GRID_FACE_LEVEL) return "empty";
  const detail = face.detail;
  const detailKey = detail
    ? [
      detail.kind,
      detail.stage,
      detail.seed,
      detail.selectedIndex,
      Array.isArray(detail.visibleGlyphIndices)
        ? detail.visibleGlyphIndices.join(",")
        : "",
    ].join(":")
    : "";
  return [face.level, face.paletteStep, face.role, detailKey].join("|");
}

export const emptyThinkingFace = emptyGridFace;
function rankedIndices(indices, seed, salt) {
  return [...indices].sort((first, second) => (
    hashUnit(seed, first, salt) - hashUnit(seed, second, salt)
    || first - second
  ));
}

function exactWhitespaceSet(indices, ratio, seed, salt, protectedIndices = []) {
  const protectedSet = new Set(protectedIndices);
  const eligible = indices.filter(index => !protectedSet.has(index));
  const requested = Math.round(clamp01(ratio) * eligible.length);
  const blankCount = eligible.length > 1
    ? Math.max(1, Math.min(eligible.length - 1, requested))
    : 0;
  return new Set(rankedIndices(eligible, seed, salt).slice(0, blankCount));
}

function sparseFeatureFaces({
  faces,
  indices,
  whitespaceRatio,
  seed,
  role,
  protectedIndices = [],
  maximumLevel = MAX_GRID_FACE_LEVEL,
  paletteFloor = 1,
}) {
  const blanks = exactWhitespaceSet(
    indices,
    whitespaceRatio,
    seed,
    401,
    protectedIndices,
  );
  for (const index of indices) {
    if (blanks.has(index)) {
      faces[index] = emptyThinkingFace(`${role}-below-threshold`);
      continue;
    }
    const density = hashUnit(seed, index, 409);
    const level = Math.min(
      maximumLevel,
      Math.floor(density * (maximumLevel + 1)),
    );
    const paletteStep = paletteFloor + Math.floor(
      hashUnit(seed, index, 419)
      * (GRID_FACE_PALETTE_STEP_COUNT - paletteFloor),
    );
    faces[index] = makeFace(level, paletteStep, role);
  }
  return blanks;
}

export function inferenceLoopPhaseAt(progress) {
  const value = clamp01(progress);
  if (value < INFERENCE_LOOP_PHASES.parallelEnd) return "parallel";
  if (value < INFERENCE_LOOP_PHASES.candidatesEnd) return "candidates";
  if (value < INFERENCE_LOOP_PHASES.selectionEnd) return "selection";
  if (value < INFERENCE_LOOP_PHASES.commitEnd) return "commit";
  return "append";
}

export function contextWindowPhaseAt(progress) {
  const value = clamp01(progress);
  if (value < CONTEXT_WINDOW_PHASES.attentionEnd) return "attention";
  if (value < CONTEXT_WINDOW_PHASES.readoutEnd) return "readout";
  if (value < CONTEXT_WINDOW_PHASES.commitEnd) return "commit";
  return "quiet";
}

export function toolLoopPhaseAt(progress) {
  const value = clamp01(progress);
  if (value < TOOL_LOOP_PHASES.perceiveEnd) return "perceive";
  if (value < TOOL_LOOP_PHASES.inferEnd) return "infer";
  if (value < TOOL_LOOP_PHASES.actionEnd) return "action";
  if (value < TOOL_LOOP_PHASES.waitEnd) return "wait";
  if (value < TOOL_LOOP_PHASES.observationEnd) return "observation";
  if (value < TOOL_LOOP_PHASES.assimilateEnd) return "assimilate";
  return "route";
}

export function voronoiPhaseAt(progress) {
  const value = clamp01(progress);
  if (value < VORONOI_PHASES.partitionEnd) return "partition";
  if (value < VORONOI_PHASES.consensusEnd) return "consensus";
  if (value < VORONOI_PHASES.commitEnd) return "commit";
  return "settle";
}

export function lTreePhaseAt(progress) {
  const value = clamp01(progress);
  if (value < L_TREE_PHASES.growEnd) return "grow";
  if (value < L_TREE_PHASES.pruneEnd) return "prune";
  if (value < L_TREE_PHASES.commitEnd) return "commit";
  return "settle";
}

export function minimumSceneHoldFraction(strategy, layerPasses) {
  if (strategy === "inference-loop") {
    return Math.min(
      INFERENCE_LOOP_PHASES.parallelEnd / layerPasses,
      INFERENCE_LOOP_PHASES.candidatesEnd
        - INFERENCE_LOOP_PHASES.parallelEnd,
      INFERENCE_LOOP_PHASES.selectionEnd
        - INFERENCE_LOOP_PHASES.candidatesEnd,
      INFERENCE_LOOP_PHASES.commitEnd
        - INFERENCE_LOOP_PHASES.selectionEnd,
      INFERENCE_LOOP_PHASES.echoEnd
        - INFERENCE_LOOP_PHASES.commitEnd,
      1 - INFERENCE_LOOP_PHASES.echoEnd,
    );
  }
  if (strategy === "context-window") {
    return Math.min(
      CONTEXT_WINDOW_PHASES.attentionEnd / layerPasses,
      CONTEXT_WINDOW_PHASES.readoutEnd - CONTEXT_WINDOW_PHASES.attentionEnd,
      CONTEXT_WINDOW_PHASES.commitEnd - CONTEXT_WINDOW_PHASES.readoutEnd,
    );
  }
  if (strategy === "tool-loop") {
    return Math.min(
      TOOL_LOOP_PHASES.perceiveEnd,
      (TOOL_LOOP_PHASES.inferEnd - TOOL_LOOP_PHASES.perceiveEnd)
        / layerPasses,
      TOOL_LOOP_PHASES.actionEnd - TOOL_LOOP_PHASES.inferEnd,
      TOOL_LOOP_PHASES.observationEnd - TOOL_LOOP_PHASES.waitEnd,
      (TOOL_LOOP_PHASES.assimilateEnd - TOOL_LOOP_PHASES.observationEnd) / 2,
    );
  }
  if (strategy === "voronoi") {
    return Math.min(
      VORONOI_PHASES.partitionEnd / layerPasses,
      VORONOI_PHASES.consensusEnd - VORONOI_PHASES.partitionEnd,
      VORONOI_PHASES.commitEnd - VORONOI_PHASES.consensusEnd,
      1 - VORONOI_PHASES.commitEnd,
    );
  }
  if (strategy === "l-tree") {
    return Math.min(
      L_TREE_PHASES.growEnd / layerPasses,
      (L_TREE_PHASES.pruneEnd - L_TREE_PHASES.growEnd) / 2,
      L_TREE_PHASES.commitEnd - L_TREE_PHASES.pruneEnd,
      1 - L_TREE_PHASES.commitEnd,
    );
  }
  if (strategy === "life-like") {
    return 1 / layerPasses;
  }
  throw new Error(`Unknown grid scene strategy "${strategy}".`);
}

export function candidateDistributionAt(cycleIndex, candidateCount = 64) {
  if (!Number.isInteger(candidateCount) || candidateCount < 2) {
    throw new RangeError("candidateCount must be an integer of at least 2.");
  }
  const logits = Array.from(
    { length: candidateCount },
    (_, candidateIndex) => (
      (hashUnit(cycleIndex, candidateIndex, 97) - 0.5) * 7
    ),
  );
  const maxLogit = Math.max(...logits);
  const unnormalized = logits.map(logit => Math.exp(logit - maxLogit));
  const total = unnormalized.reduce((sum, value) => sum + value, 0);
  const probabilities = unnormalized.map(value => value / total);
  const selector = hashUnit(cycleIndex, candidateCount, 151);
  let selectedIndex = candidateCount - 1;
  let cumulative = 0;
  for (let index = 0; index < candidateCount; index += 1) {
    cumulative += probabilities[index];
    if (selector <= cumulative) {
      selectedIndex = index;
      break;
    }
  }
  return { logits, probabilities, selectedIndex };
}

export function candidateFlickerAmountAt({
  candidateIndex,
  selectedIndex,
  candidateCount = 64,
  progress,
  leadFraction = 0.18,
  spreadFraction = 0.6,
  rampFraction = 0.22,
}) {
  if (!Number.isInteger(candidateCount) || candidateCount < 2) {
    throw new RangeError("candidateCount must be an integer of at least 2.");
  }
  for (const [label, index] of [
    ["candidateIndex", candidateIndex],
    ["selectedIndex", selectedIndex],
  ]) {
    if (!Number.isInteger(index) || index < 0 || index >= candidateCount) {
      throw new RangeError(`${label} must address the candidate distribution.`);
    }
  }
  for (const [label, value] of [
    ["leadFraction", leadFraction],
    ["spreadFraction", spreadFraction],
    ["rampFraction", rampFraction],
  ]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`${label} must be between zero and one.`);
    }
  }
  if (leadFraction + spreadFraction + rampFraction > 1 + Number.EPSILON) {
    throw new RangeError(
      "leadFraction, spreadFraction, and rampFraction must total at most one.",
    );
  }
  if (!Number.isFinite(progress)) {
    throw new TypeError("progress must be finite.");
  }

  const columnCount = Math.ceil(Math.sqrt(candidateCount));
  const rowCount = Math.ceil(candidateCount / columnCount);
  const selectedColumn = selectedIndex % columnCount;
  const selectedRow = Math.floor(selectedIndex / columnCount);
  const candidateColumn = candidateIndex % columnCount;
  const candidateRow = Math.floor(candidateIndex / columnCount);
  const maximumDistance = Math.max(
    Number.EPSILON,
    Math.hypot(
      Math.max(selectedColumn, columnCount - 1 - selectedColumn),
      Math.max(selectedRow, rowCount - 1 - selectedRow),
    ),
  );
  const distance = Math.hypot(
    candidateColumn - selectedColumn,
    candidateRow - selectedRow,
  ) / maximumDistance;
  const onset = candidateIndex === selectedIndex
    ? 0
    : leadFraction + distance * spreadFraction;
  const value = clamp01((progress - onset) / Math.max(
    Number.EPSILON,
    rampFraction,
  ));
  return value * value * (3 - 2 * value);
}

export function candidatePaletteValueAt(
  cycleIndex,
  candidateIndex,
  candidateCount = 64,
) {
  if (
    !Number.isInteger(candidateIndex)
    || candidateIndex < 0
    || candidateIndex >= candidateCount
  ) {
    throw new RangeError("candidateIndex must address the candidate distribution.");
  }
  const { probabilities } = candidateDistributionAt(cycleIndex, candidateCount);
  const maximum = Math.max(...probabilities);
  const relativeProbability = probabilities[candidateIndex] / maximum;
  return 0.14 + Math.pow(relativeProbability, 0.58) * 0.82;
}

export function inferenceWhitespaceRatioAt(cycleIndex, layerIndex) {
  const step = Math.floor(hashUnit(cycleIndex, layerIndex, 503) * 6);
  return 0.12 + step * 0.11;
}

function inferencePassFaces(layout, cycleIndex, layerIndex) {
  const faces = faceArray(layout);
  const indices = faces.map((_, index) => index);
  const readoutIndex = layout.readoutIndex;
  sparseFeatureFaces({
    faces,
    indices,
    whitespaceRatio: inferenceWhitespaceRatioAt(cycleIndex, layerIndex),
    seed: cycleIndex * 37 + layerIndex,
    role: "distributed-feature",
    protectedIndices: [readoutIndex],
  });
  const anchorDensity = hashUnit(cycleIndex, layerIndex, 521);
  faces[readoutIndex] = makeFace(
    Math.min(MAX_GRID_FACE_LEVEL, Math.floor(anchorDensity * 4)),
    1 + Math.floor(
      hashUnit(cycleIndex, layerIndex, 523)
      * (GRID_FACE_PALETTE_STEP_COUNT - 1),
    ),
    "distributed-readout",
  );
  return faces;
}

function dimInferenceContext(faces, readoutIndex) {
  return faces.map((face, index) => {
    if (index === readoutIndex || face.level < 0) return face;
    return makeFace(face.level, Math.min(2, face.paletteStep), face.role);
  });
}

// Inference-grid strategies -------------------------------------------------

function createInferenceLoopScene({ layout, cycleIndex, progress, options }) {
  const phase = inferenceLoopPhaseAt(progress);
  const layerPasses = options.layerPasses;
  if (phase === "parallel") {
    const position = progress / INFERENCE_LOOP_PHASES.parallelEnd * layerPasses;
    const stepIndex = Math.min(layerPasses - 1, Math.floor(position));
    const faces = inferencePassFaces(layout, cycleIndex, stepIndex);
    return {
      key: `inference:${cycleIndex}:parallel:${stepIndex}`,
      phase,
      stepIndex,
      faces,
      readoutIndex: layout.readoutIndex,
      whitespaceRatio: inferenceWhitespaceRatioAt(cycleIndex, stepIndex),
      toolEnabled: false,
    };
  }

  const finalPass = inferencePassFaces(layout, cycleIndex, layerPasses - 1);
  const faces = dimInferenceContext(finalPass, layout.readoutIndex);
  const candidateCount = 1 << (MAX_GRID_FACE_LEVEL * 2);
  const distribution = candidateDistributionAt(cycleIndex, candidateCount);
  const candidatePaletteMotion = options.flicker?.enabled === true
    ? {
      kind: "candidate-follow",
      candidateCount,
      selectedIndex: distribution.selectedIndex,
      startProgress: INFERENCE_LOOP_PHASES.parallelEnd,
      endProgress: INFERENCE_LOOP_PHASES.selectionEnd,
      leadFraction: options.flicker.envelope?.leadFraction ?? 0.18,
      spreadFraction: options.flicker.envelope?.spreadFraction ?? 0.6,
      rampFraction: options.flicker.envelope?.rampFraction ?? 0.22,
    }
    : null;
  if (phase === "candidates" || phase === "selection") {
    const maximumProbability = Math.max(...distribution.probabilities);
    const paletteSteps = distribution.probabilities.map((probability, index) => {
      if (phase === "selection") {
        return index === distribution.selectedIndex
          ? GRID_FACE_PALETTE_STEP_COUNT - 1
          : 0;
      }
      const relative = probability / maximumProbability;
      return Math.min(
        GRID_FACE_PALETTE_STEP_COUNT - 1,
        Math.floor(relative * GRID_FACE_PALETTE_STEP_COUNT),
      );
    });
    faces[layout.readoutIndex] = makeFace(
      MAX_GRID_FACE_LEVEL,
      GRID_FACE_PALETTE_STEP_COUNT - 1,
      "next-token-distribution",
      {
        kind: "per-glyph-palette",
        stage: phase === "selection" ? "selected" : "scores",
        seed: cycleIndex,
        paletteSteps,
        probabilities: distribution.probabilities,
        selectedIndex: distribution.selectedIndex,
        ...(candidatePaletteMotion
          ? { paletteMotion: candidatePaletteMotion }
          : {}),
      },
    );
  } else {
    faces[layout.readoutIndex] = makeFace(
      0,
      GRID_FACE_PALETTE_STEP_COUNT - 1,
      "committed-token",
    );
  }

  const appendBeat = phase === "append"
    ? (progress < INFERENCE_LOOP_PHASES.echoEnd ? "echo" : "settle")
    : phase;
  if (appendBeat === "echo") {
    for (let index = 0; index < faces.length; index += 1) {
      if (index === layout.readoutIndex || faces[index].level < 0) continue;
      faces[index] = makeFace(
        faces[index].level,
        Math.max(3, faces[index].paletteStep),
        "cache-append-echo",
      );
    }
  }
  return {
    key: `inference:${cycleIndex}:${appendBeat}`,
    phase,
    stepIndex: layerPasses - 1,
    faces,
    readoutIndex: layout.readoutIndex,
    selectedCandidate: distribution.selectedIndex,
    probabilities: distribution.probabilities,
    toolEnabled: false,
  };
}

function indexColumn(layout, index) {
  return index % layout.columns;
}

function indexRow(layout, index) {
  return Math.floor(index / layout.columns);
}

export function contextWindowAttentionAt({
  cacheIndices,
  cycleIndex,
  snapshotIndex,
}) {
  if (!Array.isArray(cacheIndices) || cacheIndices.length < 1) {
    throw new RangeError("Context-window attention needs at least one cache cell.");
  }
  if (cacheIndices.length === 1) {
    return { attendedIndices: [cacheIndices[0]], weights: [1] };
  }
  const ranked = rankedIndices(
    cacheIndices,
    cycleIndex * 31 + snapshotIndex,
    607,
  );
  const share = 0.24 + hashUnit(cycleIndex, snapshotIndex, 613) * 0.28;
  const attendedCount = Math.max(
    1,
    Math.min(cacheIndices.length - 1, Math.round(cacheIndices.length * share)),
  );
  const attendedIndices = ranked.slice(0, attendedCount);
  const rawWeights = attendedIndices.map(
    index => 0.05 + Math.pow(hashUnit(cycleIndex + snapshotIndex, index, 617), 2),
  );
  const total = rawWeights.reduce((sum, value) => sum + value, 0);
  const weights = rawWeights.map(value => value / total);
  return { attendedIndices, weights };
}

function createContextWindowScene({ layout, cycleIndex, progress, options }) {
  const phase = contextWindowPhaseAt(progress);
  const frontierAxis = layout.columns >= layout.rows ? "column" : "row";
  const positionCount = frontierAxis === "column" ? layout.columns : layout.rows;
  const positionSpan = Math.max(1, positionCount - 1);
  const offset = Math.max(1, Math.floor(positionCount * 0.38));
  const frontierPosition = 1 + ((cycleIndex + offset - 1) % positionSpan);
  const middleRow = Math.floor(layout.rows * 0.5);
  const middleColumn = Math.floor(layout.columns * 0.5);
  const nextSlotIndex = frontierAxis === "column"
    ? middleRow * layout.columns + frontierPosition
    : frontierPosition * layout.columns + middleColumn;
  const positionOf = index => frontierAxis === "column"
    ? indexColumn(layout, index)
    : indexRow(layout, index);
  const indexAtPosition = position => frontierAxis === "column"
    ? middleRow * layout.columns + position
    : position * layout.columns + middleColumn;
  const allIndices = Array.from(
    { length: layout.columns * layout.rows },
    (_, index) => index,
  );
  const cacheIndices = allIndices.filter(
    index => positionOf(index) < frontierPosition,
  );
  const futureIndices = allIndices.filter(
    index => positionOf(index) > frontierPosition
      || (positionOf(index) === frontierPosition && index !== nextSlotIndex),
  );
  const snapshotPosition = progress
    / CONTEXT_WINDOW_PHASES.attentionEnd
    * options.layerPasses;
  const snapshotIndex = phase === "attention"
    ? Math.min(options.layerPasses - 1, Math.floor(snapshotPosition))
    : options.layerPasses - 1;
  const attention = contextWindowAttentionAt({
    cacheIndices,
    cycleIndex,
    snapshotIndex,
  });
  const weightByIndex = new Map(
    attention.attendedIndices.map((index, offsetIndex) => [
      index,
      attention.weights[offsetIndex],
    ]),
  );
  const maximumWeight = Math.max(...attention.weights);
  const faces = faceArray(layout, "causally-unavailable");

  if (phase === "attention" || phase === "readout") {
    for (const index of attention.attendedIndices) {
      const relative = weightByIndex.get(index) / maximumWeight;
      const level = Math.min(3, Math.floor(relative * 4));
      faces[index] = makeFace(
        level,
        1 + Math.floor(relative * (GRID_FACE_PALETTE_STEP_COUNT - 1)),
        phase === "attention" ? "attention-snapshot" : "attention-readout",
      );
    }
    if (phase === "readout") {
      faces[nextSlotIndex] = makeFace(2, 3, "query-readout");
    }
  } else {
    for (let position = 0; position < frontierPosition; position += 1) {
      const index = indexAtPosition(position);
      if (hashUnit(cycleIndex, position, 631) < 0.32) continue;
      faces[index] = makeFace(0, 1, "cached-token-summary");
    }
    faces[nextSlotIndex] = makeFace(0, 3, "committed-next-token");
  }

  const isFinalSnapshot = snapshotIndex === options.layerPasses - 1
    && (phase === "attention" || phase === "readout");
  let paletteMotion = null;
  if (options.flicker?.enabled === true) {
    if (isFinalSnapshot) {
      paletteMotion = {
        kind: "context-window-final-snapshot",
        indices: attention.attendedIndices,
        amount: 1,
      };
    } else if (phase === "commit" || phase === "quiet") {
      paletteMotion = {
        kind: "context-window-final-dot",
        indices: [nextSlotIndex],
        amount: 1,
      };
    }
  }

  return {
    key: `context:${cycleIndex}:${phase}:${snapshotIndex}`,
    phase,
    stepIndex: snapshotIndex,
    faces,
    frontierAxis,
    frontierPosition,
    frontierColumn: frontierAxis === "column" ? frontierPosition : null,
    frontierRow: frontierAxis === "row" ? frontierPosition : null,
    nextSlotIndex,
    cacheIndices,
    futureIndices,
    attendedIndices: attention.attendedIndices,
    attentionWeights: attention.weights,
    ...(paletteMotion ? { paletteMotion } : {}),
    toolEnabled: false,
  };
}

export function toolLoopRegionsForLayout(layout) {
  const orientation = layout.columns >= layout.rows ? "horizontal" : "vertical";
  const gatewayColumn = Math.floor(layout.columns * 0.5);
  const gatewayRow = Math.floor(layout.rows * 0.5);
  const leftGutterColumn = orientation === "horizontal"
    ? Math.max(0, gatewayColumn - 1)
    : null;
  const rightGutterColumn = orientation === "horizontal"
    ? Math.min(layout.columns - 1, gatewayColumn + 1)
    : null;
  const topGutterRow = orientation === "vertical"
    ? Math.max(0, gatewayRow - 1)
    : null;
  const bottomGutterRow = orientation === "vertical"
    ? Math.min(layout.rows - 1, gatewayRow + 1)
    : null;
  const gatewayIndex = gatewayRow * layout.columns + gatewayColumn;
  const modelIndices = [];
  const observationIndices = [];
  const gutterIndices = [];

  for (let index = 0; index < layout.columns * layout.rows; index += 1) {
    const column = indexColumn(layout, index);
    const row = indexRow(layout, index);
    if (index === gatewayIndex) continue;
    const axisPosition = orientation === "horizontal" ? column : row;
    const leadingGutter = orientation === "horizontal"
      ? leftGutterColumn
      : topGutterRow;
    const trailingGutter = orientation === "horizontal"
      ? rightGutterColumn
      : bottomGutterRow;
    if (axisPosition < leadingGutter) modelIndices.push(index);
    else if (axisPosition > trailingGutter) observationIndices.push(index);
    else gutterIndices.push(index);
  }

  return {
    orientation,
    gatewayColumn,
    gatewayRow,
    leftGutterColumn,
    rightGutterColumn,
    topGutterRow,
    bottomGutterRow,
    gatewayIndex,
    modelIndices,
    observationIndices,
    gutterIndices,
  };
}

function createToolLoopScene({ layout, cycleIndex, progress, options }) {
  const phase = toolLoopPhaseAt(progress);
  const regions = toolLoopRegionsForLayout(layout);
  const faces = faceArray(layout, "tool-boundary-whitespace");
  let stepIndex = 0;
  let route = "waiting";
  let finalDotIndex = null;

  if (phase === "perceive") {
    sparseFeatureFaces({
      faces,
      indices: regions.modelIndices,
      whitespaceRatio: 0.34 + hashUnit(cycleIndex, 0, 701) * 0.24,
      seed: cycleIndex * 17,
      role: "request-context",
      maximumLevel: 2,
    });
  } else if (phase === "infer") {
    const inferPosition = (
      progress - TOOL_LOOP_PHASES.perceiveEnd
    ) / (TOOL_LOOP_PHASES.inferEnd - TOOL_LOOP_PHASES.perceiveEnd)
      * options.layerPasses;
    stepIndex = Math.min(options.layerPasses - 1, Math.floor(inferPosition));
    sparseFeatureFaces({
      faces,
      indices: regions.modelIndices,
      whitespaceRatio: 0.18 + hashUnit(cycleIndex, stepIndex, 709) * 0.42,
      seed: cycleIndex * 29 + stepIndex,
      role: "model-inference",
    });
  } else if (phase === "action") {
    const quietModel = rankedIndices(regions.modelIndices, cycleIndex, 719)
      .slice(0, Math.max(1, Math.floor(regions.modelIndices.length * 0.18)));
    for (const index of quietModel) {
      faces[index] = makeFace(0, 1, "held-model-context");
    }
    faces[regions.gatewayIndex] = makeFace(2, 3, "structured-tool-call");
    route = "tool";
  } else if (phase === "wait") {
    faces[regions.gatewayIndex] = makeFace(0, 1, "external-wait");
    route = "tool";
  } else if (phase === "observation") {
    faces[regions.gatewayIndex] = makeFace(0, 2, "tool-result-ready");
    sparseFeatureFaces({
      faces,
      indices: regions.observationIndices,
      whitespaceRatio: 0.22 + hashUnit(cycleIndex, 0, 727) * 0.32,
      seed: cycleIndex * 41,
      role: "external-observation",
      protectedIndices: [regions.observationIndices[0]],
    });
    route = "tool";
  } else if (phase === "assimilate") {
    const assimilationPosition = (
      progress - TOOL_LOOP_PHASES.observationEnd
    ) / (TOOL_LOOP_PHASES.assimilateEnd - TOOL_LOOP_PHASES.observationEnd);
    stepIndex = Math.min(1, Math.floor(assimilationPosition * 2));
    sparseFeatureFaces({
      faces,
      indices: regions.modelIndices,
      whitespaceRatio: 0.26 + hashUnit(cycleIndex, stepIndex, 733) * 0.3,
      seed: cycleIndex * 47 + stepIndex,
      role: "observation-assimilation",
      maximumLevel: 2,
    });
    if (stepIndex === 0) {
      sparseFeatureFaces({
        faces,
        indices: regions.observationIndices,
        whitespaceRatio: 0.58,
        seed: cycleIndex * 53,
        role: "observation-held",
        maximumLevel: 1,
      });
    }
    route = "model";
  } else {
    const repeatTool = hashUnit(cycleIndex, 0, 743) < 0.42;
    route = repeatTool ? "tool" : "answer";
    if (repeatTool) {
      faces[regions.gatewayIndex] = makeFace(1, 3, "next-tool-route");
    } else {
      const responseIndex = regions.orientation === "horizontal"
        ? regions.gatewayRow * layout.columns
          + Math.max(0, regions.leftGutterColumn - 1)
        : Math.max(0, regions.topGutterRow - 1) * layout.columns
          + regions.gatewayColumn;
      faces[responseIndex] = makeFace(
        0,
        GRID_FACE_PALETTE_STEP_COUNT - 1,
        "answer-ready",
      );
      finalDotIndex = responseIndex;
    }
  }

  for (const index of regions.gutterIndices) {
    faces[index] = emptyThinkingFace("tool-boundary-whitespace");
  }
  let paletteMotion = null;
  if (options.flicker?.enabled === true) {
    const indices = [];
    for (let index = 0; index < faces.length; index += 1) {
      if (faces[index].level >= 3) indices.push(index);
    }
    if (indices.length > 0) {
      paletteMotion = {
        kind: "tool-loop-high-density",
        indices,
        amount: 1,
      };
    } else if (phase === "route" && finalDotIndex !== null) {
      paletteMotion = {
        kind: "tool-loop-final-dot",
        indices: [finalDotIndex],
        amount: 1,
      };
    }
  }
  return {
    key: `tool:${cycleIndex}:${phase}:${stepIndex}:${route}`,
    phase,
    stepIndex,
    faces,
    regions,
    route,
    finalDotIndex,
    ...(paletteMotion ? { paletteMotion } : {}),
    toolEnabled: true,
  };
}

// Procedural-topology strategies -------------------------------------------

function normalizedGridDistance(layout, firstIndex, secondIndex) {
  const firstColumn = indexColumn(layout, firstIndex);
  const firstRow = indexRow(layout, firstIndex);
  const secondColumn = indexColumn(layout, secondIndex);
  const secondRow = indexRow(layout, secondIndex);
  const columnScale = Math.max(1, layout.columns - 1);
  const rowScale = Math.max(1, layout.rows - 1);
  return Math.hypot(
    (firstColumn - secondColumn) / columnScale,
    (firstRow - secondRow) / rowScale,
  );
}

export function voronoiSitesForLayout(layout, cycleIndex, siteCount = 4) {
  const cellCount = layout.columns * layout.rows;
  if (!Number.isInteger(siteCount) || siteCount < 2 || siteCount > cellCount) {
    throw new RangeError("siteCount must fit at least two Voronoi sites in the grid.");
  }
  const indices = Array.from({ length: cellCount }, (_, index) => index);
  const ranked = rankedIndices(indices, cycleIndex, 809);
  const sites = [ranked[0]];
  const selected = new Set(sites);

  while (sites.length < siteCount) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    for (const index of indices) {
      if (selected.has(index)) continue;
      const separation = Math.min(
        ...sites.map(siteIndex => normalizedGridDistance(layout, index, siteIndex)),
      );
      const score = separation + hashUnit(cycleIndex, index, 811) * 0.06;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    sites.push(bestIndex);
    selected.add(bestIndex);
  }
  return sites;
}

function voronoiAssignmentsAt(layout, sites, cycleIndex, passIndex) {
  const weights = sites.map(
    (siteIndex, siteOrder) => (
      (hashUnit(cycleIndex + passIndex * 17, siteIndex, 821 + siteOrder) - 0.5)
      * 0.24
    ),
  );
  return Array.from(
    { length: layout.columns * layout.rows },
    (_, index) => {
      const scores = sites.map((siteIndex, siteOrder) => ({
        siteIndex,
        siteOrder,
        distance: normalizedGridDistance(layout, index, siteIndex),
        score: normalizedGridDistance(layout, index, siteIndex) - weights[siteOrder],
      })).sort((first, second) => first.score - second.score);
      const winner = scores[0];
      const margin = scores[1].score - winner.score;
      const confidence = clamp01(margin / 0.3);
      const proximity = clamp01(1 - winner.distance / Math.SQRT2);
      return {
        index,
        winnerOrder: winner.siteOrder,
        winnerIndex: winner.siteIndex,
        margin,
        confidence,
        proximity,
      };
    },
  );
}

function voronoiBoundaryIndices(assignments, sites, ratio) {
  const siteSet = new Set(sites);
  const eligible = assignments
    .filter(assignment => !siteSet.has(assignment.index))
    .sort((first, second) => first.margin - second.margin || first.index - second.index);
  if (eligible.length <= 1) return new Set();
  const count = Math.max(
    1,
    Math.min(eligible.length - 1, Math.round(clamp01(ratio) * eligible.length)),
  );
  return new Set(eligible.slice(0, count).map(assignment => assignment.index));
}

function visibleVoronoiBoundaryNeighbors(layout, boundaryIndices, faces) {
  const neighbors = new Set();
  const addVisible = index => {
    if (faces[index].level >= 0) neighbors.add(index);
  };
  for (const index of boundaryIndices) {
    const row = indexRow(layout, index);
    const column = indexColumn(layout, index);
    if (column > 0) addVisible(index - 1);
    if (column + 1 < layout.columns) addVisible(index + 1);
    if (row > 0) addVisible(index - layout.columns);
    if (row + 1 < layout.rows) addVisible(index + layout.columns);
  }
  return [...neighbors].sort((first, second) => first - second);
}

function selectedVoronoiSiteOrder(assignments, sites, cycleIndex) {
  const evidence = new Float64Array(sites.length);
  for (const assignment of assignments) {
    evidence[assignment.winnerOrder] += 0.2 + assignment.confidence;
  }
  let selectedOrder = 0;
  let selectedScore = -Infinity;
  for (let siteOrder = 0; siteOrder < sites.length; siteOrder += 1) {
    const score = evidence[siteOrder]
      + hashUnit(cycleIndex, sites[siteOrder], 827) * 0.35;
    if (score > selectedScore) {
      selectedScore = score;
      selectedOrder = siteOrder;
    }
  }
  return selectedOrder;
}

function voronoiEndpointCellIndices(
  layout,
  assignments,
  sites,
  boundaryIndices,
) {
  const centerColumn = Math.round(layout.columns * 0.5 - 0.5);
  const centerRow = Math.round(layout.rows * 0.5 - 0.5);
  const selected = sites.map(() => ({
    index: null,
    distance: -1,
    confidence: -1,
  }));
  for (const assignment of assignments) {
    if (boundaryIndices.has(assignment.index)) continue;
    const distance = Math.abs(indexColumn(layout, assignment.index) - centerColumn)
      + Math.abs(indexRow(layout, assignment.index) - centerRow);
    const candidate = selected[assignment.winnerOrder];
    if (
      distance > candidate.distance
      || (distance === candidate.distance && assignment.confidence > candidate.confidence)
      || (
        distance === candidate.distance
        && assignment.confidence === candidate.confidence
        && assignment.index < candidate.index
      )
    ) {
      candidate.index = assignment.index;
      candidate.distance = distance;
      candidate.confidence = assignment.confidence;
    }
  }
  if (selected.some(candidate => candidate.index === null)) {
    throw new Error("Voronoi endpoint needs one visible parent cell per territory.");
  }
  return selected.map(candidate => candidate.index);
}

function createVoronoiScene({ layout, cycleIndex, progress, options }) {
  const phase = voronoiPhaseAt(progress);
  const partitionPosition = progress
    / VORONOI_PHASES.partitionEnd
    * options.layerPasses;
  const stepIndex = phase === "partition"
    ? Math.min(options.layerPasses - 1, Math.floor(partitionPosition))
    : options.layerPasses - 1;
  const actualSiteCount = Math.min(
    options.siteCount,
    layout.columns * layout.rows,
  );
  const sites = voronoiSitesForLayout(layout, cycleIndex, actualSiteCount);
  const assignments = voronoiAssignmentsAt(layout, sites, cycleIndex, stepIndex);
  const boundaryRatio = clamp01(
    options.boundaryWhitespace
      + (hashUnit(cycleIndex, stepIndex, 829) - 0.5) * 0.12,
  );
  const boundaryIndices = voronoiBoundaryIndices(
    assignments,
    sites,
    boundaryRatio,
  );
  const selectedSiteOrder = selectedVoronoiSiteOrder(
    assignments,
    sites,
    cycleIndex,
  );
  const selectedSiteIndex = sites[selectedSiteOrder];
  const endpointCellIndices = voronoiEndpointCellIndices(
    layout,
    assignments,
    sites,
    boundaryIndices,
  );
  const endpointPreparationProgress = phase === "commit" || phase === "settle"
    ? clamp01(
      (progress - VORONOI_PHASES.consensusEnd)
        / (1 - VORONOI_PHASES.consensusEnd),
    )
    : null;
  const siteOrderByIndex = new Map(
    sites.map((siteIndex, siteOrder) => [siteIndex, siteOrder]),
  );
  const faces = faceArray(layout, "voronoi-boundary-whitespace");

  if (phase === "partition") {
    for (const assignment of assignments) {
      if (boundaryIndices.has(assignment.index)) continue;
      const density = clamp01(
        assignment.proximity * 0.48 + assignment.confidence * 0.52,
      );
      faces[assignment.index] = makeFace(
        Math.min(MAX_GRID_FACE_LEVEL, Math.floor(density * 4)),
        assignment.winnerOrder % GRID_FACE_PALETTE_STEP_COUNT,
        `voronoi-territory-${assignment.winnerOrder}`,
      );
    }
    for (const [siteIndex, siteOrder] of siteOrderByIndex) {
      faces[siteIndex] = makeFace(
        MAX_GRID_FACE_LEVEL,
        siteOrder % GRID_FACE_PALETTE_STEP_COUNT,
        `voronoi-site-${siteOrder}`,
      );
    }
  } else if (phase === "consensus") {
    for (const assignment of assignments) {
      if (
        assignment.winnerOrder !== selectedSiteOrder
        || boundaryIndices.has(assignment.index)
      ) continue;
      faces[assignment.index] = makeFace(
        Math.min(2, Math.max(0, Math.floor(assignment.proximity * 3))),
        GRID_FACE_PALETTE_STEP_COUNT - 1,
        "voronoi-winning-basin",
      );
    }
    for (const [siteIndex, siteOrder] of siteOrderByIndex) {
      faces[siteIndex] = siteOrder === selectedSiteOrder
        ? makeFace(MAX_GRID_FACE_LEVEL, 3, "voronoi-selected-site")
        : makeFace(0, 0, "voronoi-rejected-site");
    }
  } else {
    // One representative survives from every territory. Their positions stay
    // fixed through commit and settle so Dijkstra can prepare and then route
    // the exact same multi-source plan at the outro boundary.
    endpointCellIndices.forEach((index, siteOrder) => {
      faces[index] = makeFace(
        0,
        siteOrder % GRID_FACE_PALETTE_STEP_COUNT,
        `voronoi-commit-${siteOrder}`,
      );
    });
  }

  const boundaryNeighbors = options.flicker?.enabled === true
    && (phase === "partition" || phase === "consensus")
    ? visibleVoronoiBoundaryNeighbors(layout, boundaryIndices, faces)
    : [];
  const firmBoundary = new Set(boundaryNeighbors);
  const regionInterior = [];
  if (options.flicker?.enabled === true) {
    for (let index = 0; index < faces.length; index += 1) {
      const face = faces[index];
      if (face.level < 0 || firmBoundary.has(index)) continue;
      const isRegionFace = phase === "partition"
        ? face.role.startsWith("voronoi-territory-")
          || face.role.startsWith("voronoi-site-")
        : phase === "consensus"
          && (face.role === "voronoi-winning-basin"
            || face.role === "voronoi-selected-site");
      if (isRegionFace) regionInterior.push(index);
    }
  }
  const paletteMotion = regionInterior.length > 0
    ? {
      kind: "voronoi-region-interior",
      indices: regionInterior,
      amount: 1,
    }
    : null;

  return {
    key: `voronoi:${cycleIndex}:${phase}:${stepIndex}`,
    phase,
    stepIndex,
    faces,
    sites,
    requestedSiteCount: options.siteCount,
    actualSiteCount,
    selectedSiteIndex,
    endpointCellIndices,
    ...(endpointPreparationProgress === null
      ? {}
      : { endpointPreparationProgress }),
    selectedSiteOrder,
    boundaryIndices: [...boundaryIndices],
    territoryByIndex: assignments.map(assignment => assignment.winnerOrder),
    boundaryWhitespace: boundaryRatio,
    transitionStyle: phase === "commit" || phase === "settle" ? "cut" : "animate",
    ...(paletteMotion ? { paletteMotion } : {}),
    toolEnabled: false,
  };
}

function lTreeIndexAt(layout, orientation, axisPosition, crossPosition) {
  if (orientation === "horizontal") {
    return crossPosition * layout.columns + axisPosition;
  }
  const row = layout.rows - 1 - axisPosition;
  return row * layout.columns + crossPosition;
}

function lTreeCrossPositions(count, crossLength) {
  if (count <= 1 || crossLength <= 1) return [Math.floor(crossLength * 0.5)];
  return [...new Set(Array.from(
    { length: count },
    (_, index) => Math.round(index * (crossLength - 1) / (count - 1)),
  ))];
}

function lTreePathIndices({
  layout,
  orientation,
  fromAxis,
  fromCross,
  toAxis,
  toCross,
  axisFirst,
}) {
  const indices = [];
  let axis = fromAxis;
  let cross = fromCross;
  const append = () => {
    const index = lTreeIndexAt(layout, orientation, axis, cross);
    if (indices.at(-1) !== index) indices.push(index);
  };
  const walkAxis = () => {
    while (axis !== toAxis) {
      axis += Math.sign(toAxis - axis);
      append();
    }
  };
  const walkCross = () => {
    while (cross !== toCross) {
      cross += Math.sign(toCross - cross);
      append();
    }
  };
  append();
  if (axisFirst) {
    walkAxis();
    walkCross();
  } else {
    walkCross();
    walkAxis();
  }
  return indices;
}

export function lTreeForLayout(layout, cycleIndex, generations = 4) {
  if (!Number.isInteger(generations) || generations < 1 || generations > 16) {
    throw new RangeError("L-tree generations must be an integer between 1 and 16.");
  }
  const orientation = layout.columns >= layout.rows ? "horizontal" : "vertical";
  const axisLength = orientation === "horizontal" ? layout.columns : layout.rows;
  const crossLength = orientation === "horizontal" ? layout.rows : layout.columns;
  const depthTargets = [];
  const depthByIndex = new Map();
  const rootCross = Math.floor(crossLength * 0.5);
  const rootIndex = lTreeIndexAt(layout, orientation, 0, rootCross);
  const root = {
    depth: 0,
    axis: 0,
    cross: rootCross,
    index: rootIndex,
    parent: null,
    pathIndices: [rootIndex],
  };
  depthTargets.push([root]);
  depthByIndex.set(rootIndex, 0);

  for (let depth = 1; depth <= generations; depth += 1) {
    const axis = Math.round(depth * (axisLength - 1) / generations);
    const targetCount = Math.min(crossLength, 1 << depth);
    const crosses = lTreeCrossPositions(targetCount, crossLength);
    const previousTargets = depthTargets[depth - 1];
    const targets = crosses.map((cross, targetOrder) => {
      const parent = [...previousTargets].sort((first, second) => (
        Math.abs(first.cross - cross) - Math.abs(second.cross - cross)
        || hashUnit(cycleIndex + depth, first.index, 853 + targetOrder)
          - hashUnit(cycleIndex + depth, second.index, 853 + targetOrder)
      ))[0];
      const pathIndices = lTreePathIndices({
        layout,
        orientation,
        fromAxis: parent.axis,
        fromCross: parent.cross,
        toAxis: axis,
        toCross: cross,
        axisFirst: hashUnit(cycleIndex, depth * 31 + targetOrder, 857) >= 0.5,
      });
      for (const index of pathIndices) {
        if (!depthByIndex.has(index)) depthByIndex.set(index, depth);
      }
      return {
        depth,
        axis,
        cross,
        index: lTreeIndexAt(layout, orientation, axis, cross),
        parent,
        pathIndices,
      };
    });
    depthTargets.push(targets);
  }

  const leaves = depthTargets.at(-1);
  const selectedLeafOrder = Math.min(
    leaves.length - 1,
    Math.floor(hashUnit(cycleIndex, leaves.length, 863) * leaves.length),
  );
  const selectedLeaf = leaves[selectedLeafOrder];
  const selectedPath = new Set();
  let target = selectedLeaf;
  while (target) {
    for (const index of target.pathIndices) selectedPath.add(index);
    target = target.parent;
  }

  return {
    orientation,
    rootIndex,
    terminalIndex: selectedLeaf.index,
    treeIndices: [...depthByIndex.keys()],
    selectedPathIndices: [...selectedPath],
    depthByIndex,
    depthTargets,
  };
}

function createLTreeScene({ layout, cycleIndex, progress, options }) {
  const phase = lTreePhaseAt(progress);
  const layerPasses = Math.min(16, options.layerPasses);
  const tree = lTreeForLayout(layout, cycleIndex, layerPasses);
  const faces = faceArray(layout, "l-tree-whitespace");
  const selectedPath = new Set(tree.selectedPathIndices);
  const layerFlicker = options.flicker;
  let paletteMotion = null;
  let stepIndex = 0;

  if (phase === "grow") {
    const growPosition = progress / L_TREE_PHASES.growEnd * layerPasses;
    stepIndex = Math.min(layerPasses - 1, Math.floor(growPosition));
    const visibleDepth = stepIndex + 1;
    for (const index of tree.treeIndices) {
      const depth = tree.depthByIndex.get(index);
      if (depth > visibleDepth) continue;
      faces[index] = makeFace(
        Math.min(2, depth),
        1 + (depth % (GRID_FACE_PALETTE_STEP_COUNT - 1)),
        "l-tree-growth",
      );
    }
    if (layerFlicker?.enabled === true) {
      const edgeFraction = layerFlicker.envelope?.layerEdgeFraction ?? 0.2;
      const layerProgress = growPosition - Math.floor(growPosition);
      paletteMotion = {
        kind: "l-tree-current-layer",
        indices: tree.treeIndices.filter(
          index => tree.depthByIndex.get(index) === visibleDepth,
        ),
        amount: smoothstep01(layerProgress / edgeFraction)
          * smoothstep01((1 - layerProgress) / edgeFraction),
      };
    }
  } else if (phase === "prune") {
    const prunePosition = (
      progress - L_TREE_PHASES.growEnd
    ) / (L_TREE_PHASES.pruneEnd - L_TREE_PHASES.growEnd);
    stepIndex = Math.min(1, Math.floor(prunePosition * 2));
    for (const index of tree.treeIndices) {
      if (selectedPath.has(index)) {
        faces[index] = makeFace(
          index === tree.terminalIndex ? 3 : 1,
          3,
          "l-tree-selected-path",
        );
      } else if (
        stepIndex === 0
        && hashUnit(cycleIndex, index, 877) < 0.38
      ) {
        faces[index] = makeFace(0, 0, "l-tree-pruning-branch");
      }
    }
    if (layerFlicker?.enabled === true) {
      paletteMotion = {
        kind: "l-tree-terminal-line",
        indices: tree.selectedPathIndices,
        amount: smoothstep01(
          prunePosition / (layerFlicker.envelope?.terminalRampFraction ?? 0.24),
        ),
      };
    }
  } else if (phase === "commit") {
    for (const index of tree.selectedPathIndices) {
      faces[index] = makeFace(
        index === tree.terminalIndex ? 3 : 0,
        index === tree.terminalIndex ? 3 : 2,
        "l-tree-committed-path",
      );
    }
    if (layerFlicker?.enabled === true) {
      paletteMotion = {
        kind: "l-tree-terminal-line",
        indices: tree.selectedPathIndices,
        amount: 1,
      };
    }
  } else {
    faces[tree.terminalIndex] = makeFace(0, 3, "l-tree-commit");
  }

  return {
    key: `l-tree:${cycleIndex}:${phase}:${stepIndex}`,
    phase,
    stepIndex,
    layerPasses,
    faces,
    orientation: tree.orientation,
    rootIndex: tree.rootIndex,
    terminalIndex: tree.terminalIndex,
    endpointCellIndices: [tree.terminalIndex],
    treeIndices: tree.treeIndices,
    selectedPathIndices: tree.selectedPathIndices,
    // The final parent cell is Dijkstra's source. Letting the state
    // arrangement interpolate 72 committed glyphs into this one target makes
    // that target glide before the endpoint even begins.
    transitionStyle: phase === "settle" ? "cut" : "animate",
    ...(paletteMotion ? { paletteMotion } : {}),
    toolEnabled: false,
  };
}

// Cellular-automata strategies ---------------------------------------------

function requireGameOfLifeState(state, layout) {
  const cellCount = layout.columns * layout.rows;
  if (!state || typeof state.length !== "number" || state.length !== cellCount) {
    throw new RangeError(`Game of Life state must contain ${cellCount} cells.`);
  }
}

export function gameOfLifeNeighborCount(
  state,
  layout,
  index,
  wrapEdges = false,
) {
  requireGameOfLifeState(state, layout);
  const cellCount = layout.columns * layout.rows;
  if (!Number.isInteger(index) || index < 0 || index >= cellCount) {
    throw new RangeError("Game of Life cell index is outside the grid.");
  }
  const row = indexRow(layout, index);
  const column = indexColumn(layout, index);
  const neighborIndices = new Set();
  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      if (rowOffset === 0 && columnOffset === 0) continue;
      let neighborRow = row + rowOffset;
      let neighborColumn = column + columnOffset;
      if (wrapEdges) {
        neighborRow = (
          neighborRow % layout.rows + layout.rows
        ) % layout.rows;
        neighborColumn = (
          neighborColumn % layout.columns + layout.columns
        ) % layout.columns;
      } else if (
        neighborRow < 0
        || neighborRow >= layout.rows
        || neighborColumn < 0
        || neighborColumn >= layout.columns
      ) {
        continue;
      }
      const neighborIndex = neighborRow * layout.columns + neighborColumn;
      if (neighborIndex !== index) neighborIndices.add(neighborIndex);
    }
  }
  let count = 0;
  for (const neighborIndex of neighborIndices) {
    count += state[neighborIndex] ? 1 : 0;
  }
  return count;
}

export function nextGameOfLifeState(state, layout, rules = {}) {
  requireGameOfLifeState(state, layout);
  const birthNeighbors = new Set(rules.birthNeighbors ?? [3]);
  const survivalNeighbors = new Set(rules.survivalNeighbors ?? [2, 3]);
  const wrapEdges = rules.wrapEdges ?? false;
  const nextState = new Uint8Array(state.length);
  const neighborCounts = new Uint8Array(state.length);
  for (let index = 0; index < state.length; index += 1) {
    const neighborCount = gameOfLifeNeighborCount(
      state,
      layout,
      index,
      wrapEdges,
    );
    neighborCounts[index] = neighborCount;
    nextState[index] = state[index]
      ? Number(survivalNeighbors.has(neighborCount))
      : Number(birthNeighbors.has(neighborCount));
  }
  return { state: nextState, neighborCounts };
}

function gameOfLifeCycleSeed(projectSeed, cycleIndex) {
  const seed = (
    Number.isInteger(projectSeed)
    && projectSeed >= 0
    && projectSeed <= 0xffffffff
  ) ? projectSeed >>> 0 : 0;
  return ((cycleIndex >>> 0) ^ Math.imul(seed, 0x9e3779b1)) >>> 0;
}

export function initialGameOfLifeStateAt(
  layout,
  cycleIndex,
  density = 0.34,
  projectSeed = 0,
) {
  const cellCount = layout.columns * layout.rows;
  const aliveCount = cellCount <= 1
    ? cellCount
    : Math.max(1, Math.min(cellCount - 1, Math.round(density * cellCount)));
  const indices = Array.from({ length: cellCount }, (_, index) => index);
  const cycleSeed = gameOfLifeCycleSeed(projectSeed, cycleIndex);
  const aliveIndices = rankedIndices(indices, cycleSeed, 907).slice(0, aliveCount);
  const state = new Uint8Array(cellCount);
  for (const index of aliveIndices) state[index] = 1;
  return state;
}

export function gameOfLifeStateAt({
  layout,
  cycleIndex,
  generationIndex,
  options,
}) {
  if (!Number.isInteger(generationIndex) || generationIndex < 0) {
    throw new RangeError("generationIndex must be a non-negative integer.");
  }
  let state = initialGameOfLifeStateAt(
    layout,
    cycleIndex,
    options.initialDensity,
    options.projectSeed,
  );
  let previousState = new Uint8Array(state.length);
  let neighborCounts = new Uint8Array(state.length);
  for (let index = 0; index < state.length; index += 1) {
    neighborCounts[index] = gameOfLifeNeighborCount(
      state,
      layout,
      index,
      options.wrapEdges,
    );
  }
  for (let generation = 0; generation < generationIndex; generation += 1) {
    previousState = state;
    const next = nextGameOfLifeState(state, layout, options);
    state = next.state;
    neighborCounts = next.neighborCounts;
  }
  return { state, previousState, neighborCounts };
}

export function gameOfLifeGenerationAt(progress, generationCount) {
  if (!Number.isInteger(generationCount) || generationCount < 1) {
    throw new RangeError("generationCount must be a positive integer.");
  }
  return Math.min(
    generationCount - 1,
    Math.floor(clamp01(progress) * generationCount),
  );
}

function createGameOfLifeScene({ layout, cycleIndex, progress, options }) {
  const projectSeed = (
    Number.isInteger(options.projectSeed)
    && options.projectSeed >= 0
    && options.projectSeed <= 0xffffffff
  ) ? options.projectSeed >>> 0 : 0;
  const cycleSeed = gameOfLifeCycleSeed(projectSeed, cycleIndex);
  const generationIndex = gameOfLifeGenerationAt(progress, options.layerPasses);
  const generationPosition = clamp01(progress) * options.layerPasses;
  const generationProgress = generationPosition - generationIndex;
  const life = gameOfLifeStateAt({
    layout,
    cycleIndex,
    generationIndex,
    options,
  });
  const faces = faceArray(layout, "life-dead-cell");
  const aliveIndices = [];
  const bornIndices = [];
  const survivedIndices = [];
  const diedIndices = [];

  for (let index = 0; index < life.state.length; index += 1) {
    const alive = life.state[index] === 1;
    const wasAlive = life.previousState[index] === 1;
    if (!alive) {
      if (wasAlive) diedIndices.push(index);
      continue;
    }
    aliveIndices.push(index);
    if (generationIndex === 0) {
      const seedLevel = Math.min(
        2,
        Math.floor(hashUnit(cycleSeed, index, 919) * 3),
      );
      faces[index] = makeFace(seedLevel, 1, "life-seed");
    } else if (!wasAlive) {
      bornIndices.push(index);
      faces[index] = makeFace(3, 3, "life-birth");
    } else {
      survivedIndices.push(index);
      const neighbors = life.neighborCounts[index];
      faces[index] = makeFace(
        neighbors <= 2 ? 1 : 2,
        neighbors <= 2 ? 1 : 2,
        "life-survival",
      );
    }
  }

  const birthFlicker = options.flicker;
  const paletteMotion = birthFlicker?.enabled === true && bornIndices.length > 0
    ? {
      kind: "game-of-life-births",
      indices: bornIndices,
      amount: smoothstep01(
        generationProgress / (birthFlicker.envelope?.edgeFraction ?? 0.18),
      ) * smoothstep01(
        (1 - generationProgress) / (birthFlicker.envelope?.edgeFraction ?? 0.18),
      ),
    }
    : null;

  return {
    key: `game-of-life:${projectSeed}:${cycleIndex}:${generationIndex}`,
    phase: "generation",
    seed: projectSeed,
    stepIndex: generationIndex,
    generationIndex,
    faces,
    aliveIndices,
    bornIndices,
    survivedIndices,
    diedIndices,
    neighborCounts: life.neighborCounts,
    ...(paletteMotion ? { paletteMotion } : {}),
    rules: {
      birthNeighbors: [...options.birthNeighbors],
      survivalNeighbors: [...options.survivalNeighbors],
      wrapEdges: options.wrapEdges,
    },
    toolEnabled: false,
  };
}

export function createGridSceneAt({
  strategy,
  layout,
  cycleIndex,
  progress,
  options,
}) {
  if (!GRID_SCENE_STRATEGIES.includes(strategy)) {
    throw new Error(`Unknown grid scene strategy "${strategy}".`);
  }
  const normalizedProgress = clamp01(progress);
  const stepCount = options.stepCount
    ?? options.layerPasses
    ?? (strategy === "voronoi" ? options.partitionPasses : undefined)
    ?? (strategy === "l-tree" ? options.generations : undefined)
    ?? (strategy === "life-like" ? options.generationsPerCycle : undefined);
  const normalizedOptions = {
    ...options,
    stepCount,
    layerPasses: stepCount,
  };
  const input = {
    layout,
    cycleIndex: Math.max(0, Math.floor(cycleIndex)),
    progress: normalizedProgress,
    options: normalizedOptions,
  };
  if (strategy === "inference-loop") {
    return createInferenceLoopScene(input);
  }
  if (strategy === "context-window") {
    return createContextWindowScene(input);
  }
  if (strategy === "tool-loop") {
    return createToolLoopScene(input);
  }
  if (strategy === "voronoi") {
    return createVoronoiScene(input);
  }
  if (strategy === "l-tree") {
    return createLTreeScene(input);
  }
  return createGameOfLifeScene(input);
}

function createSceneForEngine(input, allowedStrategies, engineType) {
  if (!allowedStrategies.includes(input.strategy)) {
    throw new Error(
      `Generator type "${engineType}" does not support strategy "${input.strategy}". `
      + `Available strategies: ${allowedStrategies.join(", ")}.`,
    );
  }
  return createGridSceneAt(input);
}

export function createInferenceGridSceneAt(input) {
  return createSceneForEngine(input, INFERENCE_GRID_STRATEGIES, "inference-grid");
}

export function createProceduralTopologySceneAt(input) {
  return createSceneForEngine(
    input,
    PROCEDURAL_TOPOLOGY_STRATEGIES,
    "procedural-topology",
  );
}

export function createCellularAutomataSceneAt(input) {
  return createSceneForEngine(
    input,
    CELLULAR_AUTOMATA_STRATEGIES,
    "cellular-automata",
  );
}

export function inferenceCellStateAt({
  index,
  readoutIndex,
  cycleIndex,
  progress,
  layerPasses,
}) {
  const columns = Math.max(index, readoutIndex) + 1;
  const scene = createInferenceLoopScene({
    layout: {
      columns,
      rows: 1,
      readoutIndex,
    },
    cycleIndex,
    progress,
    options: { layerPasses },
  });
  const face = scene.faces[index];
  return {
    level: face.level,
    paletteValue: face.paletteStep / (GRID_FACE_PALETTE_STEP_COUNT - 1),
    role: face.role,
    phase: scene.phase,
    layerIndex: scene.stepIndex,
  };
}

export { TAU as CIRCLE_TAU };
