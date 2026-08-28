import test from "node:test";
import assert from "node:assert/strict";

import {
  requireMatchingTimelineValue,
  resolveTimelineDuration,
  resolveTimelineSettings,
} from "../src/timeline/timeline-settings.js";

test("timeline settings resolve the absolute body root into an immutable beat", () => {
  const authored = { bodyDurationSeconds: 12, beatCount: 6 };
  const resolved = resolveTimelineSettings(authored, "demo.timing");

  assert.deepEqual(resolved, {
    bodyDurationSeconds: 12,
    beatCount: 6,
    beatSeconds: 2,
  });
  assert.equal(Object.isFrozen(resolved), true);
  assert.deepEqual(authored, { bodyDurationSeconds: 12, beatCount: 6 });
});

test("fixed-beat timing keeps one beat root while body duration stays dynamic", () => {
  const authored = { mode: "fixed-beat", beatSeconds: 3 };
  const resolved = resolveTimelineSettings(authored, "interactive.timing");

  assert.deepEqual(resolved, {
    mode: "fixed-beat",
    beatSeconds: 3,
  });
  assert.equal(Object.isFrozen(resolved), true);
  assert.deepEqual(authored, { mode: "fixed-beat", beatSeconds: 3 });
});

test("timeline durations preserve explicit values instead of consulting auto", () => {
  assert.deepEqual(
    resolveTimelineDuration(1.25, {
      automaticSeconds: 2,
      label: "demo.intro.durationSeconds",
      source: "composition-beat",
    }),
    {
      authored: 1.25,
      source: "explicit",
      baseSeconds: 1.25,
      multiplier: 1,
      seconds: 1.25,
    },
  );
});

test("timeline durations resolve auto and calc(auto * n) from one named parent", () => {
  assert.deepEqual(
    resolveTimelineDuration("auto", {
      automaticSeconds: 2,
      label: "demo.intro.durationSeconds",
      source: "composition-beat",
    }),
    {
      authored: "auto",
      source: "composition-beat",
      baseSeconds: 2,
      multiplier: 1,
      seconds: 2,
    },
  );
  assert.deepEqual(
    resolveTimelineDuration("calc(auto * 1.5)", {
      automaticSeconds: 2,
      label: "demo.outro.durationSeconds",
      source: "intro-duration",
    }),
    {
      authored: "calc(auto * 1.5)",
      source: "intro-duration",
      baseSeconds: 2,
      multiplier: 1.5,
      seconds: 3,
    },
  );
});

test("timeline roots and automatic children reject incomplete timing graphs", () => {
  assert.throws(
    () => resolveTimelineSettings(null, "demo.timing"),
    /demo\.timing must be an object/,
  );
  assert.throws(
    () => resolveTimelineSettings({ bodyDurationSeconds: "auto", beatCount: 4 }, "demo.timing"),
    /demo\.timing\.bodyDurationSeconds must be a finite positive number/,
  );
  assert.throws(
    () => resolveTimelineSettings({ bodyDurationSeconds: 4, beatCount: 1.5 }, "demo.timing"),
    /demo\.timing\.beatCount must be a positive integer/,
  );
  assert.throws(
    () => resolveTimelineSettings({
      bodyDurationSeconds: Number.MIN_VALUE,
      beatCount: 2,
    }, "demo.timing"),
    /demo\.timing\.beatSeconds must be a finite positive number/,
  );
  assert.throws(
    () => resolveTimelineSettings({ mode: "fixed-beat", beatSeconds: 0 }, "demo.timing"),
    /demo\.timing\.beatSeconds must be a finite positive number/,
  );
  assert.throws(
    () => resolveTimelineSettings({ mode: "moving-target", beatSeconds: 2 }, "demo.timing"),
    /demo\.timing\.mode must be "fixed-body" or "fixed-beat"/,
  );
  assert.throws(
    () => resolveTimelineSettings({
      mode: "fixed-beat",
      beatSeconds: 2,
      bodyDurationSeconds: 8,
      beatCount: 4,
    }, "demo.timing"),
    /fixed-beat timing cannot also declare bodyDurationSeconds or beatCount/,
  );
  assert.throws(
    () => resolveTimelineDuration("auto", {
      automaticSeconds: undefined,
      label: "demo.intro.durationSeconds",
      source: "composition-beat",
    }),
    /no positive automatic duration candidate was available/,
  );
  assert.throws(
    () => resolveTimelineDuration("calc(auto + 1)", {
      automaticSeconds: 2,
      label: "demo.intro.durationSeconds",
      source: "composition-beat",
    }),
    /must be a finite positive number, "auto", or "calc\(auto \* n\)"/,
  );
  assert.throws(
    () => resolveTimelineDuration("calc(auto * 2)", {
      automaticSeconds: Number.MAX_VALUE,
      label: "demo.intro.durationSeconds",
      source: "composition-beat",
    }),
    /resolves outside the finite positive range/,
  );
});

test("legacy clock aliases may agree with the root but cannot replace it", () => {
  assert.equal(
    requireMatchingTimelineValue(2, 2, {
      label: "previewSeconds",
      source: "timing.beatSeconds",
    }),
    2,
  );
  assert.equal(
    requireMatchingTimelineValue(undefined, 2, {
      label: "previewSeconds",
      source: "timing.beatSeconds",
    }),
    2,
  );
  assert.throws(
    () => requireMatchingTimelineValue(3, 2, {
      label: "previewSeconds",
      source: "timing.beatSeconds",
    }),
    /previewSeconds.*conflicts with timing\.beatSeconds/,
  );
});
