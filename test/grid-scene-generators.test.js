import test from "node:test";
import assert from "node:assert/strict";

import { createCatalog } from "../src/catalog.js";
import {
  COMPOSITION_DEFINITIONS,
  GENERATOR_DEFINITIONS,
  PALETTES,
  SETTINGS,
} from "../config.js";
import {
  CONTEXT_WINDOW_PHASES,
  EMPTY_GRID_FACE_LEVEL,
  GRID_FACE_PALETTE_STEP_COUNT,
  INFERENCE_LOOP_PHASES,
  L_TREE_PHASES,
  MAX_GRID_FACE_LEVEL,
  TOOL_LOOP_PHASES,
  VORONOI_PHASES,
  candidateDistributionAt,
  candidateFlickerAmountAt,
  contextWindowPhaseAt,
  createCellularAutomataSceneAt,
  createInferenceGridSceneAt,
  createProceduralTopologySceneAt,
  gameOfLifeGenerationAt,
  gameOfLifeNeighborCount,
  gridFaceSignature,
  initialGameOfLifeStateAt,
  inferenceLoopPhaseAt,
  lTreeForLayout,
  lTreePhaseAt,
  nextGameOfLifeState,
  toolLoopPhaseAt,
  toolLoopRegionsForLayout,
  voronoiPhaseAt,
  voronoiSitesForLayout,
} from "../src/generators/grid-scene-strategies.js";
import {
  countTransitionOpacitiesAt,
  createCircleGridSceneLayout,
  subdivisionCentersForGridCell,
} from "../src/generators/circle-grid-scene-generator.js";
import { InferenceGridGenerator } from "../src/generators/inference-grid-generator.js";
import {
  ProceduralTopologyGenerator,
} from "../src/generators/procedural-topology-generator.js";
import {
  CellularAutomataGenerator,
} from "../src/generators/cellular-automata-generator.js";
import {
  OrganicPaletteMotion,
} from "../src/visuals/organic-palette-motion.js";

const GREEN_PALETTES = {
  green: ["#005122", "#008a3a", "#00b63c", "#7fd3a5"],
};

const LANDSCAPE = Object.freeze({ width: 900, height: 600 });

test("organic palette motion always returns configured palette swatches", () => {
  const motion = new OrganicPaletteMotion(
    GREEN_PALETTES.green,
    { enabled: true, amount: 1 },
  );
  const swatches = new Set([
    "rgb(0 81 34)",
    "rgb(0 138 58)",
    "rgb(0 182 60)",
    "rgb(127 211 165)",
  ]);

  for (let sample = 0; sample <= 1; sample += 0.05) {
    assert.ok(swatches.has(motion.colorFromSample(0.5, sample, 0.73)));
  }
  assert.equal(motion.colorFromSample(0, 1, 1), "rgb(127 211 165)");
  for (const basePosition of [0, 1 / 3, 2 / 3, 1]) {
    const noiseSwatches = new Set();
    for (let sample = 0; sample <= 1; sample += 0.01) {
      noiseSwatches.add(motion.colorFromNoise(basePosition, sample, 0.88));
    }
    assert.deepEqual(noiseSwatches, swatches);
  }
});

// Read the assembled settings rather than the composition modules: app-wide
// defaults such as the flicker block merge in during config assembly.
const SETTINGS_BY_STRATEGY = Object.freeze({
  "inference-loop": SETTINGS.inferenceLoop,
  "context-window": SETTINGS.contextWindow,
  "tool-loop": SETTINGS.toolLoop,
  voronoi: SETTINGS.voronoi,
  "l-tree": SETTINGS.lTree,
  "life-like": SETTINGS.gameOfLife,
});

const ENGINE_BY_STRATEGY = Object.freeze({
  "inference-loop": {
    type: "inference-grid",
    Generator: InferenceGridGenerator,
    createScene: createInferenceGridSceneAt,
  },
  "context-window": {
    type: "inference-grid",
    Generator: InferenceGridGenerator,
    createScene: createInferenceGridSceneAt,
  },
  "tool-loop": {
    type: "inference-grid",
    Generator: InferenceGridGenerator,
    createScene: createInferenceGridSceneAt,
  },
  voronoi: {
    type: "procedural-topology",
    Generator: ProceduralTopologyGenerator,
    createScene: createProceduralTopologySceneAt,
  },
  "l-tree": {
    type: "procedural-topology",
    Generator: ProceduralTopologyGenerator,
    createScene: createProceduralTopologySceneAt,
  },
  "life-like": {
    type: "cellular-automata",
    Generator: CellularAutomataGenerator,
    createScene: createCellularAutomataSceneAt,
  },
});

function normalizedOptionsFor(strategy, overrides = {}) {
  const authored = {
    ...SETTINGS_BY_STRATEGY[strategy],
    ...overrides,
  };
  const stepCount = authored.stepCount
    ?? (strategy === "voronoi" ? authored.partitionPasses : undefined)
    ?? (strategy === "l-tree" ? authored.generations : undefined)
    ?? (strategy === "life-like" ? authored.generationsPerCycle : undefined)
    ?? authored.layerPasses;
  const cycleSeconds = authored.cycleSeconds ?? authored.tokenSeconds;
  return {
    ...authored,
    intro: {
      ...authored.intro,
      enabled: false,
    },
    strategy,
    cycleSeconds,
    stepCount,
    // Pure strategies use the shared internal clock/pass vocabulary.
    tokenSeconds: cycleSeconds,
    layerPasses: stepCount,
  };
}

function levelsOf(scene) {
  return scene.faces.map(face => face.level);
}

function faceSignatures(scene) {
  return scene.faces.map(gridFaceSignature);
}

function blankCount(scene) {
  return scene.faces.filter(face => face.level < 0).length;
}

function visibleCardinalNeighbors(layout, sourceIndices, faces) {
  const neighbors = new Set();
  const addVisible = index => {
    if (faces[index].level >= 0) neighbors.add(index);
  };
  for (const index of sourceIndices) {
    const row = Math.floor(index / layout.columns);
    const column = index % layout.columns;
    if (column > 0) addVisible(index - 1);
    if (column + 1 < layout.columns) addVisible(index + 1);
    if (row > 0) addVisible(index - layout.columns);
    if (row + 1 < layout.rows) addVisible(index + layout.columns);
  }
  return [...neighbors].sort((first, second) => first - second);
}

function expectedVoronoiRegionInterior(layout, scene) {
  const firmBoundary = new Set(visibleCardinalNeighbors(
    layout,
    scene.boundaryIndices,
    scene.faces,
  ));
  return scene.faces.flatMap((face, index) => {
    if (face.level < 0 || firmBoundary.has(index)) return [];
    const isRegionFace = scene.phase === "partition"
      ? face.role.startsWith("voronoi-territory-")
        || face.role.startsWith("voronoi-site-")
      : scene.phase === "consensus"
        && (face.role === "voronoi-winning-basin"
          || face.role === "voronoi-selected-site");
    return isRegionFace ? [index] : [];
  });
}

function sceneAtViewport(
  strategy,
  viewport,
  progress,
  cycleIndex = 0,
  overrides = {},
) {
  const options = normalizedOptionsFor(strategy, overrides);
  return ENGINE_BY_STRATEGY[strategy].createScene({
    strategy,
    layout: createCircleGridSceneLayout(viewport, options.longSideCells),
    cycleIndex,
    progress,
    options,
  });
}

function sceneAt(strategy, progress, cycleIndex = 0, overrides = {}) {
  return sceneAtViewport(
    strategy,
    LANDSCAPE,
    progress,
    cycleIndex,
    overrides,
  );
}

test("the six strategies use discrete operational phases", () => {
  assert.equal(inferenceLoopPhaseAt(0), "parallel");
  assert.equal(
    inferenceLoopPhaseAt(INFERENCE_LOOP_PHASES.parallelEnd),
    "candidates",
  );
  assert.equal(
    inferenceLoopPhaseAt(INFERENCE_LOOP_PHASES.candidatesEnd),
    "selection",
  );
  assert.equal(
    inferenceLoopPhaseAt(INFERENCE_LOOP_PHASES.selectionEnd),
    "commit",
  );
  assert.equal(
    inferenceLoopPhaseAt(INFERENCE_LOOP_PHASES.commitEnd),
    "append",
  );

  assert.equal(contextWindowPhaseAt(0), "attention");
  assert.equal(
    contextWindowPhaseAt(CONTEXT_WINDOW_PHASES.attentionEnd),
    "readout",
  );
  assert.equal(
    contextWindowPhaseAt(CONTEXT_WINDOW_PHASES.readoutEnd),
    "commit",
  );
  assert.equal(
    contextWindowPhaseAt(CONTEXT_WINDOW_PHASES.commitEnd),
    "quiet",
  );

  assert.equal(toolLoopPhaseAt(0), "perceive");
  assert.equal(toolLoopPhaseAt(TOOL_LOOP_PHASES.perceiveEnd), "infer");
  assert.equal(toolLoopPhaseAt(TOOL_LOOP_PHASES.inferEnd), "action");
  assert.equal(toolLoopPhaseAt(TOOL_LOOP_PHASES.actionEnd), "wait");
  assert.equal(toolLoopPhaseAt(TOOL_LOOP_PHASES.waitEnd), "observation");
  assert.equal(
    toolLoopPhaseAt(TOOL_LOOP_PHASES.observationEnd),
    "assimilate",
  );
  assert.equal(toolLoopPhaseAt(TOOL_LOOP_PHASES.assimilateEnd), "route");

  assert.equal(voronoiPhaseAt(0), "partition");
  assert.equal(voronoiPhaseAt(VORONOI_PHASES.partitionEnd), "consensus");
  assert.equal(voronoiPhaseAt(VORONOI_PHASES.consensusEnd), "commit");
  assert.equal(voronoiPhaseAt(VORONOI_PHASES.commitEnd), "settle");

  assert.equal(lTreePhaseAt(0), "grow");
  assert.equal(lTreePhaseAt(L_TREE_PHASES.growEnd), "prune");
  assert.equal(lTreePhaseAt(L_TREE_PHASES.pruneEnd), "commit");
  assert.equal(lTreePhaseAt(L_TREE_PHASES.commitEnd), "settle");

  assert.equal(gameOfLifeGenerationAt(0, 6), 0);
  assert.equal(gameOfLifeGenerationAt(0.5, 6), 3);
  assert.equal(gameOfLifeGenerationAt(1, 6), 5);
});

test("scene layout keeps every possible circle on a fixed subdivision grid", () => {
  const landscape = createCircleGridSceneLayout({ width: 900, height: 500 }, 10);
  assert.equal(landscape.columns, 9);
  assert.equal(landscape.rows, 5);
  assert.equal(landscape.cellSize, 100);
  assert.equal(landscape.readoutIndex, 26);

  const centers = subdivisionCentersForGridCell(
    landscape,
    landscape.readoutIndex,
    MAX_GRID_FACE_LEVEL,
  );
  assert.equal(centers.length, 64);
  assert.ok(centers.every(center => (
    center.x > 800
    && center.x < 900
    && center.y > 200
    && center.y < 300
  )));
  assert.deepEqual(
    subdivisionCentersForGridCell(landscape, landscape.readoutIndex, 0),
    [{ x: 850, y: 250 }],
  );
  assert.deepEqual(
    subdivisionCentersForGridCell(
      landscape,
      landscape.readoutIndex,
      EMPTY_GRID_FACE_LEVEL,
    ),
    [],
  );

  const wide = createCircleGridSceneLayout({ width: 1000, height: 400 }, 5);
  assert.equal(wide.columns, 5);
  assert.equal(wide.rows, 3);
  assert.equal(wide.patternHeight, 400);
});

test("flip faces pass through a blank hinge and never overlap", () => {
  assert.deepEqual(
    [0, 0.25, 0.5, 0.75, 1].map(progress => (
      countTransitionOpacitiesAt(progress, true)
    )),
    [
      { previous: 1, current: 0 },
      { previous: 0.5, current: 0 },
      { previous: 0, current: 0 },
      { previous: 0, current: 0.5 },
      { previous: 0, current: 1 },
    ],
  );
  assert.deepEqual(
    [0, 0.25, 0.5, 0.75, 1].map(progress => (
      countTransitionOpacitiesAt(progress, false)
    )),
    [
      { previous: 0, current: 0 },
      { previous: 0, current: 0 },
      { previous: 0, current: 0 },
      { previous: 0, current: 0.5 },
      { previous: 0, current: 1 },
    ],
  );
  for (let sample = 0; sample <= 100; sample += 1) {
    const opacity = countTransitionOpacitiesAt(sample / 100, true);
    assert.equal(opacity.previous > 0 && opacity.current > 0, false);
  }
  for (const options of Object.values(SETTINGS_BY_STRATEGY)) {
    assert.ok(Number.isFinite(options.flipSeconds));
    assert.ok(options.flipSeconds > 0);
  }
});

test("inference loop varies exact whitespace while holding every pass still", () => {
  const options = normalizedOptionsFor("inference-loop");
  const signatures = [];
  const blankCounts = [];
  for (let cycleIndex = 0; cycleIndex < 3; cycleIndex += 1) {
    for (let pass = 0; pass < options.stepCount; pass += 1) {
      const start = pass / options.stepCount
        * INFERENCE_LOOP_PHASES.parallelEnd;
      const span = INFERENCE_LOOP_PHASES.parallelEnd / options.stepCount;
      const first = sceneAt("inference-loop", start + span * 0.2, cycleIndex);
      const second = sceneAt("inference-loop", start + span * 0.7, cycleIndex);
      assert.deepEqual(faceSignatures(first), faceSignatures(second));
      assert.ok(first.faces[first.readoutIndex].level >= 0);
      assert.ok(levelsOf(first).every(level => level >= -1 && level <= 3));
      assert.ok(blankCount(first) > 0 && blankCount(first) < first.faces.length);
      signatures.push(faceSignatures(first).join(","));
      blankCounts.push(blankCount(first));
    }
  }
  assert.ok(new Set(signatures).size > options.stepCount);
  assert.ok(new Set(blankCounts).size >= 3);
  assert.ok(Math.max(...blankCounts) - Math.min(...blankCounts) >= 3);

  const candidates = sceneAt("inference-loop", 0.7, 3);
  const selection = sceneAt("inference-loop", 0.81, 3);
  const committed = sceneAt("inference-loop", 0.87, 3);
  assert.equal(candidates.faces[candidates.readoutIndex].detail.stage, "scores");
  assert.equal(selection.faces[selection.readoutIndex].detail.stage, "selected");
  assert.equal(committed.faces[committed.readoutIndex].level, 0);
  const distribution = candidateDistributionAt(3, 64);
  assert.equal(
    candidates.faces[candidates.readoutIndex].detail.paletteMotion.selectedIndex,
    distribution.selectedIndex,
  );
  assert.ok(Math.abs(
    distribution.probabilities.reduce((sum, probability) => sum + probability, 0)
    - 1
  ) < 1e-12);
  assert.deepEqual(candidateDistributionAt(3, 64), distribution);
});

test("inference candidate flicker starts at the selection and follows outward", () => {
  const controls = SETTINGS.inferenceLoop.flicker.envelope;
  const candidateCount = 64;
  const selectedIndex = 27;
  const earlyProgress = controls.leadFraction * 0.5;
  const amountAt = (candidateIndex, progress) => candidateFlickerAmountAt({
    candidateIndex,
    selectedIndex,
    candidateCount,
    progress,
    leadFraction: controls.leadFraction,
    spreadFraction: controls.spreadFraction,
    rampFraction: controls.rampFraction,
  });

  assert.ok(amountAt(selectedIndex, earlyProgress) > 0);
  assert.ok(Array.from(
    { length: candidateCount },
    (_, candidateIndex) => candidateIndex,
  ).filter(candidateIndex => candidateIndex !== selectedIndex).every(
    candidateIndex => amountAt(candidateIndex, earlyProgress) === 0,
  ));
  assert.ok(Array.from(
    { length: candidateCount },
    (_, candidateIndex) => amountAt(candidateIndex, 1),
  ).every(amount => amount >= 1 - 1e-12));
});

test("causal horizon keeps future slots blank and commits only the frontier", () => {
  const options = normalizedOptionsFor("context-window");
  const attention = sceneAt("context-window", 0.2, 2);
  assert.equal(attention.phase, "attention");
  assert.ok(attention.attendedIndices.length > 0);
  assert.ok(attention.attendedIndices.length < attention.cacheIndices.length);
  assert.ok(Math.abs(
    attention.attentionWeights.reduce((sum, weight) => sum + weight, 0) - 1
  ) < 1e-12);
  assert.ok(attention.futureIndices.every(
    index => attention.faces[index].level === EMPTY_GRID_FACE_LEVEL,
  ));
  assert.equal(
    attention.faces[attention.nextSlotIndex].level,
    EMPTY_GRID_FACE_LEVEL,
  );
  assert.equal(attention.paletteMotion, undefined);

  const finalSnapshot = sceneAt(
    "context-window",
    CONTEXT_WINDOW_PHASES.attentionEnd
      * (options.stepCount - 0.5)
      / options.stepCount,
    2,
  );
  const readout = sceneAt("context-window", 0.58, 2);
  const commit = sceneAt("context-window", 0.7, 2);
  const quietA = sceneAt("context-window", 0.82, 2);
  const quietB = sceneAt("context-window", 0.96, 2);
  assert.equal(finalSnapshot.stepIndex, options.stepCount - 1);
  assert.equal(
    finalSnapshot.paletteMotion.kind,
    "context-window-final-snapshot",
  );
  assert.deepEqual(
    finalSnapshot.paletteMotion.indices,
    finalSnapshot.attendedIndices,
  );
  assert.equal(readout.paletteMotion.kind, "context-window-final-snapshot");
  assert.deepEqual(readout.paletteMotion.indices, readout.attendedIndices);
  assert.equal(readout.paletteMotion.indices.includes(readout.nextSlotIndex), false);
  assert.equal(readout.faces[readout.nextSlotIndex].level, 2);
  assert.equal(commit.faces[commit.nextSlotIndex].level, 0);
  assert.equal(commit.paletteMotion.kind, "context-window-final-dot");
  assert.deepEqual(commit.paletteMotion.indices, [commit.nextSlotIndex]);
  assert.equal(quietA.faces[quietA.nextSlotIndex].level, 0);
  assert.equal(quietA.paletteMotion.kind, "context-window-final-dot");
  assert.deepEqual(quietA.paletteMotion.indices, [quietA.nextSlotIndex]);
  assert.deepEqual(faceSignatures(quietA), faceSignatures(quietB));
  assert.ok(blankCount(quietA) > quietA.faces.length * 0.5);

  const frontiers = Array.from(
    { length: 5 },
    (_, cycleIndex) => sceneAt("context-window", 0.2, cycleIndex).frontierPosition,
  );
  assert.ok(new Set(frontiers).size > 2);
});

test("causal and tool diagrams preserve their regions in wide and tall viewports", () => {
  const viewports = [
    [{ width: 1920, height: 1080 }, "column", "horizontal"],
    [{ width: 390, height: 844 }, "row", "vertical"],
    [{ width: 768, height: 1024 }, "row", "vertical"],
  ];

  for (const [viewport, frontierAxis, toolOrientation] of viewports) {
    const context = sceneAtViewport("context-window", viewport, 0.2, 0);
    assert.equal(context.frontierAxis, frontierAxis);
    assert.ok(context.nextSlotIndex >= 0);
    assert.ok(context.nextSlotIndex < context.faces.length);
    assert.equal(context.cacheIndices.includes(context.nextSlotIndex), false);
    assert.equal(context.futureIndices.includes(context.nextSlotIndex), false);
    assert.equal(
      context.faces[context.nextSlotIndex].level,
      EMPTY_GRID_FACE_LEVEL,
    );
    assert.ok(context.futureIndices.every(
      index => context.faces[index].level === EMPTY_GRID_FACE_LEVEL,
    ));

    const tool = sceneAtViewport("tool-loop", viewport, 0.7, 0);
    const { regions } = tool;
    assert.equal(regions.orientation, toolOrientation);
    assert.ok(regions.modelIndices.length > 0);
    assert.ok(regions.observationIndices.length > 0);
    assert.equal(
      new Set([
        ...regions.modelIndices,
        regions.gatewayIndex,
        ...regions.gutterIndices,
        ...regions.observationIndices,
      ]).size,
      tool.faces.length,
    );
    assert.ok(regions.gutterIndices.every(
      index => tool.faces[index].level === EMPTY_GRID_FACE_LEVEL,
    ));
    assert.ok(regions.observationIndices.some(
      index => tool.faces[index].level >= 0,
    ));
  }
});

test("observe-act loop partitions model, gateway, gutters, and observation", () => {
  const layout = createCircleGridSceneLayout(LANDSCAPE, 5);
  const regions = toolLoopRegionsForLayout(layout);
  const partition = [
    ...regions.modelIndices,
    regions.gatewayIndex,
    ...regions.gutterIndices,
    ...regions.observationIndices,
  ];
  assert.equal(new Set(partition).size, layout.columns * layout.rows);
  assert.equal(regions.orientation, "horizontal");
  assert.equal(regions.gatewayIndex, Math.floor(layout.rows * 0.5) * layout.columns + 2);
  assert.ok(regions.modelIndices.every(index => index % layout.columns < 1));
  assert.ok(regions.observationIndices.every(index => index % layout.columns > 3));

  const samples = [0.04, 0.18, 0.34, 0.48, 0.7, 0.82, 0.96]
    .map(progress => sceneAt("tool-loop", progress, 1));
  for (const scene of samples) {
    assert.equal(scene.toolEnabled, true);
    assert.ok(scene.regions.gutterIndices.every(
      index => scene.faces[index].level === EMPTY_GRID_FACE_LEVEL,
    ));
    const highDensityIndices = scene.faces.flatMap(
      (face, index) => (face.level >= 3 ? [index] : []),
    );
    if (highDensityIndices.length > 0) {
      assert.equal(scene.paletteMotion.kind, "tool-loop-high-density");
      assert.deepEqual(scene.paletteMotion.indices, highDensityIndices);
      assert.equal(scene.paletteMotion.amount, 1);
    } else if (scene.phase === "route" && scene.route === "answer") {
      assert.equal(scene.paletteMotion.kind, "tool-loop-final-dot");
      assert.deepEqual(scene.paletteMotion.indices, [scene.finalDotIndex]);
      assert.equal(scene.faces[scene.finalDotIndex].level, 0);
    } else {
      assert.equal(scene.paletteMotion, undefined);
    }
  }
  assert.ok(samples.some(scene => scene.paletteMotion));

  const waitA = sceneAt("tool-loop", 0.45, 1);
  const waitB = sceneAt("tool-loop", 0.6, 1);
  assert.equal(waitA.phase, "wait");
  assert.deepEqual(faceSignatures(waitA), faceSignatures(waitB));
  assert.ok(waitA.regions.observationIndices.every(
    index => waitA.faces[index].level === EMPTY_GRID_FACE_LEVEL,
  ));
  assert.equal(
    waitA.faces.filter(face => face.level >= 0).length,
    1,
  );

  const observation = sceneAt("tool-loop", 0.7, 1);
  const assimilation = sceneAt("tool-loop", 0.82, 1);
  const repeatRoute = sceneAt("tool-loop", 0.96, 2);
  assert.equal(observation.phase, "observation");
  assert.ok(observation.regions.observationIndices.some(
    index => observation.faces[index].level >= 0,
  ));
  assert.equal(assimilation.phase, "assimilate");
  assert.ok(assimilation.regions.modelIndices.some(
    index => assimilation.faces[index].level >= 0,
  ));
  assert.equal(repeatRoute.route, "tool");
  assert.equal(repeatRoute.finalDotIndex, null);
  assert.equal(repeatRoute.paletteMotion, undefined);
});

test("Voronoi influence fields keep fixed sites and variable white boundaries", () => {
  const options = normalizedOptionsFor("voronoi");
  const layout = createCircleGridSceneLayout(LANDSCAPE, options.longSideCells);
  const sites = voronoiSitesForLayout(layout, 2, options.siteCount);
  assert.equal(sites.length, options.siteCount);
  assert.equal(new Set(sites).size, sites.length);

  const blankCounts = [];
  const span = VORONOI_PHASES.partitionEnd / options.stepCount;
  for (let cycleIndex = 0; cycleIndex < 3; cycleIndex += 1) {
    for (let pass = 0; pass < options.stepCount; pass += 1) {
      const progress = pass * span + span * 0.4;
      const scene = sceneAt("voronoi", progress, cycleIndex);
      const held = sceneAt("voronoi", progress + span * 0.3, cycleIndex);
      assert.equal(scene.phase, "partition");
      assert.deepEqual(faceSignatures(scene), faceSignatures(held));
      assert.equal(new Set(scene.sites).size, options.siteCount);
      assert.ok(scene.sites.every(index => scene.faces[index].level >= 0));
      assert.ok(scene.boundaryIndices.every(
        index => scene.faces[index].level === EMPTY_GRID_FACE_LEVEL,
      ));
      const expectedBoundaryNeighbors = visibleCardinalNeighbors(
        layout,
        scene.boundaryIndices,
        scene.faces,
      );
      assert.ok(expectedBoundaryNeighbors.length > 0);
      const expectedInterior = expectedVoronoiRegionInterior(layout, scene);
      assert.ok(expectedInterior.length > 0);
      assert.equal(scene.paletteMotion.kind, "voronoi-region-interior");
      assert.deepEqual(scene.paletteMotion.indices, expectedInterior);
      assert.ok(expectedBoundaryNeighbors.every(
        index => !scene.paletteMotion.indices.includes(index),
      ));
      assert.equal(scene.paletteMotion.amount, 1);
      assert.ok(scene.territoryByIndex.every(
        siteOrder => siteOrder >= 0 && siteOrder < options.siteCount,
      ));
      blankCounts.push(blankCount(scene));
    }
  }
  assert.ok(new Set(blankCounts).size > 1);

  const consensus = sceneAt("voronoi", 0.68, 2);
  const commit = sceneAt("voronoi", 0.82, 2);
  const settle = sceneAt("voronoi", 0.95, 2);
  assert.equal(consensus.phase, "consensus");
  assert.ok(consensus.faces[consensus.selectedSiteIndex].level >= 0);
  const consensusInterior = expectedVoronoiRegionInterior(layout, consensus);
  if (consensusInterior.length > 0) {
    assert.equal(consensus.paletteMotion.kind, "voronoi-region-interior");
    assert.deepEqual(consensus.paletteMotion.indices, consensusInterior);
    const firmConsensusBoundary = visibleCardinalNeighbors(
      layout,
      consensus.boundaryIndices,
      consensus.faces,
    );
    assert.ok(firmConsensusBoundary.every(
      index => !consensus.paletteMotion.indices.includes(index),
    ));
  } else {
    assert.equal(consensus.paletteMotion, undefined);
  }
  assert.equal(commit.phase, "commit");
  assert.equal(commit.paletteMotion, undefined);
  assert.equal(commit.faces.filter(face => face.level >= 0).length, 1);
  assert.equal(commit.faces[commit.selectedSiteIndex].level, 0);
  assert.equal(settle.paletteMotion, undefined);
  assert.deepEqual(faceSignatures(commit), faceSignatures(settle));

  const narrowWide = sceneAtViewport(
    "voronoi",
    { width: 1920, height: 1080 },
    0.2,
    0,
  );
  assert.equal(narrowWide.requestedSiteCount, options.siteCount);
  assert.equal(
    narrowWide.actualSiteCount,
    Math.min(options.siteCount, narrowWide.faces.length),
  );
  assert.equal(new Set(narrowWide.sites).size, narrowWide.actualSiteCount);
});

test("L-tree grows, prunes, and commits without moving a node", () => {
  const options = normalizedOptionsFor("l-tree");
  const layout = createCircleGridSceneLayout(LANDSCAPE, options.longSideCells);
  const tree = lTreeForLayout(layout, 3, options.stepCount);
  assert.equal(tree.orientation, "horizontal");
  assert.ok(tree.treeIndices.includes(tree.rootIndex));
  assert.ok(tree.treeIndices.includes(tree.terminalIndex));
  assert.ok(tree.selectedPathIndices.every(index => tree.treeIndices.includes(index)));

  const span = L_TREE_PHASES.growEnd / options.stepCount;
  const occupiedCounts = Array.from(
    { length: options.stepCount },
    (_, pass) => {
      const scene = sceneAt("l-tree", pass * span + span * 0.4, 3);
      assert.equal(scene.phase, "grow");
      return scene.faces.filter(face => face.level >= 0).length;
    },
  );
  assert.ok(occupiedCounts.every(
    (count, index) => index === 0 || count >= occupiedCounts[index - 1],
  ));
  assert.ok(occupiedCounts.at(-1) > occupiedCounts[0]);

  const motionTree = lTreeForLayout(layout, 0, options.stepCount);
  for (let pass = 0; pass < options.stepCount; pass += 1) {
    const scene = sceneAt("l-tree", pass * span + span * 0.5);
    const expectedLayer = motionTree.treeIndices.filter(
      index => motionTree.depthByIndex.get(index) === pass + 1,
    );
    assert.equal(scene.paletteMotion.kind, "l-tree-current-layer");
    assert.deepEqual(
      [...scene.paletteMotion.indices].sort((first, second) => first - second),
      expectedLayer.sort((first, second) => first - second),
    );
    assert.equal(scene.paletteMotion.amount, 1);
  }

  const earlyPrune = sceneAt("l-tree", 0.61, 3);
  const latePrune = sceneAt("l-tree", 0.73, 3);
  const commit = sceneAt("l-tree", 0.84, 3);
  const settle = sceneAt("l-tree", 0.95, 3);
  assert.equal(earlyPrune.phase, "prune");
  assert.equal(latePrune.phase, "prune");
  assert.ok(blankCount(latePrune) >= blankCount(earlyPrune));
  assert.ok(latePrune.selectedPathIndices.every(
    index => latePrune.faces[index].level >= 0,
  ));
  assert.ok(commit.selectedPathIndices.every(
    index => commit.faces[index].level >= 0,
  ));
  assert.equal(earlyPrune.paletteMotion.kind, "l-tree-terminal-line");
  assert.deepEqual(
    earlyPrune.paletteMotion.indices,
    earlyPrune.selectedPathIndices,
  );
  assert.ok(earlyPrune.paletteMotion.amount > 0);
  assert.equal(commit.paletteMotion.kind, "l-tree-terminal-line");
  assert.equal(commit.paletteMotion.amount, 1);
  assert.equal(settle.paletteMotion, undefined);
  assert.equal(settle.faces.filter(face => face.level >= 0).length, 1);
  assert.equal(settle.faces[settle.terminalIndex].level, 0);

  const portraitLayout = createCircleGridSceneLayout(
    { width: 390, height: 844 },
    options.longSideCells,
  );
  const portraitTree = lTreeForLayout(portraitLayout, 3, options.stepCount);
  assert.equal(portraitTree.orientation, "vertical");
  assert.ok(portraitTree.treeIndices.every(
    index => index >= 0 && index < portraitLayout.columns * portraitLayout.rows,
  ));
});

test("Game of Life applies B3/S23 simultaneously from eight neighbors", () => {
  const layout = { columns: 5, rows: 5 };
  const verticalBlinker = new Uint8Array(25);
  for (const index of [7, 12, 17]) verticalBlinker[index] = 1;
  assert.equal(gameOfLifeNeighborCount(verticalBlinker, layout, 12), 2);
  assert.equal(gameOfLifeNeighborCount(verticalBlinker, layout, 11), 3);

  const next = nextGameOfLifeState(verticalBlinker, layout, {
    birthNeighbors: [3],
    survivalNeighbors: [2, 3],
    wrapEdges: false,
  });
  assert.deepEqual(
    [...next.state].flatMap((alive, index) => (alive ? [index] : [])),
    [11, 12, 13],
  );
  assert.deepEqual(
    [...nextGameOfLifeState(next.state, layout, {
      birthNeighbors: [3],
      survivalNeighbors: [2, 3],
      wrapEdges: false,
    }).state].flatMap((alive, index) => (alive ? [index] : [])),
    [7, 12, 17],
  );

  const options = normalizedOptionsFor("life-like");
  const sceneLayout = createCircleGridSceneLayout(LANDSCAPE, options.longSideCells);
  assert.deepEqual(
    initialGameOfLifeStateAt(sceneLayout, 4, options.initialDensity, 1234),
    initialGameOfLifeStateAt(sceneLayout, 4, options.initialDensity, 1234),
  );
  assert.notDeepEqual(
    initialGameOfLifeStateAt(sceneLayout, 4, options.initialDensity, 1234),
    initialGameOfLifeStateAt(sceneLayout, 4, options.initialDensity, 5678),
  );
  const generationSpan = 1 / options.stepCount;
  const first = sceneAt("life-like", generationSpan * 0.2, 4);
  const held = sceneAt("life-like", generationSpan * 0.8, 4);
  const second = sceneAt("life-like", generationSpan * 1.2, 4);
  assert.equal(first.phase, "generation");
  assert.equal(first.seed, 0);
  assert.equal(first.generationIndex, 0);
  assert.deepEqual(faceSignatures(first), faceSignatures(held));
  assert.equal(second.generationIndex, 1);
  assert.notDeepEqual(faceSignatures(first), faceSignatures(second));
  assert.equal(first.paletteMotion, undefined);
  assert.ok(second.bornIndices.length > 0);
  assert.equal(second.paletteMotion.kind, "game-of-life-births");
  assert.deepEqual(second.paletteMotion.indices, second.bornIndices);
  assert.equal(second.paletteMotion.amount, 1);
  assert.ok(second.survivedIndices.every(
    index => !second.paletteMotion.indices.includes(index),
  ));
  assert.deepEqual(second.rules, {
    birthNeighbors: [...options.birthNeighbors],
    survivalNeighbors: [...options.survivalNeighbors],
    wrapEdges: options.wrapEdges,
  });
  assert.ok(first.faces.some(face => face.level >= 0));
  assert.ok(first.faces.some(face => face.level === EMPTY_GRID_FACE_LEVEL));
  assert.equal(
    second.aliveIndices.length,
    second.bornIndices.length + second.survivedIndices.length,
  );
  assert.equal(
    createGeneratorForStrategy("life-like").flicker.enabled,
    true,
  );
});

test("Game of Life uses the project seed and reports it in inspection metadata", () => {
  let projectSeed = 1234;
  const generator = new CellularAutomataGenerator({
    name: "seededLifeGenerator",
    definition: { type: "cellular-automata", strategy: "life-like" },
    options: {
      ...SETTINGS.gameOfLife,
      intro: { ...SETTINGS.gameOfLife.intro, enabled: false },
    },
    runtime: {
      viewport: () => LANDSCAPE,
      projectSeed: () => projectSeed,
    },
    palettes: PALETTES,
  });
  generator.enter();
  generator.update({ compositionDt: 0 });
  const first = generator.inspect();
  const firstLevels = [...first.levels];

  projectSeed = 5678;
  generator.update({ compositionDt: Number.EPSILON });
  const second = generator.inspect();

  assert.equal(first.seed, 1234);
  assert.equal(second.seed, 5678);
  assert.notDeepEqual(firstLevels, [...second.levels]);
});

function recordingContext() {
  const arcs = [];
  const fills = [];
  const alphaStack = [];
  let pathStart = 0;
  return {
    arcs,
    fills,
    globalAlpha: 1,
    fillStyle: "",
    save() {
      alphaStack.push(this.globalAlpha);
    },
    restore() {
      this.globalAlpha = alphaStack.pop();
    },
    beginPath() {
      pathStart = arcs.length;
    },
    moveTo() {},
    arc(x, y, radius, start, end) {
      arcs.push({ x, y, radius, start, end });
    },
    fill() {
      fills.push({
        color: this.fillStyle,
        alpha: this.globalAlpha,
        arcCount: arcs.length - pathStart,
      });
    },
  };
}

function createGeneratorForStrategy(
  strategy,
  { overrides = {}, palettes = PALETTES, viewport = LANDSCAPE } = {},
) {
  const engine = ENGINE_BY_STRATEGY[strategy];
  const settingsKey = `${strategy}TestSettings`;
  return new engine.Generator({
    name: `${strategy}TestGenerator`,
    definition: {
      type: engine.type,
      settingsKey,
      strategy,
    },
    settingsKey,
    options: {
      ...SETTINGS_BY_STRATEGY[strategy],
      ...overrides,
      intro: {
        ...SETTINGS_BY_STRATEGY[strategy].intro,
        enabled: false,
        ...overrides.intro,
      },
    },
    runtime: { viewport: () => viewport },
    palettes,
  });
}

function constructGenerator(
  Generator,
  type,
  strategy,
  options,
  palettes = GREEN_PALETTES,
) {
  return new Generator({
    name: "validationGenerator",
    definition: { type, strategy },
    options,
    runtime: { viewport: () => ({ width: 640, height: 480 }) },
    palettes,
  });
}

test("L-tree renderer noise-colors only the active growth layer", () => {
  const options = normalizedOptionsFor("l-tree");
  let noiseCallCount = 0;
  const generator = new ProceduralTopologyGenerator({
    name: "lTreeMotionTestGenerator",
    definition: {
      type: "procedural-topology",
      settingsKey: "lTreeMotionTestSettings",
      strategy: "l-tree",
    },
    settingsKey: "lTreeMotionTestSettings",
    options: {
      ...options,
      // Pinned to GREEN_PALETTES below, whatever palette config/global.js
      // currently selects app-wide.
      palette: "green",
      // This test covers the noise field itself, so it pins the mode rather
      // than following whichever mode config/global.js currently authors.
      flicker: {
        ...options.flicker,
        mode: "noise",
        scope: "canvas",
        modes: {
          noise: { ...options.flicker.modes.noise, spatialScale: 1 },
        },
      },
    },
    runtime: {
      viewport: () => LANDSCAPE,
      p5: {
        noise: (x, y) => {
          noiseCallCount += 1;
          const bucket = (
            Math.floor(x) * 3 + Math.floor(y) * 7
          ) % 5;
          return (bucket + 5) % 5 / 4;
        },
      },
    },
    palettes: GREEN_PALETTES,
  });
  generator.enter();
  const layerSpan = L_TREE_PHASES.growEnd / options.stepCount;
  generator.update({ compositionDt: options.cycleSeconds * layerSpan * 0.5 });
  generator.update({ compositionDt: options.flipSeconds * 0.5 });

  const inspection = generator.inspect();
  const activeLayer = new Set(inspection.paletteMotion.indices);
  const activeIndex = inspection.paletteMotion.indices.find(
    index => inspection.levels[index] > 0,
  );
  const inactiveIndex = [...inspection.levels].findIndex(
    (level, index) => level >= 0 && !activeLayer.has(index),
  );
  generator.paletteMotionTime = 1;

  const context = recordingContext();
  generator.drawFace(
    context,
    activeIndex,
    generator.currentFaces[activeIndex],
    1,
  );
  const subdivisionCount = 1 << inspection.levels[activeIndex];
  assert.equal(context.arcs.length, subdivisionCount * subdivisionCount);
  assert.equal(noiseCallCount, context.arcs.length);
  assert.ok(context.fills.length > 1);
  const paletteSwatches = new Set(generator.paletteColors);
  assert.deepEqual(
    new Set(context.fills.map(fill => fill.color)),
    paletteSwatches,
  );
  assert.ok(context.fills.every(fill => paletteSwatches.has(fill.color)));
  assert.equal(
    context.fills.reduce((sum, fill) => sum + fill.arcCount, 0),
    context.arcs.length,
  );
  assert.ok(context.fills.every(fill => fill.alpha === 1));

  const stableContext = recordingContext();
  generator.drawFace(
    stableContext,
    inactiveIndex,
    generator.currentFaces[inactiveIndex],
    1,
  );
  assert.equal(noiseCallCount, context.arcs.length);
  assert.equal(stableContext.fills.length, 1);
  assert.equal(
    stableContext.fills[0].color,
    generator.paletteColorStep(inspection.paletteSteps[inactiveIndex]),
  );
});

test("all six strategies draw only full circles at legal cell centers", () => {
  const cases = [
    ["inference-loop", 0.7],
    ["context-window", 0.58],
    ["tool-loop", 0.7],
    ["voronoi", 0.68],
    ["l-tree", 0.73],
    ["life-like", 0.02],
  ];
  for (const [strategy, progress] of cases) {
    const options = normalizedOptionsFor(strategy);
    const generator = createGeneratorForStrategy(strategy);
    generator.enter();
    generator.update({ compositionDt: options.cycleSeconds * progress });
    const hingeContext = recordingContext();
    generator.draw({}, {}, hingeContext);
    assert.equal(hingeContext.arcs.length, 0);
    generator.update({ compositionDt: options.flipSeconds * 0.5 });

    const context = recordingContext();
    generator.draw({}, {}, context);
    const inspection = generator.inspect();
    assert.equal(inspection.generatorType, ENGINE_BY_STRATEGY[strategy].type);
    assert.equal(inspection.strategy, strategy);
    assert.ok(inspection.whitespaceCount > 0);
    assert.ok(context.arcs.length > 0);
    assert.ok(context.arcs.every(arc => (
      Number.isFinite(arc.x)
      && Number.isFinite(arc.y)
      && arc.radius > 0
      && arc.start === 0
      && arc.end === Math.PI * 2
    )));

    const expectedArcs = [];
    for (let index = 0; index < inspection.levels.length; index += 1) {
      const level = inspection.levels[index];
      if (level < 0) continue;
      const radius = inspection.layout.cellSize
        / (1 << level)
        * 0.5
        * (1 - options.dotMargin);
      for (const center of subdivisionCentersForGridCell(
        inspection.layout,
        index,
        level,
      )) {
        expectedArcs.push({
          x: center.x,
          y: center.y,
          radius,
          start: 0,
          end: Math.PI * 2,
        });
      }
    }
    const byGeometry = (first, second) => (
      first.x - second.x
      || first.y - second.y
      || first.radius - second.radius
    );
    assert.deepEqual(
      [...context.arcs].sort(byGeometry),
      expectedArcs.sort(byGeometry),
      strategy,
    );
    generator.dispose();
    assert.equal(generator.inspect().levels.length, 0);
  }
});

test("the three registered grid-scene types honor the complete lifecycle", () => {
  const cases = ["inference-loop", "voronoi", "life-like"];
  for (const strategy of cases) {
    const options = normalizedOptionsFor(strategy);
    const generator = createGeneratorForStrategy(strategy);
    assert.equal(generator.inspect().active, false);
    assert.equal(generator.inspect().sceneKey, null);

    generator.enter();
    assert.equal(generator.inspect().active, true);
    generator.update({ compositionDt: options.cycleSeconds * 0.2 });
    generator.update({ compositionDt: options.flipSeconds * 0.5 });
    const context = recordingContext();
    generator.draw({}, {}, context);
    assert.ok(context.arcs.length > 0, strategy);

    generator.exit();
    assert.equal(generator.inspect().active, false);
    generator.enter();
    const reset = generator.inspect();
    assert.equal(reset.active, true);
    assert.equal(reset.cycleIndex, 0);
    assert.equal(reset.cycleProgress, 0);
    assert.equal(reset.sceneKey, null);
    assert.ok(reset.levels.every(level => level === EMPTY_GRID_FACE_LEVEL));

    generator.update({ compositionDt: options.cycleSeconds * 0.35 });
    generator.resize({ width: 390, height: 844 });
    const portrait = generator.inspect();
    assert.ok(portrait.layout.rows > portrait.layout.columns, strategy);
    assert.equal(
      portrait.levels.length,
      portrait.layout.columns * portrait.layout.rows,
    );
    assert.ok(portrait.levels.every(level => level === EMPTY_GRID_FACE_LEVEL));

    generator.dispose();
    assert.equal(generator.inspect().active, false);
    assert.equal(generator.inspect().levels.length, 0);
    generator.dispose();
    assert.throws(() => generator.enter(), /disposed/);
  }
});

test("grid-scene generators seek to an absolute project timeline deterministically", () => {
  const options = normalizedOptionsFor("inference-loop");
  const targetTime = options.cycleSeconds * 3.35;
  const first = createGeneratorForStrategy("inference-loop");
  const second = createGeneratorForStrategy("inference-loop");
  assert.equal(first.seek(targetTime), true);
  assert.equal(second.seek(targetTime), true);
  const firstState = first.inspect();
  const secondState = second.inspect();
  assert.equal(firstState.cycleIndex, 3);
  assert.ok(Math.abs(firstState.cycleProgress - 0.35) < 1e-9);
  assert.equal(firstState.sceneKey, secondState.sceneKey);
  assert.deepEqual([...firstState.levels], [...secondState.levels]);
  assert.deepEqual([...firstState.flipProgress], [...secondState.flipProgress]);
});

test("color-only face changes use the same flip instead of easing", () => {
  const options = normalizedOptionsFor("inference-loop");
  const layout = createCircleGridSceneLayout(LANDSCAPE, options.longSideCells);
  const span = INFERENCE_LOOP_PHASES.parallelEnd / options.stepCount;
  const first = createInferenceGridSceneAt({
    strategy: "inference-loop",
    layout,
    cycleIndex: 0,
    progress: span * 1.25,
    options,
  });
  const second = createInferenceGridSceneAt({
    strategy: "inference-loop",
    layout,
    cycleIndex: 0,
    progress: span * 2.25,
    options,
  });
  const colorOnlyIndex = first.faces.findIndex((face, index) => (
    face.level >= 0
    && face.level === second.faces[index].level
    && face.paletteStep !== second.faces[index].paletteStep
  ));
  assert.ok(colorOnlyIndex >= 0);

  const generator = createGeneratorForStrategy(
    "inference-loop",
    {
      overrides: {
        palette: "green",
        cellTransitions: {
          ...SETTINGS.inferenceLoop.cellTransitions,
          enabled: false,
        },
      },
      palettes: GREEN_PALETTES,
    },
  );
  generator.enter();
  generator.update({ compositionDt: options.cycleSeconds * span * 1.25 });
  generator.update({ compositionDt: options.flipSeconds });
  const targetTime = options.cycleSeconds * span * 2.25;
  generator.update({ compositionDt: targetTime - generator.elapsed });
  assert.equal(generator.inspect().flipProgress[colorOnlyIndex], 0.5);
});

test("logical palette steps map to four distinct configured swatches", () => {
  const generator = createGeneratorForStrategy(
    "inference-loop",
    { overrides: { palette: "green" }, palettes: GREEN_PALETTES },
  );
  const colors = Array.from(
    { length: GRID_FACE_PALETTE_STEP_COUNT },
    (_, step) => generator.paletteColorStep(step),
  );
  assert.equal(new Set(colors).size, GRID_FACE_PALETTE_STEP_COUNT);

  for (const strategy of Object.keys(SETTINGS_BY_STRATEGY)) {
    for (const progress of [0.04, 0.2, 0.58, 0.7, 0.82, 0.96]) {
      assert.ok(sceneAt(strategy, progress).faces.every(face => (
        face.paletteStep >= 0
        && face.paletteStep < GRID_FACE_PALETTE_STEP_COUNT
      )));
    }
  }
});

test("registered grid-scene generators validate strategy, timing, and options", () => {
  assert.throws(
    () => constructGenerator(
      InferenceGridGenerator,
      "inference-grid",
      "mind-reader",
      {},
    ),
    /does not support strategy.*mind-reader/,
  );
  assert.throws(
    () => constructGenerator(
      InferenceGridGenerator,
      "inference-grid",
      "inference-loop",
      { stepCount: 0 },
    ),
    /stepCount/,
  );
  assert.throws(
    () => constructGenerator(
      InferenceGridGenerator,
      "inference-grid",
      "inference-loop",
      { cycleSeconds: 0.5, flipSeconds: 0.2 },
    ),
    /shortest display hold/,
  );
  assert.throws(
    () => constructGenerator(
      InferenceGridGenerator,
      "inference-grid",
      "inference-loop",
      { cycleSeconds: 1, flipSeconds: 0.081 },
    ),
    /shortest display hold/,
  );
  assert.throws(
    () => constructGenerator(
      InferenceGridGenerator,
      "inference-grid",
      "inference-loop",
      { palette: "missing" },
    ),
    /Unknown palette/,
  );
  assert.throws(
    () => constructGenerator(
      InferenceGridGenerator,
      "inference-grid",
      "inference-loop",
      { palette: "short" },
      { ...GREEN_PALETTES, short: ["#000000", "#ffffff"] },
    ),
    /at least 4 colors/,
  );
  assert.throws(
    () => constructGenerator(
      InferenceGridGenerator,
      "inference-grid",
      "tool-loop",
      { longSideCells: 3 },
    ),
    /at least 5 long-side cells/,
  );
  assert.throws(
    () => constructGenerator(
      ProceduralTopologyGenerator,
      "procedural-topology",
      "voronoi",
      { siteCount: 1 },
    ),
    /siteCount/,
  );
  assert.throws(
    () => constructGenerator(
      ProceduralTopologyGenerator,
      "procedural-topology",
      "voronoi",
      { boundaryWhitespace: 0.8 },
    ),
    /boundaryWhitespace/,
  );
  assert.throws(
    () => constructGenerator(
      CellularAutomataGenerator,
      "cellular-automata",
      "life-like",
      { initialDensity: 1 },
    ),
    /initialDensity/,
  );
  assert.throws(
    () => constructGenerator(
      InferenceGridGenerator,
      "inference-grid",
      "inference-loop",
      { longSideCells: 0 },
    ),
    /longSideCells/,
  );
  assert.throws(
    () => constructGenerator(
      CellularAutomataGenerator,
      "cellular-automata",
      "life-like",
      { birthNeighbors: [3, 9] },
    ),
    /birthNeighbors/,
  );

  const layout = createCircleGridSceneLayout(LANDSCAPE, 9);
  assert.throws(
    () => createInferenceGridSceneAt({
      strategy: "voronoi",
      layout,
      cycleIndex: 0,
      progress: 0,
      options: normalizedOptionsFor("voronoi"),
    }),
    /inference-grid.*does not support strategy "voronoi"/,
  );
});

test("catalog maps public compositions to explicit instances, types, settings, and strategies", () => {
  const catalog = createCatalog({ palettes: PALETTES });
  assert.equal(catalog.generatorTypes.has("thinking"), false);
  assert.equal(catalog.generatorTypes.has("inference-grid"), true);
  assert.equal(catalog.generatorTypes.has("procedural-topology"), true);
  assert.equal(catalog.generatorTypes.has("cellular-automata"), true);

  const cases = [
    [
      "inference-loop",
      "inferenceLoopGrid",
      "inference-grid",
      "inferenceLoop",
      "inference-loop",
      InferenceGridGenerator,
    ],
    [
      "thinking",
      "inferenceLoopGrid",
      "inference-grid",
      "inferenceLoop",
      "inference-loop",
      InferenceGridGenerator,
    ],
    [
      "context-window",
      "contextWindowGrid",
      "inference-grid",
      "contextWindow",
      "context-window",
      InferenceGridGenerator,
    ],
    [
      "tool-loop",
      "toolLoopGrid",
      "inference-grid",
      "toolLoop",
      "tool-loop",
      InferenceGridGenerator,
    ],
    [
      "voronoi",
      "voronoiGrid",
      "procedural-topology",
      "voronoi",
      "voronoi",
      ProceduralTopologyGenerator,
    ],
    [
      "l-tree",
      "lTreeGrid",
      "procedural-topology",
      "lTree",
      "l-tree",
      ProceduralTopologyGenerator,
    ],
    [
      "game-of-life",
      "gameOfLifeAutomaton",
      "cellular-automata",
      "gameOfLife",
      "life-like",
      CellularAutomataGenerator,
    ],
  ];
  for (const [
    compositionId,
    generatorId,
    generatorType,
    settingsKey,
    strategy,
    Generator,
  ] of cases) {
    assert.deepEqual(
      COMPOSITION_DEFINITIONS[compositionId].steps,
      [{ use: generatorId }],
    );
    const definition = GENERATOR_DEFINITIONS[generatorId];
    assert.equal(definition.type, generatorType);
    assert.equal(definition.settingsKey, settingsKey);
    assert.equal(definition.strategy, strategy);
    const generator = catalog.generatorTypes.create(generatorType, {
      name: generatorId,
      definition,
      settingsKey,
      options: SETTINGS[settingsKey],
      settings: SETTINGS,
      runtime: { viewport: () => LANDSCAPE },
    });
    assert.ok(generator instanceof Generator);
    const inspection = generator.inspect();
    assert.equal(inspection.generatorInstanceId, generatorId);
    assert.equal(inspection.generatorType, generatorType);
    assert.equal(inspection.settingsKey, settingsKey);
    assert.equal(inspection.strategy, strategy);
    generator.dispose();
  }
});
