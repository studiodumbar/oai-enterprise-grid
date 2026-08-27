import test from "node:test";
import assert from "node:assert/strict";

import { GridField } from "../src/fields/grid-field.js";
import {
  FlockFieldSource,
  FlockFieldSurface,
} from "../src/fields/flock-field-source.js";
import { CircleGrid } from "../src/grid/circle-grid.js";
import { CellStateBuffer } from "../src/cell-transitions/cell-state-buffer.js";
import { Boid, Flock } from "../src/generators/flock.js";
import { FlockGridGenerator } from "../src/generators/flock-grid-generator.js";
import {
  createHeadlessDirector,
  runFrames,
} from "../src/debug/headless.js";
import { SETTINGS } from "../config.js";
import { FLOCK_GRID_CONFIG } from "../config/compositions/flock-grid.js";

const VIEWPORT = Object.freeze({ width: 100, height: 50 });
const FIELD_OPTIONS = Object.freeze({ longSidePixels: 100, boidSize: 20 });

test("the offscreen flock surface rasterizes boids and returns copied pixels", () => {
  const surface = new FlockFieldSurface(FIELD_OPTIONS, VIEWPORT);
  const flock = {
    boids: [{ active: true, x: 50, y: 25, opacity: 1, lifeProgress: 0.8 }],
  };

  surface.draw(flock);
  const first = surface.snapshot();
  const second = surface.snapshot();
  assert.deepEqual({ width: first.width, height: first.height }, { width: 100, height: 50 });
  assert.equal(first.pixels[25 * first.width + 50], 255);
  assert.ok(Math.abs(first.life[25 * first.width + 50] / 255 - 0.8) < 0.01);
  assert.ok(Math.abs(surface.lifeAt(50, 25) - 0.8) < 0.01);
  assert.equal(first.pixels[0], 0);
  first.pixels.fill(0);
  assert.ok(second.pixels.some(value => value > 0));
});

test("the offscreen flock surface rejects unusable dimensions at startup", () => {
  assert.throws(
    () => new FlockFieldSurface({ ...FIELD_OPTIONS, longSidePixels: 0 }, VIEWPORT),
    /longSidePixels must be at least 16/,
  );
  assert.throws(
    () => new FlockFieldSurface({ ...FIELD_OPTIONS, boidSize: 0 }, VIEWPORT),
    /boidSize must be a finite positive number/,
  );
});

test("wrapEdges controls whether boids wrap or remain offscreen", () => {
  const wrapped = new Boid();
  wrapped.active = true;
  wrapped.x = 99;
  wrapped.y = 25;
  wrapped.vx = 20;
  wrapped.integrate(0.1, 100, 50, 100, true);
  assert.equal(wrapped.x, 1);

  const unwrapped = new Boid();
  unwrapped.active = true;
  unwrapped.x = 99;
  unwrapped.y = 25;
  unwrapped.vx = 20;
  unwrapped.integrate(0.1, 100, 50, 100, false);
  assert.equal(unwrapped.x, 101);

  const surface = new FlockFieldSurface(FIELD_OPTIONS, VIEWPORT);
  surface.draw({ boids: [unwrapped] });
  assert.ok(surface.snapshot().pixels.every(value => value === 0));
});

test("flock rejects a non-boolean wrapEdges setting", () => {
  assert.throws(
    () => new Flock({
      count: 1,
      perceptionRadius: 10,
      wrapEdges: "yes",
    }),
    /wrapEdges must be a boolean/,
  );
});

test("every flock pulse uses the canvas center as its spawn origin", () => {
  const spawnRadius = 0.01;
  const flock = new Flock({
    count: 8,
    perceptionRadius: 10,
    birthsPerPulse: 8,
    emissionSeconds: 0.1,
    lifetimeSeconds: 10,
    initialSpeed: 20,
    spawnRadius,
  });

  flock.emitPulse(200, 100);
  for (const boid of flock.boids) {
    assert.ok(Math.hypot(boid.x - 100, boid.y - 50) <= spawnRadius + 1e-12);
  }
});

test("end-of-life progress accounts for pool recycling pressure", () => {
  const flock = new Flock({
    count: 100,
    perceptionRadius: 10,
    birthsPerPulse: 10,
    pulseEverySeconds: 0.5,
    lifetimeSeconds: 8,
  });

  assert.equal(flock.effectiveResidenceSeconds(), 5);
});

test("closer neighbours produce a faster target speed", () => {
  const options = {
    count: 2,
    perceptionRadius: 5,
    proximityRadius: 100,
    separationRadius: 5,
    maxSpeed: 200,
    maxForce: 1000,
    alignment: 0,
    cohesion: 0,
    separation: 0,
    pointerRadius: 0,
    pointerForce: 0,
    proximityExponent: 1,
  };
  const targetAtDistance = distance => {
    const flock = new Flock(options);
    Object.assign(flock.boids[0], { active: true, x: 50, y: 50, vx: 10, vy: 0 });
    Object.assign(flock.boids[1], { active: true, x: 50 + distance, y: 50, vx: 10, vy: 0 });
    flock.hash.rebuild(300, 100, flock.boids, { wrapEdges: false });
    flock.computeAcceleration(0, 300, 100, { active: false });
    return flock.boids[0].targetSpeed;
  };

  assert.equal(targetAtDistance(10), 180);
  assert.ok(Math.abs(targetAtDistance(90) - 20) < 1e-9);
  assert.equal(targetAtDistance(110), 0);
});

test("acceleration approaches density speed while drag can reach a complete stop", () => {
  const accelerating = new Boid();
  accelerating.active = true;
  accelerating.vx = 10;
  accelerating.targetSpeed = 50;
  accelerating.integrate(0.1, 100, 100, 100, false, {
    acceleration: 100,
    drag: 200,
  });
  assert.equal(Math.hypot(accelerating.vx, accelerating.vy), 20);

  const stopping = new Boid();
  stopping.active = true;
  stopping.vx = 10;
  stopping.targetSpeed = 0;
  stopping.integrate(0.1, 100, 100, 100, false, {
    acceleration: 100,
    drag: 200,
  });
  assert.equal(stopping.vx, 0);
  assert.equal(stopping.vy, 0);
});

test("flock reset discards the previous cycle instead of resuming it", () => {
  const flock = new Flock({
    count: 2,
    perceptionRadius: 10,
    birthsPerPulse: 1,
    pulseEverySeconds: 1,
    lifetimeSeconds: 4,
  });
  flock.emitPulse(100, 50);
  flock.time = 3;

  flock.reset();

  assert.equal(flock.time, 0);
  assert.equal(flock.pulseIndex, 0);
  assert.ok(flock.boids.every(boid => !boid.active && !boid.scheduled));
});

test("the visible grid samples the offscreen flock field by parent cell", () => {
  const flock = {
    boids: [{
      active: true,
      x: 25,
      y: 25,
      opacity: 1,
      endOfLifeProgress: 0.8,
    }],
  };
  const source = new FlockFieldSource(flock, FIELD_OPTIONS, VIEWPORT);
  const layout = {
    width: 100,
    height: 50,
    columns: 2,
    rows: 1,
    cellSize: 50,
    offsetX: 0,
    offsetY: 0,
  };
  const field = new GridField(layout, { fieldGain: 1 });

  source.write(field);
  assert.equal(field.resolveCell(0), 1);
  assert.equal(field.resolveCell(1), 0);
  assert.ok(Math.abs(source.lifeInCell(0, layout) - 0.8) < 0.01);
  assert.equal(source.lifeInCell(1, layout), 0);
});

test("step palette mode returns authored swatches without color interpolation", () => {
  const grid = Object.create(CircleGrid.prototype);
  grid.options = { paletteMode: "step" };
  grid.paletteColors = ["#001100", "#00aa00", "#aaffaa"];

  assert.equal(grid.paletteColor(0), "#001100");
  assert.equal(grid.paletteColor(0.34), "#00aa00");
  assert.equal(grid.paletteColor(1), "#aaffaa");
});

test("emptyBelow omits cells from both drawing and transition items", () => {
  const paths = [];
  const grid = Object.create(CircleGrid.prototype);
  grid.options = { emptyBelow: 0.01, dotMargin: 0, showCellGrid: false };
  grid.energy = new Float32Array([0, 0.5]);
  grid.layout = {
    columns: 2,
    rows: 1,
    cellSize: 10,
    offsetX: 0,
    offsetY: 0,
  };
  grid.cellState = new CellStateBuffer(2);
  grid.cellState.reset();
  grid.cellState.level[1] = 1;
  grid.paletteColor = () => "#00a240";
  grid.shapeRenderer = { addPath: (...args) => paths.push(args) };
  const context = {
    globalAlpha: 1,
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {},
    fill() {},
  };

  grid.draw(context);
  assert.equal(paths.length, 4);
  assert.deepEqual(
    grid.transitionItems().map(item => item.id),
    ["1:0", "1:1", "1:2", "1:3"],
  );
});

test("CircleGrid can prime a field immediately for an intro target", () => {
  const grid = Object.create(CircleGrid.prototype);
  grid.options = { riseSeconds: 10, fallSeconds: 10 };
  grid.layout = { columns: 1, rows: 1 };
  grid.energy = new Float32Array(1);
  grid.previousEnergy = new Float32Array(1);
  grid.field = {
    reset() {},
    resolveCell: () => 1,
  };
  grid.cellState = new CellStateBuffer(1);
  grid.cellTransition = {
    updateCell(index, state, buffer) {
      buffer.level[index] = state.energy > 0 ? 1 : 0;
    },
  };

  grid.update([{ write() {} }], 0, {}, { immediate: true });
  assert.equal(grid.energy[0], 1);
  assert.equal(grid.cellState.level[0], 1);
});

test("CircleGrid can color individual glyphs without changing their geometry", () => {
  const colors = [];
  const grid = Object.create(CircleGrid.prototype);
  grid.options = { emptyBelow: 0, dotMargin: 0, showCellGrid: false };
  grid.energy = new Float32Array([1]);
  grid.layout = {
    columns: 1,
    rows: 1,
    cellSize: 10,
    offsetX: 0,
    offsetY: 0,
  };
  grid.cellState = new CellStateBuffer(1);
  grid.cellState.reset();
  grid.cellState.level[0] = 1;
  grid.paletteColor = () => "#000000";
  grid.shapeRenderer = { addPath() {} };
  const context = {
    globalAlpha: 1,
    fillStyle: "#000000",
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {},
    fill() { colors.push(this.fillStyle); },
  };

  grid.draw(context, undefined, {
    glyphColor: item => item.glyphIndex % 2 === 0 ? "#00692a" : "#8cdfad",
  });
  assert.deepEqual(colors, ["#00692a", "#8cdfad", "#00692a", "#8cdfad"]);
});

test("CircleGrid can color a parent cell once for all of its glyphs", () => {
  const colors = [];
  let calls = 0;
  const grid = Object.create(CircleGrid.prototype);
  grid.options = { emptyBelow: 0, dotMargin: 0, showCellGrid: false };
  grid.energy = new Float32Array([1]);
  grid.layout = {
    columns: 1,
    rows: 1,
    cellSize: 10,
    offsetX: 0,
    offsetY: 0,
  };
  grid.cellState = new CellStateBuffer(1);
  grid.cellState.reset();
  grid.cellState.level[0] = 1;
  grid.paletteColor = () => "#000000";
  grid.shapeRenderer = { addPath() {} };
  const context = {
    globalAlpha: 1,
    fillStyle: "#000000",
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {},
    fill() { colors.push(this.fillStyle); },
  };

  grid.draw(context, undefined, {
    cellColor: () => {
      calls += 1;
      return "#8cdfad";
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(colors, ["#8cdfad"]);
});

test("flock applies one cached Base-style palette layout per aging cell", () => {
  let life = 0.69;
  let sampledAmount;
  let sampledCalls = 0;
  const generator = Object.create(FlockGridGenerator.prototype);
  generator.endOfLifeStart = 0.7;
  generator.flickerPaletteByCell = [];
  generator.flockField = {
    lifeInCell: index => {
      assert.equal(index, 4);
      return life;
    },
  };
  generator.grid = {
    cellState: { level: new Uint8Array([0, 0, 0, 0, 1]) },
    layout: { columns: 3, rows: 2 },
  };
  generator.flicker = {
    amount: 1,
    paletteColors: ["rgb(0 52 21)", "rgb(140 223 173)"],
  };
  generator.flickerPaletteIndicesForCell = (index, level, amount) => {
    assert.equal(index, 4);
    assert.equal(level, 1);
    sampledAmount = amount;
    sampledCalls += 1;
    return new Uint16Array([0, 1, 1, 0]);
  };
  const first = { index: 4, glyphIndex: 1 };
  const second = { index: 4, glyphIndex: 2 };

  assert.equal(generator.flickerGlyphColor(first, "#003415"), "#003415");
  life = 0.9;
  assert.equal(generator.flickerGlyphColor(first, "#003415"), "rgb(140 223 173)");
  assert.equal(generator.flickerGlyphColor(second, "#003415"), "rgb(140 223 173)");
  assert.equal(sampledCalls, 1);
  assert.ok(Math.abs(sampledAmount - 2 / 3) < 1e-9);
});

test("flock selects each disappearing cell once and forces its authored subdivision", () => {
  const generator = Object.create(FlockGridGenerator.prototype);
  generator.runtime = { projectSeed: () => 42 };
  generator.flicker = { enabled: true };
  generator.flickerTrigger = "disappearing-cell";
  generator.disappearingCellProbability = 1;
  generator.disappearingCellSubdivisionLevel = 2;
  generator.grid = {
    energy: new Float32Array([0.8, 0.8]),
    previousEnergy: new Float32Array([1, 1]),
    cellState: { level: new Uint8Array([1, 3]) },
  };
  generator.resetDisappearingCellState();

  generator.updateFlickerActivation();
  assert.deepEqual([...generator.disappearingCells], [1, 1]);
  assert.deepEqual([...generator.grid.cellState.level], [2, 2]);
  assert.deepEqual([...generator.disappearanceCounts], [1, 1]);

  generator.updateFlickerActivation();
  assert.deepEqual(
    [...generator.disappearanceCounts],
    [1, 1],
    "a continuing fall must not reroll its probability",
  );

  generator.grid.energy[0] = 0.9;
  generator.grid.previousEnergy[0] = 0.8;
  generator.updateFlickerActivation();
  assert.deepEqual([...generator.disappearingCells], [0, 1]);
});

test("zero disappearance probability leaves falling flock cells unchanged", () => {
  const generator = Object.create(FlockGridGenerator.prototype);
  generator.runtime = { projectSeed: () => 42 };
  generator.flicker = { enabled: true };
  generator.flickerTrigger = "disappearing-cell";
  generator.disappearingCellProbability = 0;
  generator.disappearingCellSubdivisionLevel = 3;
  generator.grid = {
    energy: new Float32Array([0.5]),
    previousEnergy: new Float32Array([0.75]),
    cellState: { level: new Uint8Array([1]) },
  };
  generator.resetDisappearingCellState();

  generator.updateFlickerActivation();
  assert.deepEqual([...generator.disappearingCells], [0]);
  assert.deepEqual([...generator.grid.cellState.level], [1]);
});

test("flock rejects invalid disappearing-cell flicker controls at startup", () => {
  for (const [key, value, message] of [
    ["trigger", "vanishing-boid", /trigger must be one of/],
    ["probability", 1.1, /probability must be between zero and one/],
    ["subdivisionLevel", 4, /subdivisionLevel must be an integer from zero to three/],
  ]) {
    const settings = structuredClone(SETTINGS);
    settings.flock.flicker.envelope[key] = value;
    const { director } = createHeadlessDirector({ composition: "flock", settings });
    assert.throws(
      () => director.generator("flockGrid"),
      message,
    );
    director.dispose();
  }
});

test("disappearing-cell flicker decisions are visible in headless transition logs", async () => {
  const run = await runFrames({
    composition: "flock",
    frames: 220,
    channels: ["transition"],
  });
  const events = run.lines.filter(line => line.includes(
    "trigger=disappearing-cell",
  ));

  assert.ok(events.length > 0);
  assert.match(
    events[0],
    /cycle=0 event=\d+ trigger=disappearing-cell started=\d+ selected=\d+ ended=\d+ active=\d+/,
  );
});

test("flock cell scope uses Base's one-cell 16x16 flicker field", () => {
  const generator = Object.create(FlockGridGenerator.prototype);
  generator.grid = {
    layout: { columns: 3, rows: 2, cellSize: 10 },
  };
  generator.flicker = { scope: "cell" };

  assert.deepEqual(generator.flickerGrid(), {
    columns: 1,
    rows: 1,
    cellSize: 10,
    dotsPerCellAxis: 16,
  });
});

function configuredFlockFlicker(settings = SETTINGS) {
  const { director } = createHeadlessDirector({ composition: "flock", settings });
  const generator = director.generator("flockGrid");
  const signature = [];
  const colors = [];
  for (const time of [0, 0.23, 0.47, 0.83, 1.19]) {
    generator.flock.time = time;
    for (let index = 0; index < generator.grid.energy.length; index += 1) {
      const paletteIndices = generator.flickerPaletteIndicesForCell(index, 3, 1);
      signature.push(...paletteIndices);
      colors.push(...Array.from(paletteIndices, paletteIndex => (
        generator.flicker.paletteColors[paletteIndex]
      )));
    }
  }
  const inspection = generator.inspect().flicker;
  const paletteColors = [...generator.flicker.paletteColors];
  director.dispose();
  return { colors, inspection, paletteColors, signature };
}

test("flock uses its selected preset settings across parent cells", () => {
  const authored = FLOCK_GRID_CONFIG.settings.flock.flicker;
  assert.ok(
    Object.hasOwn(authored.modes, authored.mode),
    `flock mode ${authored.mode} needs a local tuning block`,
  );
  const fixtureSettings = structuredClone(SETTINGS);
  fixtureSettings.flock.flicker.mode = "noise";
  fixtureSettings.flock.flicker.scope = "cell";
  fixtureSettings.flock.flicker.modes.noise = {
    speed: 0.5,
    spatialScale: 0.055,
  };
  const baseline = configuredFlockFlicker(fixtureSettings);
  assert.equal(baseline.inspection.mode, "noise");
  assert.equal(baseline.inspection.scope, "cell");
  assert.deepEqual(baseline.inspection.modeSettings, {
    speed: 0.5,
    spatialScale: 0.055,
  });
  assert.ok(
    new Set(baseline.signature).size > 3,
    "the selected preset collapsed to one sample instead of spanning parent cells",
  );
  assert.ok(new Set(baseline.colors).size > 1, "flock samples never reached cell colors");
  assert.ok(
    baseline.colors.every(color => baseline.paletteColors.includes(color)),
    "flock flicker must snap every result to an authored palette swatch",
  );

  const tunedSettings = structuredClone(fixtureSettings);
  tunedSettings.flock.flicker.modes.noise.spatialScale = 0.41;
  const tuned = configuredFlockFlicker(tunedSettings);
  assert.equal(tuned.inspection.modeSettings.spatialScale, 0.41);
  assert.notDeepEqual(
    tuned.signature,
    baseline.signature,
    "a flock-local active-mode value reached config but not rendered samples",
  );
});

test("flock and Base produce the same noise/cell glyph palette layout", () => {
  const settings = structuredClone(SETTINGS);
  for (const key of ["base", "flock"]) {
    settings[key].flicker.mode = "noise";
    settings[key].flicker.scope = "cell";
    settings[key].flicker.amount = 1;
    settings[key].flicker.cellStaggerSeconds = 0;
    settings[key].flicker.modes.noise = { speed: 0.5, spatialScale: 0.055 };
  }
  const baseHost = createHeadlessDirector({ composition: "base", settings });
  const flockHost = createHeadlessDirector({ composition: "flock", settings });
  try {
    const base = baseHost.director.generator("baseGrid");
    const flock = flockHost.director.generator("flockGrid");
    base.elapsed = 0.33;
    flock.flock.time = 0.33;
    for (const level of [0, 1, 2, 3]) {
      assert.deepEqual(
        [...flock.flickerPaletteIndicesForCell(0, level, 1)],
        [...base.paletteIndicesForCell(0, level)],
        `level ${level} diverged from Base noise/cell`,
      );
    }
  } finally {
    baseHost.director.dispose();
    flockHost.director.dispose();
  }
});

test("the live flock cycle flickers selected disappearing parent cells", () => {
  const { director, viewport } = createHeadlessDirector({ composition: "flock" });
  let eligibleCells = 0;
  let changedCells = 0;
  let changedFrames = 0;
  try {
    for (let frameIndex = 0; frameIndex < 650; frameIndex += 1) {
      const frame = {
        dt: 1 / 60,
        compositionDt: 1 / 60,
        time: frameIndex / 60,
        frameIndex,
        viewport,
        pointer: { active: false, x: 0, y: 0 },
      };
      director.update(frame);
      const generator = director.generator("flockGrid");
      let changedThisFrame = 0;
      for (let index = 0; index < generator.grid.energy.length; index += 1) {
        if (!generator.grid.cellVisible(index)) continue;
        if (generator.disappearingCells[index] !== 1) continue;
        eligibleCells += 1;
        assert.equal(
          generator.grid.cellState.level[index],
          generator.disappearingCellSubdivisionLevel,
        );
        const paletteValue = generator.grid.cellState.paletteValue[index];
        const baseColor = generator.grid.paletteColor(
          paletteValue >= 0 ? paletteValue : generator.grid.energy[index],
        );
        const level = generator.grid.cellState.level[index];
        const baseIndex = generator.grid.paletteColors.indexOf(baseColor);
        const paletteIndices = generator.flickerPaletteIndicesForCell(
          index,
          level,
          generator.flicker.amount,
        );
        for (const flickerIndex of paletteIndices) {
          if (flickerIndex === baseIndex) continue;
          changedCells += 1;
          changedThisFrame += 1;
        }
      }
      if (changedThisFrame > 0) changedFrames += 1;
    }
  } finally {
    director.dispose();
  }

  assert.ok(eligibleCells > 0, "the live cycle never selected a disappearing cell");
  assert.ok(changedCells > 0, "selected disappearing cells kept their base colors");
  assert.ok(changedFrames > 30, "flock flicker appeared only as an incidental frame");
});

test("flock hands its final visible parent cells to the composition endpoint", () => {
  const generator = Object.create(FlockGridGenerator.prototype);
  generator.grid = {
    energy: new Float32Array([0, 0.2, 0.009, 0.8]),
    cellVisible: index => generator.grid.energy[index] >= 0.01,
  };

  assert.deepEqual(generator.compositionEndpointScene(), {
    endpointCellIndices: [1, 3],
  });
});

test("flock Dijkstra paths spread across the snapped palette", () => {
  const generator = Object.create(FlockGridGenerator.prototype);
  generator.grid = { paletteColors: ["#001100", "#00692a", "#00a240", "#8cdfad"] };
  const endpointFrame = { pathIndices: [8, 5, 2] };
  const colorAt = index => generator.compositionEndpointColor({
    cell: { index, level: 0 },
    paletteStep: 3,
    endpointFrame,
  });

  assert.deepEqual([colorAt(8), colorAt(5), colorAt(2)], [
    "#001100",
    "#00a240",
    "#8cdfad",
  ]);
});

test("flock preview is the shared field and clears while an endpoint owns the canvas", () => {
  const generator = Object.create(FlockGridGenerator.prototype);
  generator.compositionEndpoint = { phase: "end" };
  generator.grid = { paletteColors: ["#001100", "#8cdfad"] };
  generator.flockField = {
    snapshot: () => ({
      width: 2,
      height: 1,
      pixels: new Uint8Array([255, 100]),
      life: new Uint8Array([120, 60]),
    }),
  };

  const preview = generator.flockPreviewSnapshot();
  assert.deepEqual([...preview.pixels], [0, 0]);
  assert.deepEqual([...preview.life], [0, 0]);
});

test("flock runs the shared Dijkstra outro to one center dot", async () => {
  const run = await runFrames({
    composition: "flock",
    frames: 900,
    channels: ["timeline", "transition"],
  });
  const stages = run.lines.filter(line => (
    line.includes("endpoint=end mode=dijkstra stage=")
  ));
  assert.deepEqual(
    stages.map(line => /stage=([^ ]+)/.exec(line)?.[1]),
    ["loading", "path", "blink", "subdivide", "center"],
  );

  const endpoint = run.snapshots.at(-2).state
    .generators.flockGrid.compositionEndpoint;
  assert.equal(endpoint.mode, "dijkstra");
  assert.equal(endpoint.stage, "center");
  assert.ok(endpoint.startIndices.length > 0);
  assert.equal(run.drawCounts.at(-2).fill, 1);
  const pathFrame = Number(/f=(\d+)/.exec(stages[1])?.[1]);
  const blinkFrame = Number(/f=(\d+)/.exec(stages[2])?.[1]);
  assert.ok(blinkFrame - pathFrame >= 50);
  assert.ok(
    run.snapshots.at(-1).state.generators.flockGrid.timing.simulationTime < 0.1,
  );
  assert.ok(run.lines.some(line => line.includes("flock-cycle-reset cycle=1")));
});
