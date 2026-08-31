import test from "node:test";
import assert from "node:assert/strict";

import { SETTINGS } from "../config.js";
import { createHeadlessDirector } from "../src/debug/headless.js";
import {
  NoiseVisibilityTransition,
  createNoiseVisibilityTransition,
} from "../src/transitions/noise-visibility.js";
import {
  DEFAULT_TEXT_REVEAL_SETTINGS,
  TextRevealArrangementMode,
} from "../src/transitions/text-reveal.js";

const SETTINGS_OVERRIDE = Object.freeze({
  enabled: true,
  holdSeconds: 0.5,
  maximumHoldShare: 0.6,
  edgeWeights: Object.freeze({
    idleBefore: 1,
    rampOut: 1,
    rampBack: 1,
    idleAfter: 1,
  }),
  threshold: 1,
  contrast: 0.01,
  softness: 0,
});

function endpointAt(phase, progress) {
  return { phase, progress, durationSeconds: 2 };
}

test("noise visibility owns the former text envelope as a standalone transition", () => {
  const transition = new NoiseVisibilityTransition(SETTINGS_OVERRIDE);
  const amountAt = progress => transition.effects(endpointAt("start", progress))
    .noiseVisibility.amount;

  assert.equal(amountAt(0), 0);
  assert.equal(amountAt(0.1875), 0);
  assert.equal(amountAt(0.28125), 0.5);
  assert.equal(amountAt(0.375), 1);
  assert.equal(amountAt(0.6), 1);
  assert.equal(amountAt(0.71875), 0.5);
  assert.equal(amountAt(0.8125), 0);
  assert.equal(amountAt(1), 0);
  assert.deepEqual(transition.effects(endpointAt("start", 0.6)).noiseVisibility, {
    amount: 1,
    threshold: 1,
    contrast: 0.01,
    softness: 0,
  });
  assert.equal(
    transition.effects(endpointAt("end", 1 - 0.28125)).noiseVisibility.amount,
    0.5,
  );

  const text = new TextRevealArrangementMode({ text: "TITLE" });
  assert.equal(Object.hasOwn(DEFAULT_TEXT_REVEAL_SETTINGS, "noiseVisibility"), false);
  assert.equal(text.phaseEffectsAt, undefined);
  assert.equal(text.phaseEffectsFor, undefined);
});

test("noise visibility envelope timing is fully configurable", () => {
  const transition = new NoiseVisibilityTransition({
    ...SETTINGS_OVERRIDE,
    holdSeconds: 10,
    maximumHoldShare: 0.4,
    edgeWeights: {
      idleBefore: 1,
      rampOut: 2,
      rampBack: 1,
      idleAfter: 2,
    },
  });
  const windows = transition.windowsFor(2);
  const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12);

  closeTo(windows.rampOutStart, 0.1);
  closeTo(windows.holdStart, 0.3);
  closeTo(windows.holdEnd, 0.7);
  closeTo(windows.rampBackEnd, 0.8);
  assert.throws(
    () => new NoiseVisibilityTransition({ ...SETTINGS_OVERRIDE, maximumHoldShare: 1 }),
    /maximumHoldShare/,
  );
  assert.throws(
    () => new NoiseVisibilityTransition({
      ...SETTINGS_OVERRIDE,
      edgeWeights: { rampOut: 0 },
    }),
    /rampOut and rampBack.*positive/,
  );
});

test("noise visibility rejects enabled use outside noise-grid during setup", () => {
  assert.equal(SETTINGS.noiseGrid.noiseVisibilityTransition.enabled, true);
  assert.equal(SETTINGS.noiseGrid.noiseVisibilityTransition.maximumHoldShare, 0.6);
  assert.deepEqual(SETTINGS.noiseGrid.noiseVisibilityTransition.edgeWeights, {
    idleBefore: 1,
    rampOut: 1,
    rampBack: 1,
    idleAfter: 1,
  });
  assert.equal(SETTINGS.gameOfLife.noiseVisibilityTransition, undefined);
  assert.equal(
    createNoiseVisibilityTransition({
      compositionId: "game-of-life",
      settings: { ...SETTINGS_OVERRIDE, enabled: false },
    }),
    null,
  );
  assert.throws(
    () => createNoiseVisibilityTransition({
      compositionId: "game-of-life",
      settings: SETTINGS_OVERRIDE,
    }),
    /Composition "game-of-life".*Supported compositions: noise-grid/,
  );

  const settings = structuredClone(SETTINGS);
  settings.gameOfLife.noiseVisibilityTransition = SETTINGS_OVERRIDE;
  const { director } = createHeadlessDirector({ settings });
  assert.throws(
    () => director.use("game-of-life"),
    /Composition "game-of-life".*Supported compositions: noise-grid/,
  );
  director.dispose();
});
