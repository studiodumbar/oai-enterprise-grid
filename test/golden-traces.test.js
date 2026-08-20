// Golden traces.
//
// Each composition is run headlessly and its debug log plus draw volume is
// compared against a committed baseline. These files are the regression net for
// the structural stages of REFACTOR_PLAN.md: a stage that claims to preserve
// behavior must leave every trace byte-identical, and a stage that changes
// behavior on purpose must show exactly what changed in the diff.
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

test("every composition has a stable headless trace", async () => {
  if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });
  const update = process.env.UPDATE_GOLDEN === "1";
  const written = [];

  for (const composition of COMPOSITIONS) {
    const run = await runFrames({ composition, frames: FRAMES, channels: CHANNELS });
    const trace = renderTrace(composition, run);
    const path = join(GOLDEN_DIR, `${composition}.trace.txt`);

    if (update || !existsSync(path)) {
      writeFileSync(path, trace);
      written.push(composition);
      continue;
    }

    assert.equal(
      trace,
      readFileSync(path, "utf8"),
      `Headless trace for "${composition}" changed. If the change is intended, `
      + "review the diff and regenerate with UPDATE_GOLDEN=1.",
    );
  }

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
  // flock is exempt from the refactor but still traced, so an accidental
  // change to shared code shows up here instead of silently.
  assert.ok(COMPOSITIONS.includes("flock"));
});
