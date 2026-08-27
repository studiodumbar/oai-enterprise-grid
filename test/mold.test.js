import test from "node:test";
import assert from "node:assert/strict";

import {
  COMPOSITION_DEFINITIONS,
  GENERATOR_DEFINITIONS,
  SETTINGS,
} from "../config.js";
import {
  createCircleGridSceneLayout,
} from "../src/generators/circle-grid-scene-generator.js";
import {
  createProceduralTopologySceneAt,
  moldProliferationStateAt,
  moldTrailLifetimeBeats,
  moldTopologyForLayout,
} from "../src/generators/grid-scene-strategies.js";
import { runFrames } from "../src/debug/headless.js";

const VIEWPORT = Object.freeze({ width: 900, height: 600 });

function moldOptions(projectSeed = 42) {
  return {
    ...SETTINGS.mold,
    strategy: "mold",
    stepCount: SETTINGS.mold.timing.beatCount,
    layerPasses: SETTINGS.mold.timing.beatCount,
    projectSeed,
  };
}

function moldSceneAt(progress, projectSeed = 42, overrides = {}) {
  const options = { ...moldOptions(projectSeed), ...overrides };
  return createProceduralTopologySceneAt({
    strategy: "mold",
    layout: createCircleGridSceneLayout(VIEWPORT, options.longSideCells),
    cycleIndex: 0,
    progress,
    options,
  });
}

test("mold is a timed procedural-topology composition", () => {
  assert.deepEqual(COMPOSITION_DEFINITIONS.mold.steps, [{ use: "moldGrid" }]);
  assert.deepEqual(GENERATOR_DEFINITIONS.moldGrid, {
    type: "procedural-topology",
    settingsKey: "mold",
    strategy: "mold",
  });
  assert.ok(SETTINGS.mold.timing.bodyDurationSeconds > 0);
  assert.ok(Number.isInteger(SETTINGS.mold.timing.beatCount));
  assert.equal(
    SETTINGS.mold.timing.beatSeconds,
    SETTINGS.mold.timing.bodyDurationSeconds / SETTINGS.mold.timing.beatCount,
  );
  assert.equal(SETTINGS.mold.intro.durationSeconds, SETTINGS.mold.timing.beatSeconds);
  assert.equal(SETTINGS.mold.intro.mode, "fade");
  assert.equal(SETTINGS.mold.outro.durationSeconds, SETTINGS.mold.timing.beatSeconds);
  assert.equal(SETTINGS.mold.circleEndpoints.start.mode, "native");
  assert.equal(
    SETTINGS.mold.circleEndpoints.start.durationSeconds,
    SETTINGS.mold.timing.beatSeconds,
  );
  assert.equal(SETTINGS.mold.circleEndpoints.end.mode, "dijkstra");
  assert.equal(
    SETTINGS.mold.circleEndpoints.end.durationSeconds,
    SETTINGS.mold.timing.beatSeconds,
  );
  assert.equal(SETTINGS.mold.flicker.enabled, true);
});

test("mold reconnaissance is seeded, random-directional, and includes failures", () => {
  const options = moldOptions();
  const layout = createCircleGridSceneLayout(VIEWPORT, options.longSideCells);
  const topologyAt = seed => moldTopologyForLayout(
    layout,
    0,
    options.targetCount,
    seed,
    options.explorationCount,
    options.explorationStepCount,
  );
  const first = topologyAt(42);
  const repeated = topologyAt(42);
  const changed = topologyAt(43);

  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first.targetIndices, changed.targetIndices);
  assert.equal(first.explorations.length, options.explorationCount);
  assert.equal(first.targetIndices.length, options.targetCount);
  assert.equal(new Set(first.targetIndices).size, options.targetCount);
  assert.equal(first.targetIndices.includes(first.rootIndex), false);
  assert.equal(
    first.failedExplorationIndices.length,
    options.explorationCount - options.targetCount,
  );
  first.explorations.forEach(exploration => {
    assert.equal(exploration.scoutPoints[0].cellIndex, first.rootIndex);
    for (let index = 1; index < exploration.scoutPoints.length; index += 1) {
      const previous = exploration.scoutPoints[index - 1];
      const current = exploration.scoutPoints[index];
      const columnDistance = Math.abs(current.microColumn - previous.microColumn);
      const rowDistance = Math.abs(current.microRow - previous.microRow);
      assert.equal(columnDistance + rowDistance, 1);
    }
    assert.equal(exploration.indices.at(-1), exploration.scoutPoints.at(-1).cellIndex);
  });
  assert.ok(first.discoveries.some(discovery => {
    const start = discovery.scoutPoints[0];
    const target = discovery.scoutPoints.at(-1);
    const manhattanDistance = Math.abs(
      target.microColumn - start.microColumn,
    ) + Math.abs(
      target.microRow - start.microRow,
    );
    return discovery.scoutPoints.length - 1 > manhattanDistance;
  }), "at least one successful scout should wander instead of routing directly");

  const trailReuse = topology => {
    const previousTrail = new Set();
    let reused = 0;
    topology.explorations.forEach(exploration => {
      exploration.scoutPoints.forEach(point => {
        const key = `${point.microColumn}:${point.microRow}`;
        if (previousTrail.has(key)) reused += 1;
      });
      exploration.scoutPoints.forEach(point => {
        previousTrail.add(`${point.microColumn}:${point.microRow}`);
      });
    });
    return reused;
  };
  const neutral = moldTopologyForLayout(
    layout,
    0,
    options.targetCount,
    42,
    options.explorationCount,
    options.explorationStepCount,
    0,
  );
  assert.ok(trailReuse(first) > trailReuse(neutral));
  assert.doesNotThrow(() => moldTopologyForLayout(
    layout,
    0,
    1,
    99,
    2,
    2048,
    options.trailEnergyDiscount,
  ));
});

test("hidden food turns reinforced tiny trails into staged proliferation", () => {
  const initial = moldSceneAt(0, 42, { targetCount: 1 });
  const scenes = Array.from(
    { length: 12 },
    (_, beat) => moldSceneAt((beat + 0.5) / 12, 42, { targetCount: 1 }),
  );
  assert.ok(scenes[0].faces.some(face => (
    face.role === "mold-scout-trace" || face.role === "mold-highway"
  )));
  const initialReconDots = scenes[0].faces.filter(
    face => face.detail?.kind === "mold-recon-dot",
  );
  const initialHabitat = initial.faces[initial.rootIndex];
  assert.equal(initialHabitat.role, "mold-origin");
  assert.equal(initialHabitat.level, 0);
  assert.deepEqual(
    initial.faces.filter(face => face.level >= 0).map(face => face.role),
    ["mold-origin"],
  );
  assert.equal(initial.faces.some(face => face.role === "mold-food"), false);
  assert.equal(
    initial.faces.some(face => face.detail?.kind === "mold-recon-dot"),
    false,
  );
  assert.ok(initialReconDots.length > 0);
  assert.ok(initialReconDots.every(face => (
    face.level === 3
    && face.detail.visibleGlyphIndices.length >= 1
    && face.detail.visibleGlyphIndices.length <= 64
  )));
  assert.ok(
    initialReconDots.reduce(
      (count, face) => count + face.detail.visibleGlyphIndices.length,
      0,
    ) > 3,
  );
  assert.ok(scenes[7].activeTrailGlyphCount > 0);
  assert.ok(scenes[7].expiredTrailGlyphCount > 0);
  assert.ok(scenes[7].highwayGlyphCount > 0);
  assert.ok(scenes[7].maximumTrailReuse > 1);
  assert.equal(
    moldTrailLifetimeBeats(
      1,
      SETTINGS.mold.trailDecayBeats,
      SETTINGS.mold.trailReuseBonusBeats,
    ),
    SETTINGS.mold.trailDecayBeats,
  );
  assert.equal(
    moldTrailLifetimeBeats(
      8,
      SETTINGS.mold.trailDecayBeats,
      SETTINGS.mold.trailReuseBonusBeats,
    ),
    SETTINGS.mold.trailDecayBeats + SETTINGS.mold.trailReuseBonusBeats * 3,
  );
  const pacingScene = moldSceneAt(
    0.5 / SETTINGS.mold.timing.beatCount,
    42,
    { targetCount: 1 },
  );
  const reconBeatCount = Math.round(SETTINGS.mold.timing.beatCount * 0.5);
  assert.equal(
    pacingScene.scoutStepsPerBeat,
    SETTINGS.mold.explorationStepCount / reconBeatCount,
  );
  assert.equal(
    pacingScene.scoutStepSeconds,
    SETTINGS.mold.timing.beatSeconds / pacingScene.scoutStepsPerBeat,
  );
  assert.equal(pacingScene.transitionStyle, "cut");

  assert.deepEqual(moldProliferationStateAt(0), {
    level: 3,
    capacity: 64,
    visibleCount: 1,
  });
  assert.deepEqual(moldProliferationStateAt(63), {
    level: 3,
    capacity: 64,
    visibleCount: 64,
  });
  assert.deepEqual(moldProliferationStateAt(64), {
    level: 2,
    capacity: 16,
    visibleCount: 1,
  });
  assert.deepEqual(moldProliferationStateAt(79), {
    level: 2,
    capacity: 16,
    visibleCount: 16,
  });
  assert.deepEqual(moldProliferationStateAt(80), {
    level: 1,
    capacity: 4,
    visibleCount: 1,
  });
  assert.deepEqual(moldProliferationStateAt(84), {
    level: 0,
    capacity: 1,
    visibleCount: 1,
  });

  const settle = scenes.at(-1);
  assert.equal(settle.phase, "settle");
  assert.deepEqual(settle.endpointCellIndices, settle.targetIndices);
  assert.equal(settle.discoveredTargetIndices.length, 1);
  assert.ok(settle.mostMatureProliferationLevel >= 0);
  assert.ok(settle.mostMatureProliferationLevel <= 3);
  settle.discoveries.forEach(found => {
    assert.equal(settle.faces[found.targetIndex].detail.kind, "mold-proliferation");
    assert.ok(settle.faces[found.targetIndex].detail.visibleGlyphIndices.length >= 1);
    assert.ok(
      settle.faces[found.targetIndex].detail.visibleGlyphIndices.length
      <= settle.faces[found.targetIndex].detail.capacity,
    );
  });
  assert.equal(settle.paletteMotion.kind, "mold-living-network");
});

test("headless mold runs shared phases, state transitions, flicker, and endpoint", async () => {
  const introSeconds = SETTINGS.mold.intro.durationSeconds;
  const bodySeconds = SETTINGS.mold.timing.bodyDurationSeconds;
  const outroSeconds = SETTINGS.mold.outro.durationSeconds;
  const run = await runFrames({
    composition: "mold",
    frames: Math.ceil((introSeconds + bodySeconds + outroSeconds) * 60) + 10,
    snapshotEvery: Math.max(1, Math.round(SETTINGS.mold.timing.beatSeconds * 60)),
    channels: ["config", "timeline", "transition"],
    projectSeed: 42,
  });
  const joined = run.lines.join("\n");
  assert.match(
    joined,
    new RegExp(`phase=start cycle=0 duration=${introSeconds.toFixed(3)} paused=yes`),
  );
  assert.match(
    joined,
    new RegExp(`phase=core cycle=0 duration=${bodySeconds.toFixed(3)} paused=no`),
  );
  assert.match(joined, /scene=cut strategy=mold key=mold:42:0:recon:/);
  assert.match(joined, /scene=cut strategy=mold key=mold:42:0:digest:/);
  assert.match(
    joined,
    new RegExp(`phase=end cycle=0 duration=${outroSeconds.toFixed(3)} paused=yes`),
  );
  assert.match(
    joined,
    new RegExp(`endpoint=end mode=dijkstra .*starts=${SETTINGS.mold.targetCount}`),
  );
  assert.match(
    joined,
    new RegExp(`phase=start cycle=1 duration=${introSeconds.toFixed(3)} paused=no`),
  );
  const coreStartFrame = Math.round(introSeconds * 60);
  const firstScoutFrame = run.drawCounts.slice(
    coreStartFrame,
    coreStartFrame + Math.round(SETTINGS.mold.timing.beatSeconds * 60),
  ).find(frame => frame.fill > 1);
  assert.ok(firstScoutFrame, "a scout trail should emerge during the first core beat");
  const coreEndFrame = coreStartFrame + Math.round(bodySeconds * 60);
  assert.ok(run.drawCounts.slice(coreStartFrame, coreEndFrame).every(
    frame => frame.fill > 0,
  ));

  const coreSnapshot = run.snapshots.find(
    snapshot => snapshot.state.timeline.phase === "core",
  );
  const inspection = coreSnapshot.state.generators.moldGrid;
  assert.equal(inspection.strategy, "mold");
  assert.equal(inspection.flicker.mode, SETTINGS.mold.flicker.mode);
  assert.equal(inspection.flicker.scope, SETTINGS.mold.flicker.scope);
  assert.equal(inspection.flicker.autoCycleSeconds, SETTINGS.mold.timing.beatSeconds);
});
