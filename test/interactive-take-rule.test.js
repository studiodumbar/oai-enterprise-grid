import test from "node:test";
import assert from "node:assert/strict";

import { InteractiveTakeRule } from "../src/compositions/interactive-take-rule.js";
import { CompositionDirector } from "../src/core/composition-director.js";
import { FactoryRegistry } from "../src/core/registry.js";
import { captureDebug } from "../src/debug/index.js";
import { createHeadlessDirector } from "../src/debug/headless.js";
import { createSvgRecordingContext } from "../src/export/svg-recording-context.js";

function createRule() {
  return new InteractiveTakeRule({
    definition: {
      rule: "interactive-take",
      timing: { mode: "fixed-beat", beatSeconds: 3 },
      steps: [{ use: "interactiveFlockGrid" }],
    },
    runtime: { viewport: () => ({ width: 100, height: 100 }) },
  });
}

function draw(rule, {
  fromX = 25,
  fromY = 50,
  toX = 55,
  toY = 90,
  cssScale = 1,
} = {}) {
  assert.equal(rule.input("pointerdown", {
    x: fromX,
    y: fromY,
    cssX: fromX * cssScale,
    cssY: fromY * cssScale,
    button: 0,
  }), true);
  assert.equal(rule.input("pointermove", {
    x: toX,
    y: toY,
    cssX: toX * cssScale,
    cssY: toY * cssScale,
  }), true);
  assert.equal(rule.input("pointerup", {
    x: toX,
    y: toY,
    cssX: toX * cssScale,
    cssY: toY * cssScale,
  }), true);
}

function finishPreview(rule) {
  return rule.update({ compositionDt: rule.beatSeconds })[0].take;
}

function drawPath(rule, points, cssScale = 1) {
  const [first, ...rest] = points;
  assert.equal(rule.input("pointerdown", {
    x: first.x,
    y: first.y,
    cssX: first.x * cssScale,
    cssY: first.y * cssScale,
    button: 0,
  }), true);
  for (const point of rest.slice(0, -1)) {
    assert.equal(rule.input("pointermove", {
      x: point.x,
      y: point.y,
      cssX: point.x * cssScale,
      cssY: point.y * cssScale,
    }), true);
  }
  const last = rest.at(-1);
  assert.equal(rule.input("pointerup", {
    x: last.x,
    y: last.y,
    cssX: last.x * cssScale,
    cssY: last.y * cssScale,
  }), true);
}

test("interactive takes normalize gestures, reject short drags, and preview one absolute beat", () => {
  const rule = createRule();
  assert.deepEqual(rule.update({ compositionDt: 0 })[0].take, {
    version: 6,
    mode: "frozen",
    steps: [],
    selectedStepId: null,
    previewStepId: null,
    previewStepIndex: null,
    playbackTime: 0,
    beatSeconds: 3,
    revision: 0,
    interactionMode: "launcher",
    takeSettings: { beatSeconds: 3, showBoids: false, showPath: true },
    stagedSettings: {},
    draftGestures: [],
    draftGesture: null,
    draftPath: null,
    draftBoom: null,
  });

  draw(rule, { fromX: 20, fromY: 20, toX: 24, toY: 23 });
  assert.equal(rule.inspect().mode, "frozen");
  assert.equal(rule.inspect().draftGesture, null);

  draw(rule);
  assert.equal(rule.inspect().mode, "drawn");
  assert.equal(rule.inspect().draftGesture, null);
  assert.deepEqual(rule.inspect().draftGestures, [{
    originX: 0.25,
    originY: 0.5,
    directionX: 0.6,
    directionY: 0.8,
    endX: 0.55,
    endY: 0.9,
    strength: 1,
  }]);
  draw(rule, { fromX: 80, fromY: 20, toX: 40, toY: 20 });
  assert.deepEqual(rule.inspect().draftGestures, [
    {
      originX: 0.25,
      originY: 0.5,
      directionX: 0.6,
      directionY: 0.8,
      endX: 0.55,
      endY: 0.9,
      strength: 1,
    },
    {
      originX: 0.8,
      originY: 0.2,
      directionX: -1,
      directionY: 0,
      endX: 0.4,
      endY: 0.2,
      strength: 1,
    },
  ]);
  draw(rule, { fromX: 20, fromY: 20, toX: 24, toY: 23 });
  assert.equal(rule.inspect().mode, "drawn");
  assert.equal(rule.inspect().draftGestures.length, 2);
  assert.equal(rule.input("take", { action: "enough" }), false);
  assert.equal(rule.input("take", {
    action: "stage-settings",
    settings: {
      simulation: { alignment: 2 },
      showBoids: true,
    },
  }), true);
  assert.equal(rule.input("take", { action: "play" }), true);

  let take = rule.update({ compositionDt: 1.5 })[0].take;
  assert.equal(take.mode, "playing");
  assert.equal(take.playbackTime, 1.5);
  assert.deepEqual(take.steps, [{
    id: "step-1",
    interaction: "launcher",
    gestures: [
      {
        originX: 0.25,
        originY: 0.5,
        directionX: 0.6,
        directionY: 0.8,
        endX: 0.55,
        endY: 0.9,
        strength: 1,
      },
      {
        originX: 0.8,
        originY: 0.2,
        directionX: -1,
        directionY: 0,
        endX: 0.4,
        endY: 0.2,
        strength: 1,
      },
    ],
    settings: { simulation: { alignment: 2 } },
  }]);
  assert.equal(take.takeSettings.showBoids, true);
  assert.equal(take.revision, 2);

  take = rule.update({ compositionDt: 1.5 })[0].take;
  assert.equal(take.mode, "frozen");
  assert.equal(take.playbackTime, 3);

  assert.equal(rule.input("take", { action: "select", stepId: null }), true);
  draw(rule, { fromX: 80, fromY: 20, toX: 40, toY: 20 });
  assert.equal(rule.input("take", { action: "play" }), true);
  take = rule.update({ compositionDt: 0 })[0].take;
  assert.equal(take.playbackTime, 3);
  assert.equal(take.previewStepIndex, 1);
  for (let frame = 0; frame < 180; frame += 1) {
    take = rule.update({ compositionDt: 1 / 60 })[0].take;
  }
  assert.equal(take.mode, "frozen");
  assert.equal(take.playbackTime, 6);

  assert.deepEqual(rule.input("take", { action: "enough" }), {
    handled: true,
    timelineEffect: "restart-at-intro",
  });
  assert.equal(rule.animationDuration(), 6);
  take = rule.update({ compositionDt: 0, time: 7 })[0].take;
  assert.equal(take.mode, "sealed");
  assert.equal(take.playbackTime, 1);
  assert.equal(take.previewStepId, "step-1");
  assert.equal(rule.input("take", {
    action: "stage-settings",
    settings: { showBoids: false },
  }), true);
  assert.equal(rule.inspect().takeSettings.showBoids, false);
  assert.equal(rule.input("take", {
    action: "stage-settings",
    settings: { simulation: { alignment: 3 } },
  }), false);
});

test("launcher drag distance captures proportional strength and its visual endpoint", () => {
  const rule = createRule();
  draw(rule, { fromX: 10, fromY: 20, toX: 15, toY: 30, cssScale: 2 });

  const [launch] = rule.inspect().draftGestures;
  assert.deepEqual(launch, {
    originX: 0.1,
    originY: 0.2,
    directionX: 1 / Math.sqrt(5),
    directionY: 2 / Math.sqrt(5),
    endX: 0.15,
    endY: 0.3,
    strength: Math.sqrt(125) / 25,
  });
});

test("take editing preserves stable IDs and round-trips versioned rule state", () => {
  const rule = createRule();
  draw(rule);
  rule.input("take", { action: "play" });
  finishPreview(rule);
  rule.input("take", { action: "select", stepId: null });
  draw(rule, { fromX: 75, fromY: 50, toX: 25, toY: 50 });
  rule.input("take", { action: "play" });
  finishPreview(rule);

  assert.equal(rule.input("take", {
    action: "reorder",
    stepId: "step-1",
    toIndex: 1,
  }), true);
  assert.deepEqual(rule.inspect().steps.map(step => step.id), ["step-2", "step-1"]);
  assert.equal(rule.input("take", {
    action: "duplicate",
    stepId: "step-1",
  }), true);
  assert.deepEqual(
    rule.inspect().steps.map(step => step.id),
    ["step-2", "step-1", "step-3"],
  );
  assert.equal(rule.input("take", { action: "delete", stepId: "step-2" }), true);
  assert.deepEqual(rule.inspect().steps.map(step => step.id), ["step-1", "step-3"]);

  const snapshot = rule.snapshotProjectState();
  const restored = createRule();
  assert.equal(restored.restoreProjectState(snapshot), true);
  assert.deepEqual(restored.snapshotProjectState(), snapshot);
  assert.equal(restored.restoreProjectState({ ...snapshot, version: 99 }), false);

  const multiLaunch = structuredClone(snapshot);
  multiLaunch.version = 2;
  multiLaunch.steps = multiLaunch.steps.map(step => {
    const { interaction, ...legacyStep } = step;
    return legacyStep;
  });
  delete multiLaunch.interactionMode;
  delete multiLaunch.draftPath;
  delete multiLaunch.takeSettings.showPath;
  const migratedMultiLaunch = createRule();
  assert.equal(migratedMultiLaunch.restoreProjectState(multiLaunch), true);
  assert.equal(migratedMultiLaunch.snapshotProjectState().version, 6);
  assert.ok(migratedMultiLaunch.inspect().steps.every(
    step => step.interaction === "launcher",
  ));
  assert.equal(migratedMultiLaunch.inspect().takeSettings.showPath, true);

  const legacy = structuredClone(snapshot);
  legacy.version = 1;
  legacy.steps = legacy.steps.map(step => {
    const { gestures, ...rest } = step;
    return { ...rest, gesture: gestures[0] };
  });
  delete legacy.interactionMode;
  delete legacy.draftPath;
  delete legacy.takeSettings.showPath;
  delete legacy.draftGestures;
  const migrated = createRule();
  assert.equal(migrated.restoreProjectState(legacy), true);
  assert.equal(migrated.snapshotProjectState().version, 6);
  assert.deepEqual(
    migrated.inspect().steps.map(step => step.gestures),
    legacy.steps.map(step => [step.gesture]),
  );

  const legacyDraftSource = createRule();
  draw(legacyDraftSource, { fromX: 10, fromY: 30, toX: 50, toY: 30 });
  const legacyDraft = legacyDraftSource.snapshotProjectState();
  legacyDraft.version = 1;
  legacyDraft.draftGesture = legacyDraft.draftGestures[0];
  delete legacyDraft.interactionMode;
  delete legacyDraft.draftPath;
  delete legacyDraft.takeSettings.showPath;
  delete legacyDraft.draftGestures;
  const migratedDraft = createRule();
  assert.equal(migratedDraft.restoreProjectState(legacyDraft), true);
  assert.equal(migratedDraft.inspect().mode, "drawn");
  assert.deepEqual(migratedDraft.inspect().draftGestures, [legacyDraft.draftGesture]);
  assert.equal(migratedDraft.inspect().draftGesture, null);

  const versionThree = structuredClone(snapshot);
  versionThree.version = 3;
  delete versionThree.draftBoom;
  const migratedVersionThree = createRule();
  assert.equal(migratedVersionThree.restoreProjectState(versionThree), true);
  assert.equal(migratedVersionThree.snapshotProjectState().version, 6);
  assert.equal(migratedVersionThree.inspect().draftBoom, null);
});

test("Picasso captures one ordered path per beat and selection adopts its interaction", () => {
  const rule = createRule();
  assert.equal(rule.input("take", {
    action: "set-interaction",
    mode: "picasso",
  }), true);

  drawPath(rule, [{ x: 10, y: 10 }, { x: 14, y: 13 }]);
  assert.equal(rule.inspect().mode, "frozen");
  assert.equal(rule.inspect().draftPath, null);

  assert.equal(rule.input("take", {
    action: "set-interaction",
    mode: "launcher",
  }), true);
  draw(rule);
  assert.equal(rule.input("take", {
    action: "set-interaction",
    mode: "picasso",
  }), false);
  assert.equal(rule.input("take", { action: "play" }), true);
  finishPreview(rule);

  assert.equal(rule.input("take", { action: "select", stepId: null }), true);
  assert.equal(rule.input("take", {
    action: "set-interaction",
    mode: "picasso",
  }), true);
  drawPath(rule, [
    { x: 10, y: 20 },
    { x: 30, y: 20 },
    { x: 30, y: 60 },
    { x: 70, y: 80 },
  ]);
  assert.deepEqual(rule.inspect().draftPath, {
    points: [
      { x: 0.1, y: 0.2 },
      { x: 0.3, y: 0.2 },
      { x: 0.3, y: 0.6 },
      { x: 0.7, y: 0.8 },
    ],
  });
  assert.equal(rule.input("pointerdown", {
    x: 80,
    y: 80,
    button: 0,
  }), false);
  assert.equal(rule.input("take", { action: "play" }), true);
  assert.deepEqual(rule.inspect().steps[1], {
    id: "step-2",
    interaction: "picasso",
    path: {
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.3, y: 0.2 },
        { x: 0.3, y: 0.6 },
        { x: 0.7, y: 0.8 },
      ],
    },
    settings: {},
  });
  assert.equal(rule.input("take", {
    action: "set-interaction",
    mode: "launcher",
  }), false);
  assert.equal(rule.input("take", {
    action: "stage-settings",
    settings: { showPath: false },
  }), true);
  assert.equal(rule.inspect().takeSettings.showPath, false);
  finishPreview(rule);
  assert.deepEqual(rule.input("take", { action: "enough" }), {
    handled: true,
    timelineEffect: "restart-at-intro",
  });
  assert.equal(rule.input("take", {
    action: "stage-settings",
    settings: { showPath: true },
  }), true);
  assert.equal(rule.inspect().takeSettings.showPath, true);
  assert.deepEqual(rule.input("take", { action: "edit" }), {
    handled: true,
    timelineEffect: "return-to-authoring-core",
  });

  assert.equal(rule.input("take", { action: "select", stepId: "step-1" }), true);
  assert.equal(rule.inspect().interactionMode, "launcher");
  assert.equal(rule.input("take", { action: "select", stepId: "step-2" }), true);
  assert.equal(rule.inspect().interactionMode, "picasso");

  const snapshot = rule.snapshotProjectState();
  const restored = createRule();
  assert.equal(restored.restoreProjectState(snapshot), true);
  assert.deepEqual(restored.snapshotProjectState(), snapshot);
});

test("Boom captures a radius and commits one configurable radial burst", () => {
  const rule = createRule();
  assert.equal(rule.input("take", {
    action: "set-interaction",
    mode: "boom",
  }), true);

  draw(rule, { fromX: 50, fromY: 50, toX: 54, toY: 53 });
  assert.equal(rule.inspect().mode, "frozen");
  assert.equal(rule.inspect().draftBoom, null);

  draw(rule, { fromX: 50, fromY: 40, toX: 80, toY: 40 });
  assert.deepEqual(rule.inspect().draftBoom, {
    centerX: 0.5,
    centerY: 0.4,
    radius: 0.3,
  });
  assert.equal(rule.input("pointerdown", {
    x: 20,
    y: 20,
    button: 0,
  }), false);
  assert.equal(rule.input("take", {
    action: "stage-settings",
    settings: { interaction: { boom: { intensity: 7 } } },
  }), true);
  assert.throws(() => rule.input("take", {
    action: "stage-settings",
    settings: { interaction: { boom: { intensity: 0 } } },
  }), /positive integer/);
  assert.equal(rule.input("take", { action: "play" }), true);
  assert.deepEqual(rule.inspect().steps[0], {
    id: "step-1",
    interaction: "boom",
    boom: { centerX: 0.5, centerY: 0.4, radius: 0.3 },
    settings: { interaction: { boom: { intensity: 7 } } },
  });
  finishPreview(rule);
  assert.equal(rule.input("take", { action: "select", stepId: "step-1" }), true);
  assert.equal(rule.inspect().interactionMode, "boom");

  const snapshot = rule.snapshotProjectState();
  const restored = createRule();
  assert.equal(restored.restoreProjectState(snapshot), true);
  assert.deepEqual(restored.snapshotProjectState(), snapshot);
});

test("Let it flow commits a beat without canvas input", () => {
  const rule = createRule();
  assert.equal(rule.input("take", {
    action: "set-interaction",
    mode: "flow",
  }), true);
  assert.equal(rule.input("pointerdown", {
    x: 50,
    y: 50,
    button: 0,
  }), false);
  assert.equal(rule.input("take", { action: "play" }), true);
  assert.deepEqual(rule.inspect().steps, [{
    id: "step-1",
    interaction: "flow",
    settings: {},
  }]);
  assert.equal(rule.inspect().mode, "playing");
  finishPreview(rule);
  assert.equal(rule.inspect().mode, "frozen");
  assert.equal(rule.inspect().playbackTime, 3);

  const snapshot = rule.snapshotProjectState();
  const restored = createRule();
  assert.equal(restored.restoreProjectState(snapshot), true);
  assert.deepEqual(restored.snapshotProjectState(), snapshot);

  const legacyHold = structuredClone(snapshot);
  legacyHold.version = 5;
  legacyHold.steps[0].interaction = "skip";
  legacyHold.interactionMode = "skip";
  const migrated = createRule();
  assert.equal(migrated.restoreProjectState(legacyHold), true);
  assert.equal(migrated.inspect().interactionMode, "flow");
  assert.equal(migrated.inspect().steps[0].interaction, "flow");
});

test("authored Picasso defaults initialize interaction mode and path visibility", () => {
  const rule = new InteractiveTakeRule({
    definition: {
      rule: "interactive-take",
      timing: { mode: "fixed-beat", beatSeconds: 3 },
      steps: [{ use: "interactiveFlockGrid" }],
    },
    options: {
      interaction: {
        mode: "picasso",
        picasso: { showPath: false },
      },
    },
    runtime: { viewport: () => ({ width: 100, height: 100 }) },
  });
  assert.equal(rule.inspect().interactionMode, "picasso");
  assert.equal(rule.inspect().takeSettings.showPath, false);

  const legacy = createRule().snapshotProjectState();
  legacy.version = 2;
  delete legacy.interactionMode;
  delete legacy.draftPath;
  delete legacy.takeSettings.showPath;
  assert.equal(rule.restoreProjectState(legacy), true);
  assert.equal(rule.inspect().takeSettings.showPath, false);
});

test("director applies rule timeline effects and saves rule state beside generators", () => {
  const generatorTypes = new FactoryRegistry("generator type");
  const compositionRules = new FactoryRegistry("composition rule");
  generatorTypes.register("fake", () => ({ update() {} }));
  compositionRules.register(
    "interactive-take",
    creationContext => new InteractiveTakeRule(creationContext),
  );
  const director = new CompositionDirector({
    settings: {
      composition: {
        startWithCircle: true,
        startWithCircleDurationSeconds: 1,
        endWithCircle: true,
        endWithCircleDurationSeconds: 2,
        circleSubdivision: 1,
      },
    },
    generatorDefinitions: { interactiveFlockGrid: { type: "fake" } },
    compositionDefinitions: {
      demo: {
        rule: "interactive-take",
        timing: { mode: "fixed-beat", beatSeconds: 3 },
        steps: [{ use: "interactiveFlockGrid" }],
      },
    },
    generatorTypes,
    compositionRules,
    runtime: {
      context: () => ({ save() {}, restore() {} }),
      viewport: () => ({ width: 100, height: 100 }),
    },
  });

  const lines = captureDebug(["timeline", "transition"], () => {
    director.use("demo");
    director.update({ compositionDt: 0, viewport: { width: 100, height: 100 } });
    draw(director);
    director.input("take", { action: "play" });
    director.update({ compositionDt: 3, viewport: { width: 100, height: 100 } });
    director.input("take", { action: "enough" });
  });
  assert.equal(director.inspect().timeline.phase, "start");
  assert.equal(director.animationDuration(), 6);
  assert.ok(lines.some(line => line.includes("effect=return-to-authoring-core")));
  assert.ok(lines.some(line => line.includes("effect=restart-at-intro")));

  assert.equal(director.input("take", { action: "edit" }), true);
  assert.equal(director.inspect().timeline.phase, "core");
  assert.equal(director.animationDuration(), null);
  assert.equal(director.inspect().timeline.rule.playbackTime, 3);
  director.seek(0);
  assert.equal(director.inspect().timeline.phase, "core");
  assert.equal(director.inspect().timeline.rule.playbackTime, 3);
  const snapshot = director.snapshotProjectState();
  assert.equal(snapshot.rule.version, 6);
  assert.equal(snapshot.rule.steps.length, 1);
  director.restoreProjectState(snapshot);
  assert.deepEqual(director.snapshotProjectState().rule, snapshot.rule);
});

test("a fresh director restores take-level geometry before copied simulation buffers", () => {
  const viewport = { width: 900, height: 600 };
  const source = createHeadlessDirector({
    composition: "interactive-flock",
    viewport,
  }).director;
  const target = createHeadlessDirector({
    composition: "interactive-flock",
    viewport,
  }).director;
  const frame = (index, compositionDt = 1 / 60) => ({
    dt: compositionDt,
    compositionDt,
    time: index / 60,
    frameIndex: index,
    viewport,
    pointer: { active: false, x: 0, y: 0 },
  });

  try {
    source.update(frame(0, 0));
    assert.equal(source.input("take", {
      action: "stage-settings",
      scope: "take",
      settings: {
        simulation: { count: 8 },
        grid: { longSideCells: 10 },
        field: { longSidePixels: 60 },
      },
    }), true);
    draw(source, { fromX: 225, fromY: 300, toX: 405, toY: 420 });
    assert.equal(source.input("take", { action: "play" }), true);
    for (let index = 1; index <= 180; index += 1) source.update(frame(index));

    const snapshot = JSON.parse(JSON.stringify(source.snapshotProjectState()));
    assert.doesNotThrow(() => target.restoreProjectState(snapshot));
    assert.deepEqual(target.snapshotProjectState().rule, snapshot.rule);
    assert.deepEqual(
      target.snapshotProjectState().generators.interactiveFlockGrid.simulation,
      snapshot.generators.interactiveFlockGrid.simulation,
    );
  } finally {
    source.dispose();
    target.dispose();
  }
});

test("interactive flock freezes every clock and rebuilds only the edited prefix", () => {
  const viewport = { width: 900, height: 600 };
  const { director } = createHeadlessDirector({
    composition: "interactive-flock",
    viewport,
  });
  let frameIndex = 0;
  const update = (compositionDt = 1 / 60) => {
    director.update({
      dt: compositionDt,
      compositionDt,
      time: frameIndex / 60,
      frameIndex,
      viewport,
      pointer: { active: false, x: 0, y: 0 },
    });
    frameIndex += 1;
  };
  const playBeat = () => {
    assert.equal(director.input("take", { action: "play" }), true);
    for (let tick = 0; tick < 180; tick += 1) update();
  };

  try {
    update(0);
    const generator = director.generator("interactiveFlockGrid");
    const initial = generator.snapshotProjectState().simulation;
    for (let tick = 0; tick < 120; tick += 1) update();
    assert.deepEqual(generator.snapshotProjectState().simulation, initial);

    draw(director, { fromX: 180, fromY: 180, toX: 360, toY: 300 });
    playBeat();
    assert.equal(generator.flock.pulseIndex, 1);
    assert.equal(generator.inspect().take.cachedPrefixes, 2);
    assert.ok(Math.abs(generator.flock.time - 3) < 1e-9);

    const firstFrozen = generator.snapshotProjectState().simulation;
    for (let tick = 0; tick < 120; tick += 1) update();
    assert.deepEqual(generator.snapshotProjectState().simulation, firstFrozen);

    assert.equal(director.input("take", {
      action: "select",
      stepId: null,
    }), true);
    draw(director, { fromX: 720, fromY: 180, toX: 540, toY: 300 });
    playBeat();
    assert.equal(generator.flock.pulseIndex, 2);
    assert.equal(generator.inspect().take.cachedPrefixes, 3);
    assert.ok(Math.abs(generator.flock.time - 6) < 1e-9);

    assert.equal(director.input("take", {
      action: "select",
      stepId: "step-1",
    }), true);
    draw(director, { fromX: 180, fromY: 420, toX: 360, toY: 360 });
    playBeat();
    assert.equal(generator.flock.pulseIndex, 1);
    assert.equal(generator.inspect().take.cachedPrefixes, 2);
    assert.ok(Math.abs(generator.flock.time - 3) < 1e-9);

    assert.equal(director.input("take", {
      action: "stage-settings",
      scope: "take",
      settings: { beatSeconds: 2 },
    }), true);
    update(0);
    assert.equal(generator.inspect().take.cachedPrefixes, 2);
    assert.ok(Math.abs(generator.flock.time - 2) < 1e-9);
  } finally {
    director.dispose();
  }
});

test("take-level beat and phase settings rebuild the shared endpoint timeline", () => {
  const { director } = createHeadlessDirector({ composition: "interactive-flock" });
  try {
    director.update({
      dt: 0,
      compositionDt: 0,
      time: 0,
      frameIndex: 0,
      viewport: { width: 900, height: 600 },
      pointer: { active: false, x: 0, y: 0 },
    });
    assert.deepEqual(director.endpointDurations, { start: 3, end: 3 });
    assert.equal(director.input("take", {
      action: "stage-settings",
      scope: "take",
      settings: { beatSeconds: 2 },
    }), true);
    assert.deepEqual(director.endpointDurations, { start: 2, end: 2 });
    assert.equal(director.inspect().timeline.phase, "core");

    assert.equal(director.input("take", {
      action: "stage-settings",
      scope: "take",
      settings: {
        intro: { enabled: true, mode: "fade", durationSeconds: 1.25 },
        outro: { durationSeconds: 1.5 },
      },
    }), true);
    assert.deepEqual(director.endpointDurations, { start: 1.25, end: 1.5 });
    assert.equal(director.inspect().phaseOverlay, null);

    const snapshot = director.snapshotProjectState();
    const restored = createHeadlessDirector({ composition: "interactive-flock" }).director;
    try {
      restored.restoreProjectState(snapshot);
      assert.deepEqual(restored.endpointDurations, { start: 1.25, end: 1.5 });
      assert.deepEqual(restored.snapshotProjectState().rule, snapshot.rule);
    } finally {
      restored.dispose();
    }
  } finally {
    director.dispose();
  }
});

test("visible boids use the shared canvas path in static and motion frames", () => {
  const viewport = { width: 900, height: 600 };
  const { director } = createHeadlessDirector({
    composition: "interactive-flock",
    viewport,
  });
  const frame = {
    dt: 1 / 60,
    compositionDt: 1 / 60,
    time: 1 / 60,
    frameIndex: 1,
    viewport,
    pointer: { active: false, x: 0, y: 0 },
  };
  try {
    director.update({ ...frame, dt: 0, compositionDt: 0, time: 0, frameIndex: 0 });
    assert.equal(director.input("take", {
      action: "stage-settings",
      scope: "take",
      settings: {
        showBoids: true,
        visibleBoids: { size: 9, color: "#ff00ff", opacity: 0.6 },
      },
    }), true);
    draw(director, { fromX: 225, fromY: 300, toX: 405, toY: 300 });
    assert.equal(director.input("take", { action: "play" }), true);
    director.update(frame);

    for (const exporting of [false, true]) {
      const recorder = createSvgRecordingContext(viewport.width, viewport.height);
      director.draw({ ...frame, exporting }, recorder);
      assert.match(recorder.toSVG(), /#ff00ff/i);
    }
  } finally {
    director.dispose();
  }
});
