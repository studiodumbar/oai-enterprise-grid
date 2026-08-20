import test from "node:test";
import assert from "node:assert/strict";

import { GLOBAL_CONFIG, SETTINGS } from "../config.js";
import { InferenceGridGenerator } from "../src/generators/inference-grid-generator.js";
import {
  SceneTransition,
  createSceneTransitionModeRegistry,
  resolveSceneTransitionSettings,
} from "../src/scene-transitions/index.js";
import { FadeArrangementMode } from "../src/transitions/fade.js";
import {
  TextRevealArrangementMode,
} from "../src/transitions/text-reveal.js";
import { captureDebug } from "../src/debug/index.js";
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
  // A composition that authors no outro takes the app-wide one when there is
  // one, and otherwise replays its own intro backward.
  const appWideOutro = GLOBAL_CONFIG.outro !== undefined;
  assert.equal(SETTINGS.lTree.outro.fallbackToIntro, !appWideOutro);
  assert.equal(
    SETTINGS.lTree.outro.durationSeconds,
    appWideOutro
      ? GLOBAL_CONFIG.outro.durationSeconds
      : SETTINGS.lTree.intro.durationSeconds,
  );
  assert.deepEqual(
    SETTINGS.base.intro.modes[GLOBAL_CONFIG.intro.mode],
    SETTINGS.lTree.intro.modes[GLOBAL_CONFIG.intro.mode],
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
    mode: "fade",
    durationSeconds: 1,
    modes: { fade: { revealFraction: 0.5, timingCurve: [0, 0, 1, 1] } },
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
  assert.equal(intro.inspect().mode, "fade");
  assert.equal(outro.inspect().mode, "fade");
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

test("scene transitions reject unresolved automatic durations before frame arithmetic", () => {
  assert.throws(
    () => new SceneTransition({
      direction: "intro",
      settings: { enabled: false, durationSeconds: "auto" },
      modeRegistry: createSceneTransitionModeRegistry(),
    }),
    /durationSeconds must resolve to a number before construction/,
  );
});

test("the arrangement pool refuses a phase a mode does not declare", () => {
  const registry = createSceneTransitionModeRegistry();
  assert.deepEqual(registry.namesForPhase("intro"), ["fade", "text"]);
  assert.deepEqual(registry.namesForPhase("state"), ["fade", "sort-selection"]);
  assert.equal(registry.supports("text", "outro"), true);
  assert.equal(registry.supports("text", "state"), false);
  assert.equal(registry.supports("fade", "outro"), true);
  assert.equal(registry.supports("sort-selection", "outro"), false);
  assert.throws(
    () => registry.supports("fade", "cycle"),
    /Arrangement phase must be one of intro, outro, state/,
  );

  for (const direction of ["intro", "outro"]) {
    assert.throws(
      () => new SceneTransition({
        direction,
        settings: { enabled: true, mode: "sort-selection", durationSeconds: 1 },
        modeRegistry: createSceneTransitionModeRegistry(),
      }),
      new RegExp(
        `"sort-selection" does not support the "${direction}" phase\\. `
        + 'Modes available for "' + direction + '": fade, text',
      ),
    );
  }
  assert.throws(
    () => new SceneTransition({
      direction: "intro",
      settings: { enabled: true, mode: "spin", durationSeconds: 1 },
      modeRegistry: createSceneTransitionModeRegistry(),
    }),
    /mode "spin" has no settings block/,
  );
});

test("fade reveals the source pose, then crossfades into the target pose", () => {
  const mode = new FadeArrangementMode({
    revealFraction: 0.5,
    timingCurve: [0, 0, 1, 1],
  });
  const targets = [
    { id: "a", x: 100, y: 70, size: 20 },
    { id: "b", x: 300, y: 70, size: 20 },
    { id: "c", x: 500, y: 70, size: 20 },
  ];
  const circle = { id: "circle:0:0", x: 250, y: 70, size: 100 };
  const plan = mode.createPlan({
    items: targets,
    fromItems: [circle],
    layout: LAYOUT,
    key: "endpoint",
    durationSeconds: 1,
  });
  assert.equal(plan.sourceItemCount, 1);
  assert.equal(plan.unpairedSources, 0);
  assert.equal(plan.fadeIn, false);

  const posesAt = progress => targets.flatMap(target => mode
    .presentationsAt(plan, target.id, progress)
    .map(presentation => ({
      x: target.x + presentation.offsetX,
      y: target.y + presentation.offsetY,
      size: target.size * presentation.scale,
      opacity: presentation.opacity,
    })));

  // Nothing is on screen at the start of the phase.
  assert.ok(posesAt(0).every(pose => pose.opacity === 0));

  // Halfway through, the circle alone is at full strength.
  const revealed = posesAt(0.5);
  const visible = revealed.filter(pose => pose.opacity > 0);
  assert.deepEqual(visible, [{ x: 250, y: 70, size: 100, opacity: 1 }]);

  // Then the circle and the composition trade places without moving.
  const crossfading = posesAt(0.75).filter(pose => pose.opacity > 0);
  assert.deepEqual(crossfading, [
    { x: 250, y: 70, size: 100, opacity: 0.5 },
    { x: 100, y: 70, size: 20, opacity: 0.5 },
    { x: 300, y: 70, size: 20, opacity: 0.5 },
    { x: 500, y: 70, size: 20, opacity: 0.5 },
  ]);

  assert.deepEqual(
    targets.map(target => mode.presentationsAt(plan, target.id, 1)),
    targets.map(() => [{ offsetX: 0, offsetY: 0, opacity: 1, scale: 1 }]),
  );
  // With nothing to reveal the phase is a plain fade-in of the target scene.
  const withoutSources = mode.createPlan({ items: targets, layout: LAYOUT });
  assert.equal(withoutSources.revealFraction, 0);
  assert.equal(withoutSources.fadeIn, true);
  assert.equal(mode.presentationAt(withoutSources, "a", 0.5).opacity, 0.5);
  assert.throws(
    () => new FadeArrangementMode({ revealFraction: 1 }),
    /revealFraction must be at least zero and below one/,
  );
});

test("fade carries every source and draws each target pose once", () => {
  const mode = new FadeArrangementMode({
    revealFraction: 0.5,
    timingCurve: [0, 0, 1, 1],
  });
  const sources = Array.from({ length: 5 }, (_, index) => ({
    id: `circle:${index}`,
    x: 200 + index * 25,
    y: 70,
    size: 25,
  }));
  const targets = [
    { id: "a", x: 100, y: 70, size: 20 },
    { id: "b", x: 300, y: 70, size: 20 },
  ];
  const plan = mode.createPlan({
    items: targets,
    fromItems: sources,
    layout: LAYOUT,
    durationSeconds: 1,
  });
  // A source set larger than the target set is distributed, not dropped.
  assert.equal(plan.unpairedSources, 0);
  const revealed = targets.flatMap(target => mode
    .presentationsAt(plan, target.id, 0.5)
    .filter(presentation => presentation.opacity > 0)
    .map(presentation => target.x + presentation.offsetX));
  assert.deepEqual(revealed.sort((a, b) => a - b), sources.map(source => source.x));

  // Duplicated destinations exist only to consume extra sources, so the shared
  // pose must not be drawn — and faded up — once per duplicate.
  const padded = mode.createPlan({
    items: [
      { id: "a", x: 100, y: 70, size: 20 },
      { id: "padded:a", x: 100, y: 70, size: 20 },
    ],
    fromItems: sources.slice(0, 2),
    layout: LAYOUT,
    durationSeconds: 1,
  });
  const targetPoses = ["a", "padded:a"].flatMap(id => mode
    .presentationsAt(padded, id, 0.75)
    .filter(presentation => presentation.offsetX === 0 && presentation.offsetY === 0));
  assert.deepEqual(targetPoses, [{ offsetX: 0, offsetY: 0, opacity: 0.5, scale: 1 }]);
});

function inferenceGenerator({
  cellTransitions = true,
  outro = false,
  compositionEndpoints = false,
} = {}) {
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
        // The phase mechanics under test are independent of whether the
        // app-wide intro happens to be switched on.
        enabled: true,
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
      circleEndpoints: {
        ...SETTINGS.inferenceLoop.circleEndpoints,
        // These tests exercise generator-owned lifecycle phases, so app-wide
        // endpoint toggles must not suppress the phases under test.
        start: {
          ...SETTINGS.inferenceLoop.circleEndpoints.start,
          enabled: compositionEndpoints,
          mode: "native",
        },
        end: {
          ...SETTINGS.inferenceLoop.circleEndpoints.end,
          enabled: compositionEndpoints,
          mode: compositionEndpoints ? "dijkstra" : "native",
        },
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

test("composition endpoints replace the matching generator lifecycle phases", () => {
  const generator = inferenceGenerator({
    outro: true,
    compositionEndpoints: true,
  });
  generator.enter();
  generator.update({
    compositionDt: 0,
    compositionEndpoint: {
      phase: "start",
      progress: 0,
      durationSeconds: 1,
      cycleIndex: 0,
    },
  });
  assert.equal(generator.inspect().timelinePhase, "cycle");
  assert.equal(generator.inspect().intro.active, false);
  assert.equal(generator.animationDuration(), generator.options.cycleSeconds);

  generator.update({
    compositionDt: generator.options.cycleSeconds,
    compositionEndpoint: null,
  });
  const nextCycle = generator.inspect();
  assert.equal(nextCycle.cycleIndex, 1);
  assert.equal(nextCycle.cycleElapsed, generator.options.cycleSeconds);
  assert.equal(nextCycle.timelinePhase, "cycle");
  assert.equal(nextCycle.intro.active, false);
  assert.equal(nextCycle.outro.active, false);
});

function recordingContext() {
  return {
    globalAlpha: 1,
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    dots: [],
    rects: [],
    texts: [],
    order: [],
    alphaStack: [],
    save() {
      this.alphaStack.push(this.globalAlpha);
    },
    restore() {
      this.globalAlpha = this.alphaStack.pop() ?? 1;
    },
    beginPath() {},
    moveTo() {},
    arc(x, y, radius) {
      this.dots.push({
        x,
        y,
        radius,
        opacity: this.globalAlpha,
        fillStyle: this.fillStyle,
      });
      this.order.push("dot");
    },
    fill() {},
    fillRect(x, y, width, height) {
      this.rects.push({ x, y, width, height, fillStyle: this.fillStyle });
      this.order.push("rect");
    },
    fillText(text, x, y) {
      this.texts.push({
        text,
        x,
        y,
        opacity: this.globalAlpha,
        fillStyle: this.fillStyle,
        font: this.font,
        align: this.textAlign,
        baseline: this.textBaseline,
      });
      this.order.push("text");
    },
  };
}

const TEXT_LAYOUT = Object.freeze({ width: 1000, height: 500 });
const TEXT_COLORS = Object.freeze(["#111111", "#555555", "#aaaaaa", "#ffffff"]);

function textMode(overrides = {}) {
  return new TextRevealArrangementMode({
    text: "HELLO",
    levels: 2,
    longSideCells: 5,
    sizeInCells: 1.5,
    visibleSeconds: 1,
    colorDrift: 0,
    colors: TEXT_COLORS,
    backgroundColor: "#000000",
    ...overrides,
  });
}

// levels 2 in a 4-second phase with 1s held: four cascade windows of 0.75s
// around the hold, each holding three steps of 0.25s.
function textPlan(mode = textMode(), durationSeconds = 4) {
  return mode.createPlan({ layout: TEXT_LAYOUT, durationSeconds });
}

test("the text ladder mirrors one cell per subdivision level around the centre", () => {
  const mode = textMode();
  const plan = textPlan(mode);
  // 1000x500 over 5 cells on the long side: 200px parent cells, centre at 500.
  assert.equal(plan.cellSize, 200);
  assert.deepEqual(
    plan.cells.map(cell => [cell.level, cell.x, cell.y]),
    [
      [0, 500, 250],
      [1, 300, 250],
      [1, 700, 250],
      [2, 100, 250],
      [2, 900, 250],
    ],
  );
  // A portrait viewport runs the same ladder along the other axis.
  const portrait = mode.createPlan({
    layout: { width: 500, height: 1000 },
    durationSeconds: 4,
  });
  assert.deepEqual(
    portrait.cells.map(cell => [cell.level, cell.x, cell.y]),
    [
      [0, 250, 500],
      [1, 250, 300],
      [1, 250, 700],
      [2, 250, 100],
      [2, 250, 900],
    ],
  );
  assert.throws(
    () => mode.createPlan({ layout: { width: 0, height: 10 } }),
    /requires layout width and height/,
  );
  assert.throws(() => textMode({ text: "  " }), /text must be a non-empty string/);
  assert.throws(() => textMode({ colorBy: "cell" }), /colorBy must be one of level, dot/);
  assert.throws(() => textMode({ visibleSeconds: -1 }), /visibleSeconds must be finite/);
});

test("the text phase cuts through expand, uncover, hold, cover, collapse", () => {
  const mode = textMode();
  const plan = textPlan(mode);
  const drawAt = progress => {
    const context = recordingContext();
    mode.drawOverlay(plan, progress, context);
    return context;
  };
  const dotSizes = context => [...new Set(
    context.dots.map(dot => Number((dot.radius * 2).toFixed(3))),
  )].sort((first, second) => second - first);

  // Windows of a 4s phase: expand [0, .1875), uncover [.1875, .375),
  // hold [.375, .625), then the same two windows backward.
  assert.deepEqual(
    [plan.expandEnd, plan.holdStart, plan.holdEnd],
    [0.1875, 0.375, 0.625],
  );

  // Expand: one big dot, then a 2x2 cell each side, then a 4x4 each side.
  assert.equal(drawAt(0.02).dots.length, 1);
  assert.equal(drawAt(0.07).dots.length, 1 + 2 * 4);
  const complete = drawAt(0.13);
  assert.equal(complete.dots.length, 1 + 2 * 4 + 2 * 16);
  assert.deepEqual(dotSizes(complete), [184, 92, 46]);
  // Every dot is drawn at full strength — the module never fades.
  assert.ok(complete.dots.every(dot => dot.opacity === 1));
  assert.equal(complete.texts.length, 0);
  // Each cell paints out its whole footprint first, so the string never shows
  // through the gaps between the dots.
  assert.equal(complete.rects.length, 5);
  assert.ok(complete.rects.every(rect => (
    rect.fillStyle === "#000000"
    && rect.width === plan.cellSize
    && rect.height === plan.cellSize
  )));

  // Uncover: the text is behind the cells, which leave centre first.
  const uncovering = drawAt(0.2);
  assert.equal(uncovering.dots.length, 1 + 2 * 4 + 2 * 16);
  assert.equal(uncovering.texts.length, 1);
  assert.equal(uncovering.texts[0].opacity, 1);
  // Drawn before the cells, so the ones still standing cover it.
  assert.ok(uncovering.order.indexOf("text") < uncovering.order.indexOf("rect"));
  const centreGone = drawAt(0.26);
  assert.equal(centreGone.dots.length, 2 * 4 + 2 * 16);
  assert.ok(
    centreGone.dots.every(dot => dot.x !== 500),
    "the centre cell should be gone, not moved",
  );
  assert.equal(drawAt(0.32).dots.length, 2 * 16);
  // Everything is uncovered exactly when the hold starts.
  assert.equal(drawAt(0.375).dots.length, 0);

  // Hold: the text alone.
  const held = drawAt(0.5);
  assert.equal(held.dots.length, 0);
  assert.equal(held.texts.length, 1);

  // Cover: the cells come back outermost first, one step at a time, and the
  // text stays drawn behind them until the last one lands. No jump.
  assert.equal(drawAt(0.63).dots.length, 2 * 16);
  assert.equal(drawAt(0.7).dots.length, 2 * 4 + 2 * 16);
  const covered = drawAt(0.79);
  assert.equal(covered.dots.length, 1 + 2 * 4 + 2 * 16);
  assert.equal(covered.texts.length, 1);
  // Collapse: they leave outermost first, down to the centre dot again.
  assert.equal(drawAt(0.82).texts.length, 0);
  assert.equal(drawAt(0.82).dots.length, 1 + 2 * 4 + 2 * 16);
  assert.equal(drawAt(0.9).dots.length, 1 + 2 * 4);
  const last = drawAt(0.99);
  assert.equal(last.dots.length, 1);
  assert.deepEqual([last.dots[0].x, last.dots[0].y], [500, 250]);
  assert.equal(Number((last.dots[0].radius * 2).toFixed(3)), 184);

  // The second half is the first half backward, which is the whole point.
  for (const progress of [0.02, 0.07, 0.13, 0.2, 0.26, 0.32, 0.37]) {
    assert.equal(
      drawAt(1 - progress).dots.length,
      drawAt(progress).dots.length,
      `progress ${progress} should mirror ${1 - progress}`,
    );
  }

  // Perfectly centered, and the type size is a multiple of the cell.
  assert.deepEqual([held.texts[0].x, held.texts[0].y], [500, 250]);
  assert.equal(held.texts[0].align, "center");
  assert.equal(held.texts[0].baseline, "middle");
  assert.equal(
    held.texts[0].font,
    "700 300px 'OpenAI Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  );

  // Offsets nudge the string off the exact centre without moving the ladder.
  const offset = textMode({ offsetX: -40, offsetY: 12 });
  const offsetContext = recordingContext();
  offset.drawOverlay(textPlan(offset), 0.5, offsetContext);
  assert.deepEqual(
    [offsetContext.texts[0].x, offsetContext.texts[0].y],
    [460, 262],
  );
  assert.throws(
    () => new TextRevealArrangementMode({ colors: TEXT_COLORS }).drawOverlay(
      textPlan(new TextRevealArrangementMode({ colors: TEXT_COLORS })),
      0.02,
      recordingContext(),
    ),
    /no background color to mask with/,
  );
});

test("the held seconds are authored, and clamped to fit the phase", () => {
  const mode = textMode({ visibleSeconds: 2 });
  const roomy = textPlan(mode, 10);
  assert.equal(roomy.holdSeconds, 2);
  assert.ok(Math.abs((roomy.holdEnd - roomy.holdStart) - 0.2) < 1e-9);

  // A phase too short for the authored hold keeps room for the cascade, and
  // says so rather than silently swallowing the cells.
  const lines = captureDebug(["transition"], () => {
    assert.equal(textPlan(mode, 1).holdSeconds, 0.6);
  });
  assert.ok(lines.some(line => line.includes("text hold clamped")), lines.join("\n"));
});

test("text visibleSeconds auto follows the resolved phase hold window", () => {
  const automatic = textMode({ visibleSeconds: "auto" });
  assert.equal(textPlan(automatic, 2).holdSeconds, 1.2);
  assert.equal(textPlan(automatic, 0.5).holdSeconds, 0.3);

  const scaled = textMode({ visibleSeconds: "calc(auto * 0.5)" });
  assert.equal(textPlan(scaled, 2).holdSeconds, 0.6);
  assert.throws(() => textMode({ visibleSeconds: "sometimes" }), /visibleSeconds/);
});

test("the text phase remaps the palette across the ladder and drifts it", () => {
  const byLevel = textMode();
  const context = recordingContext();
  byLevel.drawOverlay(textPlan(byLevel), 0.13, context);
  const colorForSize = (drawn, size) => drawn.dots.find(
    dot => Number((dot.radius * 2).toFixed(3)) === size,
  ).fillStyle;
  // levels 0..2 spread over four colors, and the text takes the last one.
  assert.deepEqual(
    [184, 92, 46].map(size => colorForSize(context, size)),
    ["#111111", "#aaaaaa", "#ffffff"],
  );
  const held = recordingContext();
  byLevel.drawOverlay(textPlan(byLevel), 0.5, held);
  assert.equal(held.texts[0].fillStyle, "#ffffff");

  // Per-dot mapping spreads the palette inside each cell instead.
  const byDot = textMode({ colorBy: "dot" });
  const dotted = recordingContext();
  byDot.drawOverlay(textPlan(byDot), 0.07, dotted);
  const insideOneCell = dotted.dots.filter(dot => dot.x < 400 && dot.x > 200);
  assert.deepEqual(
    insideOneCell.map(dot => dot.fillStyle),
    ["#111111", "#555555", "#aaaaaa", "#ffffff"],
  );

  // colorDrift rotates the whole ramp one entry per cascade step, so the colors
  // travel with the motion instead of standing still.
  const drifting = textMode({ colorDrift: 1 });
  const plan = textPlan(drifting);
  const centreColorAt = progress => {
    const drawn = recordingContext();
    drifting.drawOverlay(plan, progress, drawn);
    return colorForSize(drawn, 184);
  };
  assert.equal(plan.slot, 0.0625);
  assert.deepEqual(
    [0.02, 0.07, 0.13, 0.19].map(centreColorAt),
    ["#111111", "#555555", "#aaaaaa", "#ffffff"],
  );
  // The ramp keeps travelling while the geometry mirrors, so a mirrored frame
  // is the same shape in a different colour.
  assert.notEqual(centreColorAt(0.02), centreColorAt(0.98));

  // An explicit text color overrides the palette, and a mode with no colors at
  // all refuses to draw rather than inventing one.
  const explicit = textMode({ textColor: "#ff0000" });
  const red = recordingContext();
  explicit.drawOverlay(textPlan(explicit), 0.5, red);
  assert.equal(red.texts[0].fillStyle, "#ff0000");
  const colorless = new TextRevealArrangementMode({
    text: "X",
    levels: 0,
    backgroundColor: "#000000",
  });
  assert.throws(
    () => colorless.drawOverlay(
      colorless.createPlan({ layout: TEXT_LAYOUT, durationSeconds: 4 }),
      0.02,
      recordingContext(),
    ),
    /has no palette colors/,
  );
  assert.throws(() => textMode({ colorDrift: 0.5 }), /colorDrift must be an integer/);
});

test("text hides the composition for the whole phase, in both directions", () => {
  const mode = textMode();
  const items = [
    { id: "a", x: 100, y: 100, size: 20 },
    { id: "b", x: 300, y: 100, size: 20 },
  ];
  const plan = mode.createPlan({
    items,
    layout: TEXT_LAYOUT,
    durationSeconds: 4,
  });
  const opacities = progress => items.map(
    item => mode.presentationsAt(plan, item.id, progress)[0].opacity,
  );
  // There is no crossfade to hand over with, so the composition cuts in as the
  // phase ends — and an outro, read backward, cuts it out as the phase starts.
  assert.deepEqual(opacities(0), [0, 0]);
  assert.deepEqual(opacities(0.6), [0, 0]);
  assert.deepEqual(opacities(0.99), [0, 0]);
  assert.deepEqual(opacities(1), [1, 1]);
  // Nothing moves or scales: a text phase is cuts plus the overlay.
  assert.ok(mode.presentationsAt(plan, "a", 0.5).every(
    presentation => presentation.offsetX === 0
      && presentation.offsetY === 0
      && presentation.scale === 1,
  ));
});
