import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalCompositionChoices,
  compositionPanelTelemetry,
  createCompositionPanel,
} from "../src/ui/composition-panel.js";

test("composition choices keep canonical ids and produce concise labels", () => {
  assert.deepEqual(canonicalCompositionChoices([
    "base",
    "interactive-flock",
    { id: "l-tree", label: "L-tree" },
  ]), [
    { id: "base", label: "Base" },
    { id: "interactive-flock", label: "Interactive Flock" },
    { id: "l-tree", label: "L-tree" },
  ]);
  assert.throws(() => canonicalCompositionChoices([]), /at least one/);
  assert.throws(
    () => canonicalCompositionChoices(["base", "base"]),
    /unique non-empty id/,
  );
  assert.throws(
    () => canonicalCompositionChoices([
      { id: "base", label: "Grid" },
      { id: "flock", label: "Grid" },
    ]),
    /unique label/,
  );
});

test("composition telemetry formats the shared timeline and interactive hint", () => {
  assert.deepEqual(compositionPanelTelemetry({
    compositionId: "interactive-flock",
    timeline: { phase: "core", cycleIndex: 2, coreDuration: 6 },
  }), {
    compositionId: "interactive-flock",
    phase: "core",
    cycle: "2",
    coreDuration: "6.000 s",
    instruction: "Add beat → draw launches → Play.",
  });
  assert.equal(compositionPanelTelemetry({
    compositionId: "interactive-flock",
    timeline: { rule: { interactionMode: "picasso" } },
  }).instruction, "Add beat → draw a route → Play.");
  assert.equal(compositionPanelTelemetry({
    compositionId: "interactive-flock",
    timeline: { rule: { interactionMode: "boom" } },
  }).instruction, "Add beat → drag a radius → Play.");
  assert.equal(compositionPanelTelemetry({
    compositionId: "interactive-flock",
    timeline: { rule: { interactionMode: "flow" } },
  }).instruction, "Add beat → choose Let it flow → Play.");
  assert.deepEqual(compositionPanelTelemetry({
    compositionId: "flock",
    timeline: { phase: "start", cycleIndex: 0, coreDuration: null },
  }), {
    compositionId: "flock",
    phase: "start",
    cycle: "0",
    coreDuration: "continuous",
    instruction: "",
  });
});

test("composition panel rejects incomplete integration hooks before touching the DOM", () => {
  assert.throws(() => createCompositionPanel(), /DOM container/);
  assert.throws(
    () => createCompositionPanel({ container: { append() {} }, compositions: ["base"] }),
    /current\(\) and use\(id\)/,
  );
});
