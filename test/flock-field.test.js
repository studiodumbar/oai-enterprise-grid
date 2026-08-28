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
import { captureDebug } from "../src/debug/index.js";
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

test("centered flock emission retains its legacy golden-angle state", () => {
  const flock = new Flock({
    count: 4,
    perceptionRadius: 10,
    birthsPerPulse: 4,
    pulseEverySeconds: 2,
    emissionSeconds: 0.6,
    lifetimeSeconds: 9,
    initialSpeed: 20,
    spawnRadius: 3,
  });
  flock.pulseIndex = 2;

  const lines = captureDebug(["cells"], () => flock.emitPulse(200, 100));
  assert.deepEqual(lines, [
    "[cg:cells] f=0000 flock-pulse=2 births=4 active=1",
  ]);
  assert.deepEqual(flock.snapshotState(), {
    version: 1,
    time: 0,
    nextPulseTime: 0,
    lastPulseTime: 0,
    birthIndex: 4,
    pulseIndex: 3,
    boids: [
      {
        x: 101.92093727122986,
        y: 50,
        vx: -1.0922771916410445,
        vy: -18.34751565026232,
        ax: 0,
        ay: 0,
        age: 0,
        lifeProgress: 0,
        opacity: 1,
        birthDelay: 0,
        spawnIndex: 0,
        scheduled: true,
        active: true,
        targetSpeed: 18.38,
        endOfLifeProgress: 0,
        lifetime: 9,
      },
      {
        x: 99.62961916572428,
        y: 50.339299184128514,
        vx: 5.865131065727186,
        vy: -14.981006086225653,
        ax: 0,
        ay: 0,
        age: 0,
        lifeProgress: 0,
        opacity: 0,
        birthDelay: 0.19999999999999998,
        spawnIndex: 1,
        scheduled: true,
        active: false,
        targetSpeed: 16.08820393249937,
        endOfLifeProgress: 0,
        lifetime: 9,
      },
      {
        x: 100.21081407522689,
        y: 47.597882346098686,
        vx: 2.0902606606084717,
        vy: -19.685745470469147,
        ax: 0,
        ay: 0,
        age: 0,
        lifeProgress: 0,
        opacity: 0,
        birthDelay: 0.39999999999999997,
        spawnIndex: 2,
        scheduled: true,
        active: false,
        targetSpeed: 19.796407864998738,
        endOfLifeProgress: 0,
        lifetime: 9,
      },
      {
        x: 100.93804574246272,
        y: 51.223514561129015,
        vx: -2.81629643449745,
        vy: -17.27657108844654,
        ax: 0,
        ay: 0,
        age: 0,
        lifeProgress: 0,
        opacity: 0,
        birthDelay: 0.6,
        spawnIndex: 3,
        scheduled: true,
        active: false,
        targetSpeed: 17.504611797498107,
        endOfLifeProgress: 0,
        lifetime: 9,
      },
    ],
  });
});

test("directed flock emission normalizes direction with deterministic spread", () => {
  const options = {
    count: 4,
    perceptionRadius: 10,
    birthsPerPulse: 4,
    pulseEverySeconds: 2,
    emissionSeconds: 0.6,
    lifetimeSeconds: 9,
    initialSpeed: 20,
    spawnRadius: 3,
  };
  const first = new Flock(options);
  const second = new Flock(options);
  const lines = captureDebug(["transition"], () => {
    first.emitPulse(200, 100, {
      originX: 24,
      originY: 19,
      directionX: 3,
      directionY: 4,
      strength: 0.25,
    });
  });
  second.emitPulse(200, 100, {
    originX: 24,
    originY: 19,
    directionX: 0.6,
    directionY: 0.8,
    strength: 0.25,
  });

  assert.deepEqual(first.snapshotState(), second.snapshotState());
  assert.ok(first.boids.every(boid => (
    Math.hypot(boid.x - 24, boid.y - 19) <= options.spawnRadius + 1e-12
  )));
  assert.ok(first.boids.every(boid => (
    Math.abs(Math.hypot(boid.vx, boid.vy) - boid.targetSpeed) <= 1e-12
    && boid.vx * 0.6 + boid.vy * 0.8 > 0
    && boid.targetSpeed <= options.initialSpeed * 0.25
  )));
  assert.deepEqual(lines, [
    "[cg:transition] f=0000 flock-pulse=0 mode=directed originX=24.000 originY=19.000 directionX=0.600000 directionY=0.800000 strength=0.250 births=4 active=1",
  ]);
});

test("directed flock emission rejects invalid origins and directions atomically", () => {
  const flock = new Flock({
    count: 1,
    perceptionRadius: 10,
    birthsPerPulse: 1,
    pulseEverySeconds: 2,
  });
  const initial = flock.snapshotState();
  const invalid = [
    [null, /emission must be an object/],
    [{ originX: NaN, originY: 10, directionX: 1, directionY: 0 }, /originX must be finite/],
    [{ originX: 10, originY: Infinity, directionX: 1, directionY: 0 }, /originY must be finite/],
    [{ originX: 10, originY: 10, directionX: 0, directionY: 0 }, /direction must be non-zero/],
    [{ originX: 10, originY: 10, directionX: 1 }, /directionY must be finite/],
    [{ originX: 10, originY: 10, directionX: 1, directionY: 0, strength: 0 }, /strength must be finite and between zero and one/],
    [{ originX: 10, originY: 10, directionX: 1, directionY: 0, strength: 1.1 }, /strength must be finite and between zero and one/],
  ];

  for (const [emission, message] of invalid) {
    assert.throws(() => flock.emitPulse(100, 50, emission), message);
    assert.deepEqual(flock.snapshotState(), initial);
  }
});

test("flock simulation snapshots are copied, JSON-safe, and deterministic", () => {
  const options = {
    count: 3,
    perceptionRadius: 20,
    proximityRadius: 20,
    separationRadius: 5,
    birthsPerPulse: 3,
    pulseEverySeconds: 4,
    emissionSeconds: 0.3,
    lifetimeSeconds: 9,
    fadeStartsAt: 0.8,
    initialSpeed: 20,
    spawnRadius: 2,
    maxSpeed: 100,
    maxForce: 50,
    alignment: 0.5,
    cohesion: 0.2,
    separation: 0.7,
    pointerRadius: 10,
    pointerForce: 10,
    wrapEdges: false,
  };
  const source = new Flock(options);
  source.time = 1;
  source.nextPulseTime = Infinity;
  source.emitPulse(100, 50, {
    originX: 30,
    originY: 20,
    directionX: -2,
    directionY: 1,
  });
  source.update(0.25, 100, 50, { active: false });

  const snapshot = source.snapshotState();
  const serialized = JSON.parse(JSON.stringify(snapshot));
  assert.deepEqual(serialized, snapshot);
  assert.equal(snapshot.nextPulseTime, null);
  const restored = new Flock(options);
  const boidIdentities = [...restored.boids];
  assert.equal(restored.restoreState(serialized), true);
  assert.equal(restored.nextPulseTime, Infinity);
  assert.deepEqual(restored.snapshotState(), snapshot);
  assert.ok(restored.boids.every((boid, index) => boid === boidIdentities[index]));
  const sourceX = source.boids[0].x;
  snapshot.boids[0].x += 100;
  assert.equal(source.boids[0].x, sourceX);

  source.update(1 / 60, 100, 50, { active: false });
  restored.update(1 / 60, 100, 50, { active: false });
  assert.deepEqual(restored.snapshotState(), source.snapshotState());
  serialized.boids[0].x += 100;
  assert.notEqual(restored.boids[0].x, serialized.boids[0].x);
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

test("flock rolls cell appearance once per influence episode", () => {
  const flock = {
    boids: [{ active: true, x: 25, y: 25, opacity: 1, endOfLifeProgress: 0 }],
  };
  const rolls = [0.75, 0.25];
  const source = new FlockFieldSource(flock, FIELD_OPTIONS, VIEWPORT, {
    probability: 0.5,
    unit: () => rolls.shift(),
  });
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
  assert.equal(field.resolveCell(0), 0);
  assert.equal(rolls.length, 1);

  field.reset();
  source.write(field);
  assert.equal(field.resolveCell(0), 0);
  assert.equal(rolls.length, 1, "continuing influence must not reroll");

  flock.boids[0].active = false;
  field.reset();
  source.write(field);
  flock.boids[0].active = true;
  field.reset();
  source.write(field);

  assert.equal(field.resolveCell(0), 1);
  assert.equal(rolls.length, 0);
  assert.deepEqual([...source.influenceCounts], [2, 0]);
});

test("flock and interactive flock share configurable cell thinning", () => {
  for (const [composition, generatorName, settingsKey] of [
    ["flock", "flockGrid", "flock"],
    ["interactive-flock", "interactiveFlockGrid", "interactiveFlock"],
  ]) {
    const { director } = createHeadlessDirector({ composition });
    const generator = director.generator(generatorName);
    assert.equal(
      generator.flockField.appearanceProbability,
      SETTINGS[settingsKey].grid.appearanceProbability,
    );
    assert.equal(generator.inspect().appearance.probability, 0.7);
    director.dispose();
  }
});

test("flock rejects invalid cell appearance probabilities at startup", () => {
  for (const [composition, settingsKey] of [
    ["flock", "flock"],
    ["interactive-flock", "interactiveFlock"],
  ]) {
    const settings = structuredClone(SETTINGS);
    settings[settingsKey].grid.appearanceProbability = 1.1;
    const { director } = createHeadlessDirector({ composition, settings });
    assert.throws(
      () => director.generator(
        composition === "flock" ? "flockGrid" : "interactiveFlockGrid",
      ),
      /appearanceProbability must be between zero and one/,
    );
    director.dispose();
  }
});

test("flock excludes the singular-dot subdivision through config", () => {
  const { director } = createHeadlessDirector({ composition: "flock" });
  const transition = director.generator("flockGrid").grid.cellTransition;

  assert.deepEqual(transition.subdivisionPolicy.levels, [1, 2, 3]);
  assert.equal(transition.subdivisionPolicy.levelAt(0), 1);
  assert.equal(transition.subdivisionPolicy.levelAt(1), 3);
  director.dispose();
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
  const framesThroughCycleWrap = Math.ceil((
    SETTINGS.flock.circleEndpoints.start.durationSeconds
    + SETTINGS.flock.timing.bodyDurationSeconds
    + SETTINGS.flock.circleEndpoints.end.durationSeconds
  ) * 60) + 1;
  const run = await runFrames({
    composition: "flock",
    frames: framesThroughCycleWrap,
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
