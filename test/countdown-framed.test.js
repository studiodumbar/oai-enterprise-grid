import test from "node:test";
import assert from "node:assert/strict";

import { PALETTES, SETTINGS } from "../config.js";
import {
  CountdownFramedGenerator,
  countdownCellIndex,
  formatCountdown,
} from "../src/generators/countdown-framed-generator.js";
import { createCountingContext, runFrames } from "../src/debug/headless.js";

function createGenerator({ seed = 123, viewport = { width: 900, height: 600 } } = {}) {
  return new CountdownFramedGenerator({
    name: "countdownFramedGrid",
    settingsKey: "countdownFramed",
    options: SETTINGS.countdownFramed,
    palettes: PALETTES,
    runtime: {
      viewport: () => viewport,
      projectSeed: () => seed,
    },
  });
}

test("countdown labels include the full 03:00 through 00:00 range", () => {
  assert.equal(formatCountdown(180), "03:00");
  assert.equal(formatCountdown(179), "02:59");
  assert.equal(formatCountdown(1), "00:01");
  assert.equal(formatCountdown(0), "00:00");
});

test("countdown chooses deterministic cells without consecutive repeats", () => {
  const first = Array.from({ length: 181 }, (_, tick) => (
    countdownCellIndex(42, tick, 15)
  ));
  const second = Array.from({ length: 181 }, (_, tick) => (
    countdownCellIndex(42, tick, 15)
  ));

  assert.deepEqual(first, second);
  assert.ok(first.every(index => index >= 0 && index < 15));
  assert.ok(first.slice(1).every((index, tick) => index !== first[tick]));
  assert.notDeepEqual(
    first,
    Array.from({ length: 181 }, (_, tick) => countdownCellIndex(43, tick, 15)),
  );
});

test("countdown changes once per second and holds 00:00 for the last second", () => {
  const generator = createGenerator();
  generator.enter({ time: 0 });

  generator.update({ time: 0.999 });
  assert.equal(generator.inspect().label, "03:00");
  const firstCell = generator.inspect().cellIndex;

  generator.update({ time: 1 });
  assert.equal(generator.inspect().label, "02:59");
  assert.notEqual(generator.inspect().cellIndex, firstCell);

  generator.update({ time: 180.999 });
  assert.equal(generator.inspect().label, "00:00");
  generator.update({ time: 181 });
  assert.equal(generator.inspect().label, "03:00");
  assert.equal(generator.animationDuration(), 181);
});

test("countdown draws one centered text label and exposes tick changes headlessly", async () => {
  const generator = createGenerator();
  const context = createCountingContext();
  const calls = [];
  context.fillText = (...args) => {
    context.counts.text += 1;
    calls.push(args);
  };
  generator.enter({ time: 1 });
  generator.draw({}, {}, context);

  assert.equal(context.counts.text, 1);
  assert.equal(calls[0][0], "02:59");
  assert.equal(context.textAlign, "center");
  assert.equal(context.textBaseline, "middle");

  const run = await runFrames({
    composition: "countdown-framed",
    frames: 125,
    channels: ["cells"],
  });
  assert.ok(run.lines.some(line => line.includes("label=03:00")));
  assert.ok(run.lines.some(line => line.includes("label=02:59")));
  assert.ok(run.lines.some(line => line.includes("label=02:58")));
  assert.ok(run.drawCounts.every(frame => frame.text === 1));
  generator.dispose();
});
