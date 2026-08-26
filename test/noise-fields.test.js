import test from "node:test";
import assert from "node:assert/strict";

import { createNoiseFieldRegistry, NoiseFieldSampler, resolveNoiseFieldSettings } from "../src/noise-fields/index.js";
import { createHeadlessDirector } from "../src/debug/headless.js";
import { diogoniseNoiseSettings } from "../src/export/diogonisator.js";
import { GradientNoiseField } from "../src/noise-fields/gradient-mode.js";
import { legacyHash33 } from "../src/noise-fields/voronoi-mode.js";

function settings(overrides = {}) {
  const registry = createNoiseFieldRegistry();
  const timing = { bodyDurationSeconds: 8, beatCount: 8, beatSeconds: 1 };
  const resolved = resolveNoiseFieldSettings({}, overrides, { modeRegistry: registry, timing });
  resolved.timing = timing;
  return { registry, resolved };
}

test("noise registry ships isolated field modes including color-only life", () => {
  const first = createNoiseFieldRegistry();
  const second = createNoiseFieldRegistry();
  assert.deepEqual(first.list(), ["value", "voronoi", "gradient", "simplex", "life"]);
  first.register({ name: "local", defaults: {}, loopable: true, minimumLoopCycles: 1, shaderMode: "unsupported", createField: () => ({ sampleAt: () => 0 }) });
  assert.equal(second.has("local"), false);
  assert.throws(() => second.get("missing"), /Available noise field modes/);
});

test("gradient timing and Voronoi hashing retain the legacy shader units", () => {
  const drifting = new GradientNoiseField({ frequency: 1 }, 0, null);
  assert.deepEqual(
    [0, 0.5, 1, 1.5, 2].map(z => drifting.sampleAt(0, 0, z)),
    [0, 0.5, 1, 0.5, 0],
  );
  const looping = new GradientNoiseField({ frequency: 1 }, 0, 1);
  assert.equal(looping.sampleAt(0.25, 0, 0), looping.sampleAt(0.25, 0, 1));
  assert.deepEqual(
    legacyHash33(1, 2, 3).map(value => Number(value.toFixed(12))),
    [0.861803775537, 0.27637386663, 0.191402458481],
  );
});

test("noise settings default to five levels and enforce mode cycle and hold contracts", () => {
  assert.equal(settings().resolved.levelCount, 5);
  assert.equal(settings().resolved.layers.color.holdSeconds, 0.2);
  assert.equal(settings().resolved.layers.visibility.holdSeconds, 0.2);
  assert.equal(settings({ layers: { color: { holdSeconds: "auto" } } }).resolved.layers.color.holdSeconds, 1);
  assert.equal(
    settings({ layers: { visibility: { holdSeconds: "calc(auto * 2)" } } })
      .resolved.layers.visibility.holdSeconds,
    2,
  );
  assert.equal(
    settings({ layers: { color: { holdSeconds: "calc(auto * 0.5)" } } })
      .resolved.layers.color.holdSeconds,
    0.5,
  );
  assert.throws(() => settings({ layers: { size: { holdSeconds: 2 } } }), /not supported/);
  assert.throws(() => settings({ layers: { color: { holdSeconds: "beat" } } }), /finite positive number/);
  assert.throws(() => settings({ layers: { size: { cyclesPerLoop: 1 } } }), /absolute value of at least 2/);
  assert.equal(
    settings({ layers: { size: { cyclesPerLoop: "auto" } } }).resolved.layers.size.cyclesPerLoop,
    8,
  );
  assert.equal(
    settings({ layers: { size: { cyclesPerLoop: "calc(auto * 0.5)" } } })
      .resolved.layers.size.cyclesPerLoop,
    4,
  );
  assert.throws(
    () => settings({ layers: { size: { cyclesPerLoop: "calc(auto * 0.3)" } } }),
    /positive integer/,
  );
  assert.throws(
    () => settings({ layers: { size: { cyclesPerLoop: 2, speed: 0.1 } } }),
    /cannot author both speed and non-zero cyclesPerLoop/,
  );
  assert.doesNotThrow(() => settings({ layers: { size: { mode: "gradient", cyclesPerLoop: -1 } } }));
  assert.doesNotThrow(() => settings({ layers: { size: { mode: "simplex", cyclesPerLoop: 0 } } }));
  assert.doesNotThrow(() => settings({ layers: { size: { mode: "simplex", cyclesPerLoop: 0, speed: 0.1 } } }));
  assert.throws(() => settings({ layers: { size: { mode: "simplex", cyclesPerLoop: 1 } } }), /cannot close/);
  assert.throws(() => settings({ layers: { size: { mode: "life", cyclesPerLoop: 0 } } }), /only these layers: color/);
  assert.doesNotThrow(() => settings({ layers: { color: { mode: "life", cyclesPerLoop: 0 } } }));
});

test("CPU sampler returns quantized 4x, 1x, and exact 16x pyramids with loop seams", () => {
  const { registry, resolved } = settings();
  const sampler = new NoiseFieldSampler({ modeRegistry: registry });
  const input = { layout: { columns: 3, rows: 2 }, projectSeed: 0xffffffff, settings: resolved, backend: "cpu" };
  const start = sampler.sample({ ...input, progress: 0 });
  const end = sampler.sample({ ...input, progress: 1 });
  assert.equal(start.size.length, 6);
  assert.equal(start.color.length, 6);
  assert.deepEqual(start.contrastLevels.map(level => level.data.length), [1536, 384, 96, 24, 6]);
  assert.deepEqual(start.visibilityLevels.map(level => level.data.length), [1536, 384, 96, 24, 6]);
  assert.deepEqual(start.size, end.size);
  assert.deepEqual(start.color, end.color);
  const copy = start.size.slice();
  sampler.sample({ ...input, progress: 0.25 });
  assert.deepEqual(start.size, copy);
});

test("color and visibility fields remain continuous underneath output holds", () => {
  const configured = settings({
    layers: {
      color: { mode: "gradient", cyclesPerLoop: 2, holdSeconds: 1 },
      visibility: { mode: "gradient", cyclesPerLoop: 2, holdSeconds: 1 },
    },
  });
  const input = { layout: { columns: 3, rows: 2 }, projectSeed: 7, backend: "cpu" };
  const sampler = new NoiseFieldSampler({ modeRegistry: configured.registry });
  const start = sampler.sample({
    ...input, progress: 0, timeSeconds: 0, settings: configured.resolved,
  });
  const moved = sampler.sample({
    ...input, progress: 0.05, timeSeconds: 0.4, settings: configured.resolved,
  });
  assert.notDeepEqual(start.color, moved.color);
  assert.notDeepEqual(
    start.visibilityLevels[0].data,
    moved.visibilityLevels[0].data,
  );
});

test("explicit shader fails while auto falls back to the complete CPU sampler", () => {
  const { registry, resolved } = settings();
  const sampler = new NoiseFieldSampler({ modeRegistry: registry });
  const input = { layout: { columns: 1, rows: 1 }, progress: 0, projectSeed: 1, settings: resolved };
  assert.throws(() => sampler.sample({ ...input, backend: "shader" }), /shader backend failed/i);
  assert.equal(sampler.sample({ ...input, backend: "auto" }).backend, "cpu");
});

test("speed animates simplex as documented free drift rather than a seamless loop", () => {
  const { registry, resolved } = settings({
    layers: { size: { mode: "simplex", cyclesPerLoop: 0, speed: 0.12 } },
  });
  const sampler = new NoiseFieldSampler({ modeRegistry: registry });
  const input = {
    layout: { columns: 3, rows: 2 }, progress: 0,
    projectSeed: 7, settings: resolved, backend: "cpu",
  };
  const start = sampler.sample({ ...input, timeSeconds: 0 });
  const moved = sampler.sample({ ...input, progress: 0.5, timeSeconds: 4 });
  const end = sampler.sample({ ...input, progress: 1, timeSeconds: 8 });
  assert.notDeepEqual(start.size, moved.size);
  assert.notDeepEqual(start.size, end.size);
});

test("noise-grid lifecycle draws level-four glyphs and returns copied preview planes", () => {
  const headless = createHeadlessDirector({ composition: "noise-grid" });
  const { director, context } = headless;
  director.update({ dt: 0, compositionDt: 0, time: 0, frameIndex: 0, viewport: { width: 900, height: 600 } });
  director.draw({ time: 0, frameIndex: 0 });
  const generator = director.generator("noiseGrid");
  assert.equal(generator.noiseSettings.layers.color.holdSeconds, 0.2);
  assert.equal(generator.settingsSnapshot().noiseFields.layers.color.holdSeconds, 0.2);
  const first = generator.noisePreviewSnapshot();
  const dense = generator.noisePreviewSnapshot({ previewWidth: 160, previewHeight: 90 });
  assert.equal(dense.size.length, 160 * 90);
  assert.equal(dense.color.length, 160 * 90);
  assert.deepEqual(dense.previewDimensions, { width: 160, height: 90 });
  assert.deepEqual(first.size, generator.noisePreviewSnapshot().size);
  assert.deepEqual(first.color, generator.noisePreviewSnapshot().color);
  generator.seek(1);
  assert.notDeepEqual(first.size, generator.noisePreviewSnapshot().size);
  generator.seek(0);
  first.size.fill(0);
  const second = generator.noisePreviewSnapshot();
  assert.ok(second.size.some(value => value !== 0));
  assert.ok(context.counts.fill > 0);
  generator.sampled.size.fill(0);
  assert.ok(generator.transitionItems().some(item => item.id.endsWith(":255")));
  assert.equal(generator.seek(4), true);
  assert.equal(generator.restoreProjectState(generator.snapshotProjectState()), true);
  director.dispose();
  assert.doesNotThrow(() => generator.dispose());
});

test("noise-grid size uses legacy dark-to-fine bands and invert direction", () => {
  const { director } = createHeadlessDirector({ composition: "noise-grid" });
  const generator = director.generator("noiseGrid");
  generator.sampled.size = Uint8Array.from([0, 64, 128, 192, 255]);
  generator.noiseSettings.layers.size.gamma = 1;
  generator.noiseSettings.layers.size.emptyBelow = 0;
  generator.noiseSettings.layers.size.invert = false;
  assert.deepEqual(
    Array.from(generator.sampled.size, (_, index) => generator.levelForCell(index)),
    [4, 3, 2, 1, 0],
  );
  generator.noiseSettings.layers.size.invert = true;
  assert.deepEqual(
    Array.from(generator.sampled.size, (_, index) => generator.levelForCell(index)),
    [0, 1, 2, 3, 4],
  );
  director.dispose();
});

test("noise-grid keeps continuous color values until contrast palette snapping", () => {
  const { director } = createHeadlessDirector({
    composition: "noise-grid",
    viewport: { width: 300, height: 300 },
  });
  const generator = director.generator("noiseGrid");
  generator.sampled.size.fill(255);
  generator.sampled.color.fill(1);
  generator.sampled.color[1] = 50;
  generator.sampled.contrastLevels[4].data.fill(200);
  generator.sampled.visibilityLevels[4].data.fill(255);
  generator.resetOutputState(0);
  const colors = [];
  const context = {
    fillStyle: "#000000",
    save() {}, restore() {}, fillRect() {}, translate() {}, scale() {},
    beginPath() {}, moveTo() {}, arc() {},
    fill() { colors.push(this.fillStyle); },
  };
  generator.draw({}, {}, context);
  assert.notEqual(colors[0], colors[1]);
  director.dispose();
});

test("authored color and visibility fields advance inside a beat", () => {
  const { director } = createHeadlessDirector({ composition: "noise-grid" });
  const generator = director.generator("noiseGrid");
  generator.seek(0);
  const start = generator.noisePreviewSnapshot();
  generator.seek(0.4);
  const moved = generator.noisePreviewSnapshot();
  assert.notDeepEqual(start.color, moved.color);
  assert.notDeepEqual(start.visibility, moved.visibility);
  director.dispose();
});

test("per-glyph output holds reconstruct identically through absolute seek", () => {
  const first = createHeadlessDirector({ composition: "noise-grid" });
  const second = createHeadlessDirector({ composition: "noise-grid" });
  const firstGenerator = first.director.generator("noiseGrid");
  const secondGenerator = second.director.generator("noiseGrid");
  assert.equal(firstGenerator.seek(0.35), true);
  assert.equal(secondGenerator.seek(0.35), true);
  assert.deepEqual(firstGenerator.noisePreviewSnapshot(), secondGenerator.noisePreviewSnapshot());
  first.director.dispose();
  second.director.dispose();
});

test("diogonisator output restores through the canonical noise-grid settings contract", () => {
  const { director } = createHeadlessDirector({ composition: "noise-grid" });
  const generator = director.generator("noiseGrid");
  const settings = diogoniseNoiseSettings({
    bgColor: "#ffffff",
    colorSet: "blue",
    longCells: 5,
    maskType: "gradient",
    maskThreshold: 0.35,
    duration: 10,
  });
  assert.equal(generator.restoreProjectState({
    version: 3,
    settings,
    time: 4,
    timeline: { version: 1, tracks: {} },
  }), true);
  const snapshot = generator.snapshotProjectState();
  assert.equal(Object.hasOwn(snapshot, "params"), false);
  assert.equal(snapshot.settings.backgroundColor, "#ffffff");
  assert.equal(snapshot.settings.longSideCells, 5);
  assert.equal(snapshot.settings.noiseFields.layers.visibility.mode, "gradient");
  assert.equal(snapshot.settings.noiseFields.layers.visibility.threshold, 0.35);
  assert.equal(snapshot.settings.durationSeconds, 10);
  assert.deepEqual(snapshot.settings.paletteColors, [
    "#013566", "#004f99", "#0169cc", "#0285ff", "#48aaff",
  ]);
  director.dispose();
});
