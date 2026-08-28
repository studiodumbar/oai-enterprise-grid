// Golden traces.
//
// Each composition is run headlessly and its debug log plus draw volume is
// compared against a committed baseline. These files are the regression net for
// structural work: a change that claims to preserve behavior must leave every
// trace byte-identical, and a change that alters behavior on purpose must show
// exactly what changed in the diff.
//
// Regenerate after an intended change:
//   UPDATE_GOLDEN=1 node --test test/golden-traces.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COMPOSITION_DEFINITIONS } from "../config.js";
import { runFrames } from "../src/debug/headless.js";

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "golden");
// Long enough to leave the intro and reach the core phase — and for most
// compositions the outro too. A window that only ever covers the entrance is a
// net with no floor: an outro regression passes through it untouched.
const FRAMES = 900;
const CHANNELS = ["timeline", "transition", "plan"];

// Legacy aliases render the same generator as their target; tracing both would
// duplicate every baseline for no extra coverage.
const COMPOSITIONS = Object.entries(COMPOSITION_DEFINITIONS)
  .filter(([, definition]) => !definition.legacyAliasFor)
  .map(([id]) => id)
  .sort();

// Captured before any test runs, because the comparison test may write a
// baseline itself.
const UNCOVERED_AT_START = COMPOSITIONS.filter(
  composition => !existsSync(join(GOLDEN_DIR, `${composition}.trace.txt`)),
);
// A fresh checkout with no baselines at all writes them and passes. Once any
// baseline exists, a missing one is a composition nobody generated a baseline
// for: writing it silently would mark it covered on the next run forever.
const FRESH_CHECKOUT = UNCOVERED_AT_START.length === COMPOSITIONS.length;

function renderTrace(composition, run) {
  const drawn = run.drawCounts.filter(entry => entry.fill > 0 || entry.text > 0);
  const blank = run.drawCounts.length - drawn.length;
  const totalFill = run.drawCounts.reduce((sum, entry) => sum + entry.fill, 0);
  return [
    `# composition: ${composition}`,
    `# frames: ${run.drawCounts.length}`,
    "",
    ...run.lines,
    "",
    "# draw volume",
    `blankFrames=${blank}`,
    `firstDrawnFrame=${drawn.length > 0 ? drawn[0].frameIndex : -1}`,
    `totalFill=${totalFill}`,
    "",
  ].join("\n");
}

function authorFrame(viewport, time, dt, frameIndex) {
  return {
    dt,
    compositionDt: dt,
    time,
    frameIndex,
    viewport,
    pointer: { active: false, x: 0, y: 0 },
  };
}

async function setupInteractiveFlockTrace({ director, viewport, dt }) {
  let time = 0;
  let frameIndex = 0;
  director.update(authorFrame(viewport, time, 0, frameIndex));

  const authorGesture = ({ originX, originY, targetX, targetY }) => {
    const point = (normalizedX, normalizedY) => ({
      normalizedX,
      normalizedY,
      x: normalizedX * viewport.width,
      y: normalizedY * viewport.height,
      cssX: normalizedX * viewport.width,
      cssY: normalizedY * viewport.height,
    });
    assert.equal(director.input("pointerdown", {
      ...point(originX, originY),
      button: 0,
    }), true);
    assert.equal(director.input("pointermove", point(targetX, targetY)), true);
    assert.equal(director.input("pointerup", point(targetX, targetY)), true);
  };
  const playBeat = () => {
    assert.equal(director.input("take", { action: "play" }), true);
    for (let previewFrame = 0; previewFrame < 180; previewFrame += 1) {
      time += dt;
      frameIndex += 1;
      director.update(authorFrame(viewport, time, dt, frameIndex));
    }
    assert.equal(director.inspect().timeline.rule.mode, "frozen");
  };

  authorGesture({ originX: 0.25, originY: 0.35, targetX: 0.75, targetY: 0.45 });
  authorGesture({ originX: 0.78, originY: 0.3, targetX: 0.4, targetY: 0.7 });
  playBeat();
  assert.equal(director.input("take", { action: "select", stepId: null }), true);
  assert.equal(director.input("take", {
    action: "set-interaction",
    mode: "picasso",
  }), true);
  const pathPoints = [
    [0.72, 0.72],
    [0.68, 0.48],
    [0.52, 0.25],
    [0.32, 0.25],
  ];
  const pathPoint = ([normalizedX, normalizedY]) => ({
    normalizedX,
    normalizedY,
    x: normalizedX * viewport.width,
    y: normalizedY * viewport.height,
    cssX: normalizedX * viewport.width,
    cssY: normalizedY * viewport.height,
  });
  assert.equal(director.input("pointerdown", {
    ...pathPoint(pathPoints[0]),
    button: 0,
  }), true);
  for (const point of pathPoints.slice(1)) {
    assert.equal(director.input("pointermove", pathPoint(point)), true);
  }
  assert.equal(director.input("pointerup", pathPoint(pathPoints.at(-1))), true);
  playBeat();
  assert.equal(director.input("take", { action: "enough" }), true);

  const take = director.inspect().timeline.rule;
  assert.equal(take.mode, "sealed");
  assert.equal(take.steps.length, 2);
  assert.deepEqual(take.steps.map(step => step.interaction), ["launcher", "picasso"]);
  assert.equal(take.steps[0].gestures.length, 2);
  assert.ok(take.steps[0].gestures.every(gesture => Math.hypot(
    gesture.directionX,
    gesture.directionY,
  ) > 0.999));
  assert.deepEqual(take.steps[1].path.points, pathPoints.map(([x, y]) => ({ x, y })));
}

const TRACE_SETUPS = Object.freeze({
  "interactive-flock": setupInteractiveFlockTrace,
});

test("every composition has a stable headless trace", async () => {
  if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });
  const update = process.env.UPDATE_GOLDEN === "1";
  const written = [];

  // Every composition is compared before anything is reported. Failing on the
  // first mismatch left every later composition untested, which is how a stale
  // baseline for one composition hid the others for several commits.
  const changed = [];
  for (const composition of COMPOSITIONS) {
    const run = await runFrames({
      composition,
      frames: FRAMES,
      channels: CHANNELS,
      setup: TRACE_SETUPS[composition],
    });
    const trace = renderTrace(composition, run);
    const path = join(GOLDEN_DIR, `${composition}.trace.txt`);

    if (update || (FRESH_CHECKOUT && !existsSync(path))) {
      writeFileSync(path, trace);
      written.push(composition);
      continue;
    }
    if (!existsSync(path)) continue;

    if (trace !== readFileSync(path, "utf8")) changed.push(composition);
  }

  assert.deepEqual(
    changed,
    [],
    `Headless traces changed for: ${changed.join(", ")}. If the change is `
    + "intended, review the diff and regenerate with UPDATE_GOLDEN=1.",
  );

  if (written.length > 0 && !update) {
    // First run on a fresh checkout writes the missing baselines rather than
    // failing; the next run compares against them.
    console.log(`Wrote missing golden traces: ${written.join(", ")}`);
  }
});

test("traces cover every non-alias composition", () => {
  assert.ok(COMPOSITIONS.length >= 8, "expected the full composition catalog");
  assert.ok(COMPOSITIONS.includes("base"));
  assert.ok(COMPOSITIONS.includes("voronoi"));
  // Flock uses the shared timing and endpoint path, so it stays in the same
  // regression net as the discrete compositions.
  assert.ok(COMPOSITIONS.includes("flock"));
  // A composition in the catalog with no committed baseline is not covered:
  // the run above writes the missing file and passes, so only this check makes
  // the gap visible.
  assert.deepEqual(
    UNCOVERED_AT_START,
    [],
    `No committed golden trace for: ${UNCOVERED_AT_START.join(", ")}. `
    + "Generate one with UPDATE_GOLDEN=1 and commit it.",
  );
});
