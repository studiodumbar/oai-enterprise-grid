import { CircleGrid } from "../grid/circle-grid.js";
import { Flock } from "./flock.js";
import { FlockFieldSource } from "../fields/flock-field-source.js";
import { NativeCircleEndpointTransition } from "../compositions/circle-endpoints.js";
import { createSceneTransitionModeRegistry } from "../scene-transitions/index.js";
import {
  FLICKER_DOTS_PER_CELL_AXIS,
  createFlicker,
  flickerPaletteIndicesForCell,
} from "../visuals/flicker/index.js";
import {
  createCompositionEndpointMode,
  nativeCircleEndpointSettings,
  resolveCompositionEndpointSettings,
} from "../composition-endpoints/index.js";
import {
  compositionEndpointPaletteColor,
  drawCompositionEndpointFrame,
} from "../composition-endpoints/render.js";
import { debug } from "../debug/index.js";
import { hashUnit } from "./grid-scene-strategies.js";

const FLOCK_FLICKER_TRIGGERS = Object.freeze([
  "end-of-life",
  "disappearing-cell",
]);
const MAX_FLOCK_SUBDIVISION_LEVEL = 3;

function settingsGroup(settings, name, owner) {
  const group = settings[name];
  if (!group || typeof group !== "object") {
    throw new Error(`${owner} refers to missing SETTINGS.${name}.`);
  }
  return group;
}

// The boids never draw onto the composition canvas. They render into a small
// deterministic field surface, and the shared grid samples that surface.
export class FlockGridGenerator {
  constructor({
    name,
    definition,
    options,
    settings,
    runtime,
    cellTransitionTypes,
    palettes,
    shapeRenderer,
    sceneTransitionTypes,
  }) {
    this.name = name;
    this.definition = definition;
    this.options = options;
    this.runtime = runtime;
    this.settings = settings;
    this.cellTransitionTypes = cellTransitionTypes;
    this.active = false;

    if (!options?.grid || !options?.field || !options?.simulation) {
      throw new Error(
        `Generator "${name}" needs grid, field, and simulation settings.`,
      );
    }
    const gridOptions = {
      ...options.grid,
      palette: options.palette,
      intro: options.intro,
      outro: options.outro,
    };
    const flockOptions = options.simulation;
    const viewport = runtime.viewport();
    this.viewport = { ...viewport };
    this.flock = new Flock(flockOptions);
    this.flockField = new FlockFieldSource(this.flock, options.field, viewport);
    this.fieldSources = [this.flockField];
    this.cellTransition = this.createCellTransition(definition.cellTransition);
    this.activeCellTransitionKey = this.transitionKey(definition.cellTransition);
    this.grid = new CircleGrid(
      gridOptions,
      palettes,
      this.cellTransition,
      shapeRenderer,
      viewport,
    );
    const noise = typeof runtime.p5?.noise === "function"
      ? runtime.p5.noise.bind(runtime.p5)
      : undefined;
    this.flicker = createFlicker({
      palette: this.grid.paletteColors,
      settings: options.flicker,
      noiseFunction: noise,
      grid: this.flickerGrid(),
      autoCycleSeconds: flockOptions.pulseEverySeconds,
    });
    this.flicker.resize(this.flickerGrid());
    this.flickerPaletteByCell = [];
    this.configureFlickerEnvelope();
    this.resetDisappearingCellState();
    this.endOfLifeStart = this.flicker.envelope.endOfLifeStart ?? 0.5;
    if (
      !Number.isFinite(this.endOfLifeStart)
      || this.endOfLifeStart < 0
      || this.endOfLifeStart >= 1
    ) {
      throw new RangeError(
        "flock.flicker.envelope.endOfLifeStart must be between zero (inclusive) and one (exclusive).",
      );
    }
    this.compositionEndpoints = resolveCompositionEndpointSettings(
      settings?.composition,
      options.circleEndpoints,
    );
    this.circleEndpoint = new NativeCircleEndpointTransition({
      settings: nativeCircleEndpointSettings(this.compositionEndpoints),
      intro: gridOptions.intro,
      outro: gridOptions.outro,
      modeRegistry: sceneTransitionTypes ?? createSceneTransitionModeRegistry(),
    });
    this.endCompositionEndpoint = createCompositionEndpointMode(
      this.compositionEndpoints.end,
      this.compositionEndpoints.modes,
    );
    this.compositionCycleIndex = null;
    this.compositionEndpoint = null;
    this.circleEndpointActive = false;
  }

  configureFlickerEnvelope() {
    const envelope = this.flicker.envelope;
    this.flickerTrigger = envelope.trigger ?? "end-of-life";
    this.disappearingCellProbability = envelope.probability ?? 1;
    this.disappearingCellSubdivisionLevel = envelope.subdivisionLevel ?? 3;
    if (!FLOCK_FLICKER_TRIGGERS.includes(this.flickerTrigger)) {
      throw new RangeError(
        `flock.flicker.envelope.trigger must be one of ${FLOCK_FLICKER_TRIGGERS.join(", ")}.`,
      );
    }
    if (
      !Number.isFinite(this.disappearingCellProbability)
      || this.disappearingCellProbability < 0
      || this.disappearingCellProbability > 1
    ) {
      throw new RangeError(
        "flock.flicker.envelope.probability must be between zero and one.",
      );
    }
    if (
      !Number.isSafeInteger(this.disappearingCellSubdivisionLevel)
      || this.disappearingCellSubdivisionLevel < 0
      || this.disappearingCellSubdivisionLevel > MAX_FLOCK_SUBDIVISION_LEVEL
    ) {
      throw new RangeError(
        "flock.flicker.envelope.subdivisionLevel must be an integer from zero to three.",
      );
    }
    debug.config(
      "flock-flicker trigger=%s probability=%.3f subdivision=%d",
      this.flickerTrigger,
      this.disappearingCellProbability,
      this.disappearingCellSubdivisionLevel,
    );
  }

  resetDisappearingCellState() {
    const cellCount = this.grid.energy.length;
    this.disappearingCells = new Uint8Array(cellCount);
    this.previouslyDisappearingCells = new Uint8Array(cellCount);
    this.disappearanceCounts = new Uint32Array(cellCount);
    this.disappearanceEventIndex = 0;
  }

  createCellTransition(transitionDefinition) {
    if (!transitionDefinition || typeof transitionDefinition.type !== "string") {
      throw new Error(
        `Generator "${this.name}" needs a cellTransition { type, options } definition.`,
      );
    }
    const configuredModes = this.settings.cellTransitions?.modes
      ?? this.settings.cellTransitions;
    const options = typeof transitionDefinition.options === "string"
      ? settingsGroup(
        configuredModes,
        transitionDefinition.options,
        `Cell transition "${transitionDefinition.type}"`,
      )
      : transitionDefinition.options ?? {};
    const transition = this.cellTransitionTypes.create(transitionDefinition.type, options);
    if (!transition || typeof transition.updateCell !== "function") {
      throw new TypeError(
        `Cell transition "${transitionDefinition.type}" must provide updateCell().`,
      );
    }
    return transition;
  }

  transitionKey(transitionDefinition) {
    const options = transitionDefinition.options;
    const optionKey = typeof options === "string" ? options : JSON.stringify(options ?? {});
    return `${transitionDefinition.type}:${optionKey}`;
  }

  ensureCellTransition(
    transitionDefinition = this.definition.cellTransition,
    frame,
  ) {
    const key = this.transitionKey(transitionDefinition);
    if (key === this.activeCellTransitionKey) return;

    const nextTransition = this.createCellTransition(transitionDefinition);
    if (this.active) this.cellTransition.exit?.(frame);
    this.grid?.setCellTransition(nextTransition);
    this.cellTransition = nextTransition;
    this.activeCellTransitionKey = key;
    if (this.active) this.cellTransition.enter?.(frame);
    return true;
  }

  enter(frame, planEntries = []) {
    this.ensureCellTransition(
      planEntries[0]?.cellTransition ?? this.definition.cellTransition,
      frame,
    );
    this.active = true;
    this.compositionCycleIndex = Number.isSafeInteger(
      frame?.compositionEndpoint?.cycleIndex,
    ) ? frame.compositionEndpoint.cycleIndex : null;
    this.compositionEndpoint = frame?.compositionEndpoint ?? null;
    this.circleEndpoint.reset();
    this.endCompositionEndpoint?.reset();
    this.circleEndpointActive = false;
    this.cellTransition.enter?.(frame);
    if (this.flock.pulseIndex === 0) {
      const viewport = frame?.viewport ?? this.viewport;
      this.flock.update(0, viewport.width, viewport.height, frame?.pointer);
      this.grid.update(this.fieldSources, 0, frame, { immediate: true });
    }
  }

  exit(frame) {
    this.cellTransition.exit?.(frame);
    this.active = false;
  }

  update(frame, planEntries = []) {
    this.ensureCellTransition(
      planEntries[0]?.cellTransition ?? this.definition.cellTransition,
      frame,
    );
    const restarted = this.restartForCompositionCycle(frame);
    this.compositionEndpoint = frame?.compositionEndpoint ?? null;
    const { width, height } = frame.viewport;
    this.flock.update(frame.dt, width, height, frame.pointer);
    this.grid.update(this.fieldSources, frame.dt, frame, {
      immediate: restarted,
    });
    this.updateFlickerActivation();
    const cycleSeconds = this.flock.options.pulseEverySeconds;
    const cyclePosition = this.flock.time / cycleSeconds;
    this.flicker.beginFrame({
      time: this.flock.time,
      progress: cyclePosition - Math.floor(cyclePosition),
      cycleIndex: Math.floor(cyclePosition),
    });
  }

  restartForCompositionCycle(frame) {
    const endpoint = frame?.compositionEndpoint;
    if (endpoint?.phase !== "start" || !Number.isSafeInteger(endpoint.cycleIndex)) {
      return false;
    }
    if (this.compositionCycleIndex === null) {
      this.compositionCycleIndex = endpoint.cycleIndex;
      return false;
    }
    if (endpoint.cycleIndex === this.compositionCycleIndex) return false;

    this.compositionCycleIndex = endpoint.cycleIndex;
    this.flock.reset();
    this.grid.energy.fill(0);
    this.grid.previousEnergy.fill(0);
    this.resetDisappearingCellState();
    debug.timeline("flock-cycle-reset cycle=%d", endpoint.cycleIndex);
    return true;
  }

  updateFlickerActivation() {
    if (!this.flicker.enabled || this.flickerTrigger !== "disappearing-cell") return;
    let started = 0;
    let selected = 0;
    let ended = 0;
    let active = 0;
    const projectSeed = Number(this.runtime.projectSeed?.() ?? 0) >>> 0;
    for (let index = 0; index < this.grid.energy.length; index += 1) {
      const isDisappearing = this.grid.energy[index] < this.grid.previousEnergy[index];
      const wasDisappearing = this.previouslyDisappearingCells[index] === 1;
      if (isDisappearing && !wasDisappearing) {
        const count = this.disappearanceCounts[index] + 1;
        this.disappearanceCounts[index] = count;
        this.disappearingCells[index] = Number(
          this.disappearingCellProbability === 1
          || (
            this.disappearingCellProbability > 0
            && hashUnit(projectSeed, index, count) < this.disappearingCellProbability
          ),
        );
        started += 1;
        selected += this.disappearingCells[index];
      } else if (!isDisappearing && wasDisappearing) {
        this.disappearingCells[index] = 0;
        ended += 1;
      }
      this.previouslyDisappearingCells[index] = Number(isDisappearing);
      if (isDisappearing && this.disappearingCells[index] === 1) {
        this.grid.cellState.level[index] = this.disappearingCellSubdivisionLevel;
        active += 1;
      }
    }
    if (started > 0 || ended > 0) {
      this.disappearanceEventIndex += started + ended;
      debug.transition(
        "flock-flicker cycle=%d event=%d trigger=disappearing-cell started=%d selected=%d ended=%d active=%d",
        this.compositionCycleIndex ?? 0,
        this.disappearanceEventIndex,
        started,
        selected,
        ended,
        active,
      );
    }
  }

  draw(frame, planEntry, context = this.runtime.context()) {
    const customEndpoint = frame?.compositionEndpoint?.phase === "end"
      ? this.endCompositionEndpoint
      : null;
    if (customEndpoint) {
      const endpointFrame = customEndpoint.frameAt({
        layout: this.grid.layout,
        scene: this.compositionEndpointScene(),
        cycleIndex: frame.compositionEndpoint.cycleIndex,
        progress: frame.compositionEndpoint.progress,
      });
      drawCompositionEndpointFrame(context, endpointFrame, {
        dotMargin: this.grid.options.dotMargin,
        colorForGlyph: glyph => this.compositionEndpointColor(glyph),
      });
      return;
    }
    this.circleEndpointActive = this.circleEndpoint?.prepare?.(
      frame?.compositionEndpoint,
      this.grid.transitionItems?.() ?? [],
      this.grid.layout,
    ) ?? false;
    if (this.flicker.enabled) {
      this.flickerPaletteByCell ??= [];
      this.flickerPaletteByCell.length = 0;
    }
    this.grid.draw(context, undefined, {
      guides: !frame?.exporting,
      glyphPresentation: this.circleEndpointActive
        ? item => this.circleEndpoint.presentationsFor(item.id)
        : undefined,
      glyphColor: this.flicker.enabled
        ? (item, defaultColor) => this.flickerGlyphColor(item, defaultColor)
        : undefined,
    });
  }

  compositionEndpointScene() {
    const endpointCellIndices = [];
    for (let index = 0; index < this.grid.energy.length; index += 1) {
      if (this.grid.cellVisible(index)) endpointCellIndices.push(index);
    }
    return { endpointCellIndices };
  }

  compositionEndpointColor({ cell, paletteStep, endpointFrame }) {
    if (!Array.isArray(cell.paletteSteps)) {
      const order = endpointFrame.pathIndices.indexOf(cell.index);
      if (order >= 0) {
        const lastColor = this.grid.paletteColors.length - 1;
        const lastPathCell = Math.max(1, endpointFrame.pathIndices.length - 1);
        return this.grid.paletteColors[Math.round(order / lastPathCell * lastColor)];
      }
    }
    return compositionEndpointPaletteColor(this.grid.paletteColors, paletteStep);
  }

  flickerGrid() {
    if (this.flicker?.scope === "cell") {
      return {
        columns: 1,
        rows: 1,
        cellSize: this.grid.layout.cellSize,
        dotsPerCellAxis: FLICKER_DOTS_PER_CELL_AXIS,
      };
    }
    return {
      columns: this.grid.layout.columns,
      rows: this.grid.layout.rows,
      cellSize: this.grid.layout.cellSize,
      dotsPerCellAxis: FLICKER_DOTS_PER_CELL_AXIS,
    };
  }

  flickerTimeFor(index) {
    if (this.flicker.scope !== "cell" || this.flicker.cellStaggerSeconds === 0) {
      return this.flock.time;
    }
    return this.flock.time
      + hashUnit(index, this.grid.layout.columns, 977)
      * this.flicker.cellStaggerSeconds;
  }

  flickerPaletteIndicesForCell(index, level, amount = this.flicker.amount) {
    return flickerPaletteIndicesForCell({
      flicker: this.flicker,
      level,
      time: this.flickerTimeFor(index),
      parentColumn: index % this.grid.layout.columns,
      parentRow: Math.floor(index / this.grid.layout.columns),
      amount,
    });
  }

  flickerGlyphColor(item, defaultColor) {
    if (this.flickerTrigger === "disappearing-cell") {
      if (this.disappearingCells[item.index] !== 1) return defaultColor;
      return this.flickerColorForCell(item, this.flicker.amount);
    }
    const life = this.flockField.lifeInCell(item.index, this.grid.layout);
    if (life <= this.endOfLifeStart) return defaultColor;
    const activation = Math.min(
      1,
      (life - this.endOfLifeStart) / (1 - this.endOfLifeStart),
    );
    return this.flickerColorForCell(item, activation * this.flicker.amount);
  }

  flickerColorForCell(item, amount) {
    let paletteIndices = this.flickerPaletteByCell[item.index];
    if (paletteIndices === undefined) {
      paletteIndices = this.flickerPaletteIndicesForCell(
        item.index,
        this.grid.cellState.level[item.index],
        amount,
      );
      this.flickerPaletteByCell[item.index] = paletteIndices;
    }
    return this.flicker.paletteColors[paletteIndices[item.glyphIndex]];
  }

  contentBounds() {
    const layout = this.grid.layout;
    return {
      x: layout.offsetX,
      y: layout.offsetY,
      width: layout.patternWidth,
      height: layout.patternHeight,
    };
  }

  animationDuration() {
    return this.options?.timing?.bodyDurationSeconds ?? null;
  }

  endpointAutoDuration(direction) {
    const transition = direction === "end"
      ? (this.grid.options.outro ?? this.grid.options.intro)
      : this.grid.options.intro;
    return Number.isFinite(transition?.durationSeconds)
      ? transition.durationSeconds
      : 1;
  }

  resize(viewport) {
    if (
      viewport.width === this.viewport.width
      && viewport.height === this.viewport.height
    ) return;
    this.flock.resize(this.viewport, viewport);
    this.viewport = { ...viewport };
    this.flockField.resize(viewport);
    this.grid.resize(viewport);
    this.flicker.resize(this.flickerGrid());
    this.resetDisappearingCellState();
  }

  signal(name) {
    return name === "pulse" ? this.flock.pulseStrength() : 0;
  }

  inspect() {
    let activeBoids = 0;
    for (const boid of this.flock.boids) {
      if (boid.active) activeBoids += 1;
    }
    return {
      type: "flock-grid",
      activeBoids,
      pulse: this.flock.pulseStrength(),
      speed: this.flock.speedMetrics(),
      timing: this.options.timing === undefined
        ? null
        : {
          ...this.options.timing,
          simulationTime: this.flock.time,
          beatIndex: Math.floor(
            this.flock.time / this.options.timing.beatSeconds,
          ) % this.options.timing.beatCount,
        },
      flicker: {
        ...this.flicker.inspect(),
        trigger: this.flickerTrigger,
        probability: this.disappearingCellProbability,
        subdivisionLevel: this.disappearingCellSubdivisionLevel,
        disappearingCells: [...this.disappearingCells],
        endOfLifeStart: this.endOfLifeStart,
      },
      compositionEndpoint: this.endCompositionEndpoint?.inspect() ?? null,
      field: this.flockField.snapshot(),
      grid: this.grid.inspect(),
    };
  }

  flockPreviewSnapshot() {
    const snapshot = {
      ...this.flockField.snapshot(),
      color: this.grid.paletteColors.at(-1),
    };
    // The endpoint owns the canvas here; showing a paused internal field makes
    // the diagnostic look like a second flock waiting behind the composition.
    if (this.compositionEndpoint !== null) {
      snapshot.pixels.fill(0);
      snapshot.life.fill(0);
    }
    return snapshot;
  }

  dispose() {
    this.circleEndpoint.reset();
    this.endCompositionEndpoint?.reset();
    this.grid.dispose();
  }
}
