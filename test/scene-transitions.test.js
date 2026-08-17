import test from "node:test";
import assert from "node:assert/strict";

import { GLOBAL_CONFIG, SETTINGS } from "../config.js";
import { InferenceGridGenerator } from "../src/generators/inference-grid-generator.js";
import {
  SceneTransition,
  createSceneTransitionModeRegistry,
  resolveSceneTransitionSettings,
} from "../src/scene-transitions/index.js";
import { SortSelectionTransitionMode } from "../src/cell-transitions/sort-selection.js";
import { resolveCellTransitionSettings } from "../src/cell-transitions/transition-settings.js";
import {
  CellStateTransition,
  createCellTransitionModeRegistry,
} from "../src/cell-transitions/index.js";

const LAYOUT = Object.freeze({
  columns: 5,
  rows: 1,
  cellSize: 100,
  offsetX: 0,
  offsetY: 20,
});

test("cycle-boundary and between-state transition settings resolve independently", () => {
  const resolved = resolveSceneTransitionSettings(
    {
      enabled: true,
      mode: "sort-selection",
      durationSeconds: 0.7,
      modes: {
        "sort-selection": {
          seed: 91,
          revealFraction: 0.16,
          arcHeightInCells: 0.32,
        },
      },
    },
    {
      modes: {
        "sort-selection": { revealFraction: 0.25 },
      },
    },
  );

  assert.equal(resolved.enabled, true);
  assert.equal(Object.hasOwn(resolved, "trigger"), false);
  assert.equal(resolved.durationSeconds, 0.7);
  assert.deepEqual(resolved.modes["sort-selection"], {
    seed: 91,
    revealFraction: 0.25,
    arcHeightInCells: 0.32,
    staggerSeconds: 0,
    timingCurve: [0.65, 0, 0.35, 1],
  });
  assert.throws(
    () => resolveSceneTransitionSettings({}, { trigger: "state" }),
    /trigger was removed/,
  );
  const cellTransitions = resolveCellTransitionSettings(
    GLOBAL_CONFIG.cellTransitions,
    { durationSeconds: 0.25 },
  );
  assert.equal(cellTransitions.mode, GLOBAL_CONFIG.cellTransitions.mode);
  assert.equal(cellTransitions.durationSeconds, 0.25);
  assert.deepEqual(
    cellTransitions.modes["sort-selection"],
    GLOBAL_CONFIG.cellTransitions.modes["sort-selection"],
  );
  assert.equal(SETTINGS.lTree.cellTransitions.mode, GLOBAL_CONFIG.cellTransitions.mode);
  assert.equal(Object.hasOwn(SETTINGS.base.intro, "trigger"), false);
  assert.equal(SETTINGS.lTree.outro.fallbackToIntro, true);
  assert.equal(SETTINGS.lTree.outro.mode, SETTINGS.lTree.intro.mode);
  assert.equal(
    SETTINGS.lTree.outro.durationSeconds,
    SETTINGS.lTree.intro.durationSeconds,
  );
  assert.equal(
    SETTINGS.base.intro.modes["sort-selection"].seed,
    SETTINGS.lTree.intro.modes["sort-selection"].seed,
  );
});

test("every configured cell-transition mode supports discrete scene states", () => {
  const registry = createCellTransitionModeRegistry();
  const presentations = new Map();
  const items = [
    { id: "a", x: 100, y: 100, size: 80 },
    { id: "b", x: 300, y: 100, size: 40 },
    { id: "c", x: 500, y: 100, size: 20 },
  ];
  const fromItems = [
    { id: "old-a", x: 80, y: 40, size: 20 },
    { id: "old-b", x: 240, y: 60, size: 40 },
    { id: "old-c", x: 420, y: 80, size: 80 },
  ];

  for (const mode of Object.keys(GLOBAL_CONFIG.cellTransitions.modes)) {
    const transition = new CellStateTransition({
      settings: {
        ...GLOBAL_CONFIG.cellTransitions,
        enabled: true,
        mode,
        durationSeconds: 1,
      },
      modeRegistry: registry,
    });
    assert.equal(transition.begin({ items, fromItems, layout: LAYOUT }), true);
    transition.update(0.5);
    const presentation = transition.presentationFor("a");
    assert.ok(Number.isFinite(presentation.offsetX), mode);
    assert.ok(Number.isFinite(presentation.offsetY), mode);
    assert.ok(Number.isFinite(presentation.opacity), mode);
    assert.ok(Number.isFinite(presentation.scale), mode);
    presentations.set(mode, presentation);
  }
  assert.deepEqual(presentations.get("none"), {
    offsetX: 0,
    offsetY: 0,
    opacity: 1,
    scale: 1,
  });
});

test("sort-selection deterministically shuffles, swaps, and lands on target cells", () => {
  const mode = new SortSelectionTransitionMode({
    seed: 12,
    revealFraction: 0.2,
    arcHeightInCells: 0.3,
  });
  const event = {
    indices: [0, 1, 2, 3, 4],
    layout: LAYOUT,
    key: "demo-state",
  };
  const first = mode.createPlan(event);
  const repeated = mode.createPlan(event);
  assert.deepEqual(first.steps, repeated.steps);
  assert.deepEqual(
    [...first.initialSlotByOrder],
    [...repeated.initialSlotByOrder],
  );

  const start = event.indices.map(index => mode.presentationAt(first, index, 0));
  assert.ok(start.some(presentation => presentation.offsetX !== 0));
  assert.ok(start.every(presentation => presentation.opacity === 0));
  assert.ok(start.every((presentation, index) => {
    const targetX = (index + 0.5) * LAYOUT.cellSize;
    const targetY = LAYOUT.offsetY + LAYOUT.cellSize * 0.5;
    const x = targetX + presentation.offsetX;
    const y = targetY + presentation.offsetY;
    return x < LAYOUT.offsetX
      || x > LAYOUT.offsetX + LAYOUT.columns * LAYOUT.cellSize
      || y < LAYOUT.offsetY
      || y > LAYOUT.offsetY + LAYOUT.rows * LAYOUT.cellSize;
  }));

  const middle = event.indices.map(index => mode.presentationAt(first, index, 0.5));
  assert.ok(middle.some(presentation => presentation.opacity === 1));
  assert.ok(middle.some(presentation => presentation.opacity === 0));
  assert.ok(middle.some(presentation => (
    presentation.offsetX !== 0 || presentation.offsetY !== 0
  )));

  assert.deepEqual(
    event.indices.map(index => mode.presentationAt(first, index, 1)),
    event.indices.map(() => ({
      offsetX: 0,
      offsetY: 0,
      opacity: 1,
      scale: 1,
    })),
  );
});

test("sort-selection staggers movements and applies CSS cubic-bezier easing", () => {
  const options = {
    seed: 12,
    revealFraction: 0.2,
    arcHeightInCells: 0,
    staggerSeconds: 0.1,
  };
  const linear = new SortSelectionTransitionMode({
    ...options,
    timingCurve: [0, 0, 1, 1],
  });
  const accelerated = new SortSelectionTransitionMode({
    ...options,
    timingCurve: [0.8, 0, 1, 1],
  });
  const event = {
    indices: [0, 1, 2, 3, 4],
    layout: LAYOUT,
    key: "staggered",
    durationSeconds: 1,
  };
  const linearPlan = linear.createPlan(event);
  const acceleratedPlan = accelerated.createPlan(event);
  assert.equal(linearPlan.requestedStaggerSeconds, 0.1);
  assert.ok(linearPlan.staggerSeconds > 0);
  assert.ok(linearPlan.staggerSeconds < 0.1);
  assert.ok(linearPlan.staggerSpanSeconds > 0);
  assert.ok(linearPlan.movementDurationSeconds < 0.2);
  const denserStagger = new SortSelectionTransitionMode({
    ...options,
    staggerSeconds: 0.5,
  }).createPlan(event);
  assert.ok(denserStagger.staggerSpanSeconds > linearPlan.staggerSpanSeconds);
  assert.ok(denserStagger.movementDurationSeconds < linearPlan.movementDurationSeconds);

  const targetOrder = 0;
  const targetId = event.indices[targetOrder];
  const segment = linearPlan.segmentsByOrder[targetOrder][0];
  const localProgress = 0.25;
  const elapsedSeconds = segment.step * (
    linearPlan.movementDurationSeconds + linearPlan.staggerSeconds
  ) + linearPlan.movementDurationSeconds * localProgress;
  const progress = elapsedSeconds / linearPlan.totalDurationSeconds;
  const positionFor = (mode, plan) => {
    const presentation = mode.presentationAt(plan, targetId, progress);
    const target = plan.targets[targetOrder];
    return {
      x: target.x + presentation.offsetX,
      y: target.y + presentation.offsetY,
    };
  };
  const projectedProgress = (point) => {
    const deltaX = segment.end.x - segment.start.x;
    const deltaY = segment.end.y - segment.start.y;
    return (
      (point.x - segment.start.x) * deltaX
      + (point.y - segment.start.y) * deltaY
    ) / (deltaX * deltaX + deltaY * deltaY);
  };

  assert.ok(Math.abs(projectedProgress(positionFor(linear, linearPlan)) - 0.25) < 1e-6);
  assert.ok(
    projectedProgress(positionFor(accelerated, acceleratedPlan)) < 0.25,
  );
  assert.throws(
    () => new SortSelectionTransitionMode({ staggerSeconds: -0.01 }),
    /staggerSeconds must be finite and non-negative/,
  );
  assert.throws(
    () => new SortSelectionTransitionMode({ timingCurve: [2, 0, 1, 1] }),
    /X control points/,
  );
});

test("sort-selection uses the previous state as its visible source arrangement", () => {
  const mode = new SortSelectionTransitionMode({ seed: 12 });
  const targets = [
    { id: "new-a", x: 100, y: 100, size: 80 },
    { id: "new-b", x: 300, y: 100, size: 40 },
    { id: "new-c", x: 500, y: 100, size: 20 },
  ];
  const sources = [
    { id: "old-a", x: 80, y: 40, size: 20 },
    { id: "old-b", x: 280, y: 40, size: 40 },
    { id: "old-c", x: 480, y: 40, size: 80 },
  ];
  const plan = mode.createPlan({
    items: targets,
    fromItems: sources,
    layout: { width: 600, height: 200 },
    key: "state-change",
  });
  const start = targets.map(target => {
    const presentation = mode.presentationAt(plan, target.id, 0);
    return {
      x: target.x + presentation.offsetX,
      y: target.y + presentation.offsetY,
      size: target.size * presentation.scale,
      opacity: presentation.opacity,
    };
  });

  assert.deepEqual(
    start.map(point => [point.x, point.y, point.size]).sort(),
    sources.map(point => [point.x, point.y, point.size]).sort(),
  );
  assert.ok(start.every(point => point.opacity === 1));
});

test("intro and outro reuse the same registered mode name in opposite directions", () => {
  const settings = {
    enabled: true,
    mode: "sort-selection",
    durationSeconds: 1,
    modes: {
      "sort-selection": {
        seed: 9,
        revealFraction: 0.2,
        arcHeightInCells: 0.3,
      },
    },
  };
  const event = { indices: [0, 1, 2], layout: LAYOUT, key: "shared-mode" };
  const intro = new SceneTransition({
    direction: "intro",
    settings,
    modeRegistry: createSceneTransitionModeRegistry(),
  });
  const outro = new SceneTransition({
    direction: "outro",
    settings,
    modeRegistry: createSceneTransitionModeRegistry(),
  });

  intro.begin(event);
  outro.begin(event);
  assert.equal(intro.inspect().mode, "sort-selection");
  assert.equal(outro.inspect().mode, "sort-selection");
  assert.equal(intro.presentationFor(0).opacity, 0);
  assert.deepEqual(outro.presentationFor(0), {
    offsetX: 0,
    offsetY: 0,
    opacity: 1,
    scale: 1,
  });

  intro.update(1);
  outro.update(1);
  assert.deepEqual(intro.presentationFor(0), {
    offsetX: 0,
    offsetY: 0,
    opacity: 1,
    scale: 1,
  });
  assert.equal(outro.presentationFor(0).opacity, 0);
});

function inferenceGenerator({ cellTransitions = true, outro = false } = {}) {
  return new InferenceGridGenerator({
    name: "transition-separation",
    definition: {
      type: "inference-grid",
      settingsKey: "inferenceLoop",
      strategy: "inference-loop",
    },
    settingsKey: "inferenceLoop",
    options: {
      ...SETTINGS.inferenceLoop,
      intro: {
        ...SETTINGS.inferenceLoop.intro,
        durationSeconds: 1,
      },
      cellTransitions: {
        ...SETTINGS.inferenceLoop.cellTransitions,
        enabled: cellTransitions,
        durationSeconds: 0.7,
      },
      outro: {
        ...SETTINGS.inferenceLoop.outro,
        enabled: outro,
        fallbackToIntro: false,
        durationSeconds: 0.25,
      },
    },
    runtime: { viewport: () => ({ width: 900, height: 600 }) },
    palettes: {
      green: ["#005122", "#008a3a", "#00b63c", "#7fd3a5"],
    },
  });
}

test("cell transitions run between states without replaying or pausing the intro", () => {
  const generator = inferenceGenerator({ cellTransitions: true });
  generator.enter();
  generator.update({ compositionDt: 0 });
  const initialState = generator.inspect();
  const firstStateKey = initialState.intro.key;
  const visibleParents = [...initialState.levels].filter(level => level >= 0).length;
  const visibleGlyphs = [...initialState.levels].reduce(
    (count, level) => count + (level < 0 ? 0 : 1 << (level * 2)),
    0,
  );
  assert.equal(initialState.intro.itemCount, visibleGlyphs);
  assert.equal(initialState.intro.startsOffscreen, true);
  assert.equal(initialState.intro.sourceItemCount, 0);
  assert.ok(visibleGlyphs > visibleParents);
  generator.update({ compositionDt: 0.1 });
  assert.equal(generator.inspect().intro.progress, 0.1);
  assert.equal(generator.inspect().cycleElapsed, 0);
  generator.update({ compositionDt: 0.9 });
  assert.equal(generator.inspect().timelinePhase, "cycle");
  assert.equal(generator.inspect().cycleElapsed, 0);

  generator.update({ compositionDt: 0.5 });
  const betweenStates = generator.inspect();
  assert.equal(betweenStates.intro.key, firstStateKey);
  assert.equal(betweenStates.intro.progress, 1);
  assert.equal(betweenStates.cellTransition.active, true);
  assert.equal(Object.hasOwn(betweenStates.cellTransition, "direction"), false);
  assert.equal(betweenStates.cellTransition.progress, 0);
  assert.equal(betweenStates.cellTransition.startsOffscreen, false);
  assert.ok(betweenStates.cellTransition.sourceItemCount > 0);
  assert.equal(betweenStates.timelinePhase, "cycle");
  assert.equal(betweenStates.cycleElapsed, 0.5);
  const movingId = generator.cellTransition.plan.targets[0].id;
  const startingPresentation = generator.cellTransition.presentationFor(movingId);

  generator.update({ compositionDt: 0.1 });
  assert.ok(generator.inspect().cellTransition.progress > 0);
  assert.equal(generator.scenePresentationTransition, generator.cellTransition);
  assert.notDeepEqual(
    generator.cellTransition.presentationFor(movingId),
    startingPresentation,
  );
  assert.equal(generator.inspect().cycleElapsed, 0.6);
  assert.equal(generator.animationDuration(), generator.options.cycleSeconds + 1);

  generator.update({ compositionDt: generator.options.cycleSeconds - 0.6 });
  assert.equal(generator.inspect().timelinePhase, "intro");
  assert.notEqual(generator.inspect().intro.key, firstStateKey);
  assert.equal(generator.inspect().cycleElapsed, generator.options.cycleSeconds);
});

test("outro, next intro, and cycle occupy consecutive timeline phases", () => {
  const generator = inferenceGenerator({ outro: true });
  generator.enter();
  generator.update({ compositionDt: 0 });
  generator.update({ compositionDt: 1 });
  assert.equal(generator.inspect().timelinePhase, "cycle");
  assert.equal(generator.inspect().cycleElapsed, 0);

  generator.update({ compositionDt: generator.options.cycleSeconds - 0.01 });
  assert.equal(generator.inspect().timelinePhase, "cycle");
  generator.update({ compositionDt: 0.01 });
  assert.equal(generator.inspect().timelinePhase, "outro");
  assert.ok(generator.inspect().outro.progress < 1e-9);

  generator.update({ compositionDt: 0.25 });
  assert.equal(generator.inspect().timelinePhase, "intro");
  assert.equal(generator.inspect().cycleIndex, 1);
  assert.ok(generator.inspect().intro.progress < 1e-9);
  generator.update({ compositionDt: 1 });
  assert.equal(generator.inspect().timelinePhase, "cycle");
  assert.equal(
    generator.animationDuration(),
    generator.options.cycleSeconds + 1.25,
  );
});
