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
  threshold: 1,
  contrast: 0.01,
  softness: 0,
});

function endpointAt(phase, progress) {
  return { phase, progress, durationSeconds: 2 };
}

test("noise visibility reveals on intro and clears on outro", () => {
  const transition = new NoiseVisibilityTransition(SETTINGS_OVERRIDE);
  const amountAt = (phase, progress) => transition.effects(endpointAt(phase, progress))
    ?.noiseVisibility.amount;

  assert.equal(amountAt("start", 0), 1);
  assert.equal(amountAt("start", 0.5), 0.5);
  assert.equal(amountAt("start", 1), 0);
  assert.equal(amountAt("end", 0), 0);
  assert.equal(amountAt("end", 0.5), 0.5);
  assert.equal(amountAt("end", 1), 1);
  assert.equal(transition.effects(endpointAt("core", 0.5)), null);
  assert.deepEqual(transition.effects(endpointAt("start", 0.6)).noiseVisibility, {
    amount: 0.4,
    threshold: 1,
    contrast: 0.01,
    softness: 0,
  });
  assert.deepEqual(transition.inspect().order, ["intro", "hold", "outro"]);

  const text = new TextRevealArrangementMode({ text: "TITLE" });
  assert.equal(Object.hasOwn(DEFAULT_TEXT_REVEAL_SETTINGS, "noiseVisibility"), false);
  assert.equal(text.phaseEffectsAt, undefined);
  assert.equal(text.phaseEffectsFor, undefined);
});

test("noise-grid runs intro, flow hold, and outro in export order", () => {
  const { director } = createHeadlessDirector({ composition: "noise-grid" });
  const frame = (dt, frameIndex) => ({
    dt,
    compositionDt: dt,
    time: 0,
    frameIndex,
    viewport: { width: 900, height: 600 },
  });

  director.update(frame(0, 0));
  assert.equal(director.animationDuration(), 9);
  assert.equal(director.inspect().timeline.phase, "start");
  assert.equal(director.generator("noiseGrid").inspect().visibilitySettings.threshold, 1);

  director.update(frame(1.5 + 1e-9, 1));
  assert.equal(director.inspect().timeline.phase, "core");
  assert.equal(director.generator("noiseGrid").inspect().visibilitySettings.threshold, 0.36);

  director.update(frame(6, 2));
  assert.equal(director.inspect().timeline.phase, "end");
  director.update(frame(0.75, 3));
  const halfway = director.generator("noiseGrid").inspect().visibilitySettings;
  assert.ok(Math.abs(halfway.threshold - 0.68) < 1e-9);
  assert.deepEqual(director.inspect().noiseVisibilityTransition.order, [
    "intro", "hold", "outro",
  ]);
  director.dispose();
});

test("noise visibility validates its authored clear field", () => {
  assert.throws(
    () => new NoiseVisibilityTransition({
      ...SETTINGS_OVERRIDE,
      contrast: 0,
    }),
    /contrast must be a finite positive number/,
  );
  assert.throws(
    () => new NoiseVisibilityTransition({ ...SETTINGS_OVERRIDE, threshold: 2 }),
    /threshold must be between 0 and 1/,
  );
});

test("noise visibility rejects enabled use outside noise-grid during setup", () => {
  assert.equal(SETTINGS.noiseGrid.noiseVisibilityTransition.enabled, true);
  assert.equal(SETTINGS.noiseGrid.circleEndpoints.start.enabled, true);
  assert.equal(SETTINGS.noiseGrid.circleEndpoints.start.mode, "native");
  assert.equal(SETTINGS.noiseGrid.circleEndpoints.end.enabled, true);
  assert.equal(SETTINGS.noiseGrid.circleEndpoints.end.mode, "native");
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
