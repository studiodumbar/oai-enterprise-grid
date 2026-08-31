import test from "node:test";
import assert from "node:assert/strict";

import { SETTINGS } from "../config.js";
import {
  DEBUG_CHANNEL_NAMES,
  captureDebug,
  debug,
  formatDebugLine,
  parseDebugChannels,
  resolveDebugChannels,
} from "../src/debug/index.js";
import { CompositionTimelineDebug } from "../src/debug/composition-timeline.js";
import { diffPlainState, toPlainState } from "../src/debug/plain.js";
import {
  createCountingContext,
  createHeadlessDirector,
  runFrames,
} from "../src/debug/headless.js";

test("channel selectors accept lists and reject typos", () => {
  assert.deepEqual(parseDebugChannels(""), []);
  assert.deepEqual(parseDebugChannels(undefined), []);
  assert.deepEqual(parseDebugChannels("timeline,transition"), ["timeline", "transition"]);
  assert.deepEqual(parseDebugChannels("timeline transition"), ["timeline", "transition"]);
  assert.deepEqual(parseDebugChannels("all"), [...DEBUG_CHANNEL_NAMES]);
  assert.deepEqual(parseDebugChannels(["plan"]), ["plan"]);

  // A silently ignored typo would send an agent hunting a channel that never
  // emits, so an unknown name must fail loudly and list the alternatives.
  assert.throws(() => parseDebugChannels("timelime"), /Unknown debug channel/);
  assert.throws(() => parseDebugChannels("timelime"), /timeline/);
});

test("a URL query overrides authored debug config", () => {
  assert.deepEqual(
    resolveDebugChannels({ search: "?debug=plan", config: { channels: "timeline" } }),
    ["plan"],
  );
  assert.deepEqual(
    resolveDebugChannels({ search: "?composition=voronoi", config: { channels: "timeline" } }),
    ["timeline"],
  );
  assert.deepEqual(resolveDebugChannels({}), []);
  // An explicit empty query disables everything, config notwithstanding.
  assert.deepEqual(
    resolveDebugChannels({ search: "?debug=", config: { channels: "timeline" } }),
    [],
  );
});

test("the formatter keeps lines greppable and precision stable", () => {
  assert.equal(formatDebugLine("phase=%s cycle=%d", ["intro", 2.9]), "phase=intro cycle=2");
  assert.equal(formatDebugLine("p=%.3f", [0.4126]), "p=0.413");
  assert.equal(formatDebugLine("raw=%f", [0.5]), "raw=0.5");
  assert.equal(formatDebugLine("at=%j", [{ a: 1 }]), 'at={"a":1}');
  assert.equal(formatDebugLine("100%% done", []), "100% done");
});

test("channels rate-limit by policy so a hot path cannot flood", () => {
  const lines = captureDebug(["timeline", "cells"], () => {
    debug.setFrame(0);
    // "change" policy: only a differing line is emitted.
    debug.timeline("phase=%s", "start");
    debug.timeline("phase=%s", "start");
    debug.timeline("phase=%s", "core");

    // Numeric policy: at most once every N frames.
    debug.cells("count=%d", 1);
    debug.setFrame(5);
    debug.cells("count=%d", 2);
    debug.setFrame(40);
    debug.cells("count=%d", 3);
  });

  assert.deepEqual(lines, [
    "[cg:timeline] f=0000 phase=start",
    "[cg:timeline] f=0000 phase=core",
    "[cg:cells] f=0000 count=1",
    "[cg:cells] f=0040 count=3",
  ]);
});

test("disabled channels cost nothing and capture restores the previous sink", () => {
  const before = debug.channels();
  const lines = captureDebug(["plan"], () => {
    assert.equal(debug.on.plan, true);
    assert.equal(debug.on.timeline, false);
    assert.equal(debug.timeline("ignored"), false);
    assert.equal(debug.plan("render=[%s]", "grid"), true);
  });
  assert.deepEqual(lines, ["[cg:plan] f=0000 render=[grid]"]);
  assert.deepEqual(debug.channels(), before);
});

test("composition timeline debug mirrors active canvas states to the timeline channel", () => {
  const timeline = new CompositionTimelineDebug({
    compositionId: "countdown-framed",
    items: [
      { id: "track:clock", label: "CLOCK" },
      { id: "connection:clock-snake", label: "CLOCK→SNAKE" },
      { id: "track:snake", label: "SNAKE" },
    ],
  });
  const context = createCountingContext();
  const labels = [];
  context.fillText = text => labels.push(text);

  const lines = captureDebug(["timeline"], () => {
    timeline.update({ activeIds: ["track:clock"], elapsedSeconds: 0 });
    assert.equal(timeline.draw(context, { width: 640, height: 480 }), true);
    timeline.update({ activeIds: ["track:clock"], elapsedSeconds: 0.5 });
    timeline.update({
      activeIds: ["track:clock", "connection:clock-snake", "track:snake"],
      elapsedSeconds: 5,
    });
  });

  assert.deepEqual(labels, ["CLOCK", "·", "CLOCK→SNAKE", "·", "SNAKE"]);
  assert.equal(lines.length, 2, "elapsed time alone must not flood the change-only channel");
  assert.match(lines[0], /active=track:clock states=track:clock:on/);
  assert.match(
    lines[1],
    /active=track:clock,connection:clock-snake,track:snake/,
  );
  assert.deepEqual(
    timeline.inspect().items.map(item => [item.id, item.active]),
    [
      ["track:clock", true],
      ["connection:clock-snake", true],
      ["track:snake", true],
    ],
  );
});

test("composition timeline debug stays off-canvas when disabled or exporting", () => {
  const timeline = new CompositionTimelineDebug({
    compositionId: "countdown-framed",
    items: [{ id: "clock", label: "CLOCK" }],
  });
  const context = createCountingContext();
  assert.equal(timeline.draw(context, { width: 640, height: 480 }), false);
  captureDebug(["timeline"], () => {
    timeline.update({ activeIds: ["clock"], elapsedSeconds: 0 });
    assert.equal(
      timeline.draw(context, { width: 640, height: 480 }, { exporting: true }),
      false,
    );
  });
  assert.equal(context.counts.save, 0);
});

test("inspection state is copied, not aliased, so frames can be diffed", () => {
  const live = { energy: new Float32Array([1, 2, 3]), nested: { level: 2 } };
  const first = toPlainState(live);
  live.energy[0] = 99;
  live.nested.level = 3;
  const second = toPlainState(live);

  assert.deepEqual(first.energy, [1, 2, 3]);
  assert.deepEqual(second.energy, [99, 2, 3]);
  assert.equal(JSON.stringify(first).length > 0, true);

  assert.deepEqual(diffPlainState(first, second), [
    { path: "energy", before: [1, 2, 3], after: [99, 2, 3] },
    { path: "nested.level", before: 2, after: 3 },
  ]);
});

test("plain state survives cycles, non-finite numbers, and functions", () => {
  const cyclic = { name: "root" };
  cyclic.self = cyclic;
  const plain = toPlainState({
    cyclic,
    ratio: Number.POSITIVE_INFINITY,
    callback: () => {},
  });
  assert.equal(plain.cyclic.self, "<cycle>");
  assert.equal(plain.ratio, "Infinity");
  assert.equal(Object.hasOwn(plain, "callback"), false);
  assert.doesNotThrow(() => JSON.stringify(plain));
});

test("the headless driver runs a real composition with no browser", async () => {
  const settings = structuredClone(SETTINGS);
  settings.composition = {
    ...settings.composition,
    startWithCircle: true,
    startWithCircleDurationSeconds: 0.5,
  };
  settings.base.circleEndpoints.start = {
    ...settings.base.circleEndpoints.start,
    enabled: true,
    durationSeconds: 0.5,
  };
  const run = await runFrames({
    composition: "base",
    frames: 90,
    channels: ["timeline", "transition", "plan"],
    settings,
  });

  assert.equal(run.drawCounts.length, 90);
  assert.ok(run.lines.length > 0);
  assert.ok(run.lines.every(line => /^\[cg:[a-z]+\] f=\d{4} /.test(line)));
  assert.doesNotThrow(() => JSON.stringify(run.snapshots));

  // The timeline is observable — this is the state that was previously
  // computed every frame and reported by nobody.
  const timeline = run.snapshots[0].state.timeline;
  assert.equal(typeof timeline.phase, "string");
  assert.equal(timeline.cycleIndex, 0);
  assert.ok(Object.hasOwn(timeline, "coreTime"));

  // Endpoint plans report how many targets have no real source glyph.
  const endpointLine = run.lines.find(line => line.includes("endpoint=start"));
  assert.ok(endpointLine, "expected an endpoint transition line");
  assert.match(endpointLine, /targets=\d+ sources=\d+/);
  assert.match(endpointLine, /unpaired=\d+/);
});

test("headless runs are deterministic, so two logs can be diffed", async () => {
  const options = { composition: "l-tree", frames: 60, channels: ["timeline", "transition"] };
  const first = await runFrames(options);
  const second = await runFrames(options);
  assert.deepEqual(first.lines, second.lines);
  assert.deepEqual(first.drawCounts, second.drawCounts);
  assert.deepEqual(
    JSON.stringify(first.snapshots),
    JSON.stringify(second.snapshots),
  );
});

test("the headless director exposes draw volume per frame", async () => {
  const settings = structuredClone(SETTINGS);
  settings.base.intro.enabled = false;
  settings.base.outro.enabled = false;
  settings.base.circleEndpoints.start.enabled = false;
  settings.base.circleEndpoints.end.enabled = false;
  const { director, context } = createHeadlessDirector({ composition: "base", settings });
  const frame = {
    dt: 1 / 60,
    compositionDt: 1 / 60,
    time: 0,
    frameIndex: 0,
    viewport: { width: 900, height: 600 },
    pointer: { active: false, x: 0, y: 0 },
  };
  director.update(frame);
  director.draw(frame, context);
  assert.ok(context.counts.fill > 0, "base should draw glyphs on its first frame");
  assert.equal(context.alphaStack.length, 0, "every save must be restored");
  director.dispose();
});

test("headless setup authors state before frame zero without consuming trace logs", async () => {
  let called = false;
  const run = await runFrames({
    composition: "base",
    frames: 1,
    channels: ["timeline"],
    setup: ({ director, viewport }) => {
      called = true;
      director.update({
        dt: 0,
        compositionDt: 0,
        time: 0,
        frameIndex: 0,
        viewport,
        pointer: { active: false, x: 0, y: 0 },
      });
    },
  });

  assert.equal(called, true);
  assert.ok(run.lines.some(line => line.includes("phase=start")));
  await assert.rejects(
    () => runFrames({ composition: "base", frames: 1, setup: true }),
    /setup must be a function/,
  );
});

test("frames rejects a non-positive count instead of silently doing nothing", async () => {
  await assert.rejects(() => runFrames({ composition: "base", frames: 0 }), /positive integer/);
  await assert.rejects(() => runFrames({ composition: "base", fps: 0 }), /positive number/);
});
