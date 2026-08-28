import { CircleGrid } from "../grid/circle-grid.js";
import { Flock } from "./flock.js";
import { FlockFieldSource } from "../fields/flock-field-source.js";
import { NativeCircleEndpointTransition } from "../compositions/circle-endpoints.js";
import { createSceneTransitionModeRegistry } from "../scene-transitions/index.js";
import {
  FLICKER_DOTS_PER_CELL_AXIS,
  createFlicker,
  flickerPaletteIndicesForCell,
  mergeFlickerSettings,
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
import {
  createViewportFlockPath,
  dashArcLengthPath,
  sampleArcLengthPath,
} from "./flock-path.js";
import { createBoomLaunchers } from "./flock-boom.js";

const FLOCK_FLICKER_TRIGGERS = Object.freeze([
  "end-of-life",
  "disappearing-cell",
]);
const MAX_FLOCK_SUBDIVISION_LEVEL = 3;
const FLOCK_APPEARANCE_HASH_SALT = 1301;
const INTERACTIVE_TAKE_VERSION = 1;
const PICASSO_DEFAULTS = Object.freeze({
  showPath: true,
  guideForce: 900,
  guideRadiusScale: 2,
  tangentWeight: 1.2,
  dashLengthPixels: 18,
  dashGapPixels: 10,
  dashCyclesPerBeat: 4,
  lineWidth: 2,
  color: "#8cdfad",
  opacity: 0.82,
});
const BOOM_DEFAULTS = Object.freeze({
  intensity: 4,
});
const CELL_STATE_KEYS = Object.freeze([
  "level",
  "roundness",
  "scaleX",
  "scaleY",
  "rotation",
  "offsetX",
  "offsetY",
  "glyphScaleX",
  "glyphScaleY",
  "glyphScaleAxis",
  "glyphRotation",
  "glyphOffsetX",
  "glyphOffsetY",
  "paletteValue",
  "opacity",
]);

function copyViews(source, keys) {
  return Object.fromEntries(keys.map(key => [key, Array.from(source[key])]));
}

function isCopiedBuffer(value) {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}

function restoreViews(target, snapshot, keys) {
  for (const key of keys) {
    const source = snapshot?.[key];
    if (!isCopiedBuffer(source) || source.length !== target[key]?.length) {
      return false;
    }
  }
  for (const key of keys) target[key].set(snapshot[key]);
  return true;
}

function gesturesForStep(step) {
  if (Array.isArray(step?.gestures)) return step.gestures;
  return step?.gesture ? [step.gesture] : [];
}

function interactionForStep(step) {
  const interaction = step?.interaction ?? "launcher";
  if (
    interaction !== "launcher"
    && interaction !== "picasso"
    && interaction !== "boom"
    && interaction !== "flow"
  ) {
    throw new RangeError(
      `Interactive flock step "${step?.id ?? "-"}" has unsupported interaction "${interaction}".`,
    );
  }
  return interaction;
}

function resolvedBoomSettings(settings) {
  const result = { ...BOOM_DEFAULTS, ...(settings ?? {}) };
  if (!Number.isSafeInteger(result.intensity) || result.intensity <= 0) {
    throw new RangeError(
      "interactiveFlock.interaction.boom.intensity must be a positive integer.",
    );
  }
  return result;
}

function boomIntensityForStep(step, fallback) {
  return resolvedBoomSettings({
    intensity: step?.settings?.interaction?.boom?.intensity ?? fallback,
  }).intensity;
}

function resolvedPicassoSettings(settings) {
  const result = { ...PICASSO_DEFAULTS, ...(settings ?? {}) };
  for (const name of [
    "guideForce",
    "tangentWeight",
    "dashCyclesPerBeat",
  ]) {
    if (!Number.isFinite(result[name]) || result[name] < 0) {
      throw new RangeError(`interactiveFlock.interaction.picasso.${name} must be finite and non-negative.`);
    }
  }
  for (const name of [
    "guideRadiusScale",
    "dashLengthPixels",
    "dashGapPixels",
    "lineWidth",
  ]) {
    if (!Number.isFinite(result[name]) || result[name] <= 0) {
      throw new RangeError(`interactiveFlock.interaction.picasso.${name} must be finite and positive.`);
    }
  }
  if (!Number.isFinite(result.opacity) || result.opacity < 0 || result.opacity > 1) {
    throw new RangeError("interactiveFlock.interaction.picasso.opacity must be between zero and one.");
  }
  if (typeof result.color !== "string" || result.color.trim() === "") {
    throw new TypeError("interactiveFlock.interaction.picasso.color must be a non-empty string.");
  }
  if (typeof result.showPath !== "boolean") {
    throw new TypeError("interactiveFlock.interaction.picasso.showPath must be a boolean.");
  }
  return result;
}

function takeStepSignature(step) {
  return JSON.stringify({
    id: step?.id,
    interaction: interactionForStep(step),
    gestures: gesturesForStep(step),
    path: step?.path ?? null,
    boom: step?.boom ?? null,
    settings: step?.settings,
  });
}

function visibleBoidSettings(base, take) {
  return {
    ...base,
    ...(take?.takeSettings?.visibleBoids ?? {}),
    ...(take?.visibleBoids ?? {}),
    ...(typeof take?.takeSettings?.showBoids === "boolean"
      ? { show: take.takeSettings.showBoids }
      : {}),
    ...(typeof take?.showBoids === "boolean" ? { show: take.showBoids } : {}),
  };
}

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
    this.interactiveEnabled = options?.interaction !== undefined;
    this.baseSimulationOptions = structuredClone(options?.simulation ?? {});
    this.baseFlickerSettings = structuredClone(options?.flicker ?? {});
    this.visibleBoids = {
      show: false,
      size: 6,
      color: "#8cdfad",
      opacity: 0.78,
      ...(options?.visibleBoids ?? {}),
    };
    this.picasso = resolvedPicassoSettings(options?.interaction?.picasso);
    this.boom = resolvedBoomSettings(options?.interaction?.boom);
    this.takeState = null;
    this.interactiveRevision = null;
    this.interactiveTicks = 0;
    this.interactivePlaybackSignature = null;
    this.interactiveStepSignatures = [];
    this.interactivePrefixCache = [];
    this.interactiveAppliedSettings = {};
    this.interactiveGeometrySignature = null;

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
    this.flockField = new FlockFieldSource(
      this.flock,
      options.field,
      viewport,
      {
        probability: options.grid.appearanceProbability,
        unit: (index, count) => hashUnit(
          Number(this.runtime.projectSeed?.() ?? 0) >>> 0,
          index,
          count + FLOCK_APPEARANCE_HASH_SALT,
        ),
      },
    );
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
    this.flockField.resetAppearanceState(this.grid.energy.length);
    const noise = typeof runtime.p5?.noise === "function"
      ? runtime.p5.noise.bind(runtime.p5)
      : undefined;
    this.flickerNoise = noise;
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
    if (this.interactiveEnabled) this.disableAutomaticEmission();
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
    if (this.interactiveEnabled && planEntries[0]?.take) {
      this.takeState = planEntries[0].take;
      return;
    }
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
    if (this.interactiveEnabled && planEntries[0]?.take) {
      this.updateInteractive(frame, planEntries[0].take);
      return;
    }
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

  disableAutomaticEmission() {
    this.flock.nextPulseTime = Infinity;
  }

  interactiveFixedStep() {
    const value = this.options.interaction?.fixedStepSeconds ?? 1 / 60;
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(
        "interactiveFlock.interaction.fixedStepSeconds must be a finite positive number.",
      );
    }
    return value;
  }

  interactiveBeatTicks(take) {
    if (!Number.isFinite(take?.beatSeconds) || take.beatSeconds <= 0) {
      throw new RangeError("Interactive take beatSeconds must be a finite positive number.");
    }
    return Math.max(1, Math.round(take.beatSeconds / this.interactiveFixedStep()));
  }

  updateInteractive(frame, take) {
    if (!take || typeof take !== "object" || Array.isArray(take)) {
      throw new TypeError("Interactive flock render entries require a take object.");
    }
    this.takeState = take;
    this.compositionEndpoint = frame?.compositionEndpoint ?? null;
    if (take.mode !== this.lastInteractiveMode) {
      debug.timeline(
        "interactive-flock mode=%s steps=%d selected=%s",
        take.mode,
        take.steps?.length ?? 0,
        take.selectedStepId ?? "-",
      );
      this.lastInteractiveMode = take.mode;
    }

    this.rebuildInteractiveGeometry(take);
    this.synchronizeInteractiveSteps(take, frame);

    const beatSeconds = take.beatSeconds;
    const cyclePosition = beatSeconds > 0 ? this.flock.time / beatSeconds : 0;
    this.flicker.beginFrame({
      time: this.flock.time,
      progress: cyclePosition - Math.floor(cyclePosition),
      cycleIndex: Math.floor(cyclePosition),
    });
  }

  rebuildInteractiveGeometry(take) {
    const authored = take.takeSettings ?? {};
    const signature = JSON.stringify({
      count: authored.simulation?.count,
      grid: authored.grid,
      field: authored.field,
      palette: authored.palette,
    });
    if (signature === this.interactiveGeometrySignature) return false;

    this.interactiveGeometrySignature = signature;
    const simulation = {
      ...this.baseSimulationOptions,
      ...(Number.isSafeInteger(authored.simulation?.count)
        ? { count: authored.simulation.count }
        : {}),
    };
    if (simulation.count !== this.flock.boids.length) {
      this.flock = new Flock(simulation);
      this.flockField.flock = this.flock;
    }
    const gridOptions = {
      ...this.grid.options,
      ...this.options.grid,
      ...(authored.grid ?? {}),
      palette: authored.palette ?? this.options.palette,
      intro: this.options.intro,
      outro: this.options.outro,
    };
    this.grid.options = gridOptions;
    this.grid.buildPaletteLookup();
    this.grid.resize(this.viewport);
    this.flockField.surface.options = {
      ...this.options.field,
      ...(authored.field ?? {}),
    };
    this.flockField.resize(this.viewport);
    this.flicker.resize(this.flickerGrid());
    this.resetDisappearingCellState();
    this.resetInteractivePlayback();
    debug.config(
      "interactive-flock rebuild count=%d cells=%d field=%d palette=%s",
      this.flock.boids.length,
      this.grid.options.longSideCells,
      this.flockField.surface.options.longSidePixels,
      this.grid.options.palette,
    );
    return true;
  }

  synchronizeInteractiveSteps(take, frame) {
    const steps = Array.isArray(take.steps) ? take.steps : [];
    const signatures = steps.map(takeStepSignature);
    const playbackSignature = JSON.stringify({
      beatSeconds: take.beatSeconds,
      fixedStepSeconds: this.interactiveFixedStep(),
    });
    let firstChanged = Math.min(signatures.length, this.interactiveStepSignatures.length);
    for (let index = 0; index < firstChanged; index += 1) {
      if (signatures[index] !== this.interactiveStepSignatures[index]) {
        firstChanged = index;
        break;
      }
    }
    if (
      signatures.length === this.interactiveStepSignatures.length
      && firstChanged === signatures.length
    ) firstChanged = -1;
    if (playbackSignature !== this.interactivePlaybackSignature) firstChanged = 0;

    const beatTicks = this.interactiveBeatTicks(take);
    if (firstChanged >= 0) {
      this.interactivePrefixCache.length = Math.min(
        this.interactivePrefixCache.length,
        firstChanged + 1,
      );
      if (this.interactiveTicks > firstChanged * beatTicks) {
        this.restoreInteractivePrefix(firstChanged);
      }
      debug.transition(
        "interactive-flock plan revision=%s changed=%d steps=%d cached=%d",
        take.revision ?? "-",
        firstChanged,
        steps.length,
        this.interactivePrefixCache.length,
      );
    }
    this.interactivePlaybackSignature = playbackSignature;
    this.interactiveStepSignatures = signatures;
    this.interactiveRevision = take.revision ?? this.interactiveRevision;

    const authoredTarget = Number.isFinite(take.playbackTime)
      ? take.playbackTime
      : 0;
    const maximumTicks = steps.length * beatTicks;
    const targetTicks = Math.max(0, Math.min(
      maximumTicks,
      Math.floor(authoredTarget / this.interactiveFixedStep() + 1e-7),
    ));
    if (targetTicks < this.interactiveTicks) {
      this.restoreInteractivePrefix(Math.floor(targetTicks / beatTicks));
    }
    this.advanceInteractiveTicks(targetTicks, beatTicks, steps, frame);
  }

  resetInteractivePlayback() {
    this.flock.reset();
    this.disableAutomaticEmission();
    this.grid.energy.fill(0);
    this.grid.previousEnergy.fill(0);
    this.grid.cellState.reset();
    this.grid.meanEnergy = 0;
    this.flockField.resetAppearanceState(this.grid.energy.length);
    this.resetDisappearingCellState();
    this.interactiveTicks = 0;
    this.interactivePlaybackSignature = null;
    this.interactiveAppliedSettings = {};
    this.interactiveFlickerSignature = null;
    this.configureInteractiveFlicker();
    this.interactivePrefixCache = [this.captureInteractiveState()];
  }

  captureInteractiveState() {
    if (typeof this.flock.snapshotState !== "function") {
      throw new TypeError("Interactive flock requires Flock.snapshotState().");
    }
    return {
      ticks: this.interactiveTicks,
      flock: this.flock.snapshotState(),
      grid: {
        energy: Array.from(this.grid.energy),
        previousEnergy: Array.from(this.grid.previousEnergy),
        meanEnergy: this.grid.meanEnergy,
        cellState: copyViews(this.grid.cellState, CELL_STATE_KEYS),
      },
      appearance: this.flockField.snapshotAppearanceState(),
      disappearingCells: Array.from(this.disappearingCells),
      previouslyDisappearingCells: Array.from(this.previouslyDisappearingCells),
      disappearanceCounts: Array.from(this.disappearanceCounts),
      disappearanceEventIndex: this.disappearanceEventIndex,
      appliedSettings: structuredClone(this.interactiveAppliedSettings),
    };
  }

  restoreInteractiveState(snapshot) {
    if (
      !snapshot
      || !Number.isSafeInteger(snapshot.ticks)
      || snapshot.ticks < 0
      || typeof this.flock.restoreState !== "function"
      || this.flock.restoreState(snapshot.flock) === false
      || !isCopiedBuffer(snapshot.grid?.energy)
      || snapshot.grid.energy.length !== this.grid.energy.length
      || !isCopiedBuffer(snapshot.grid?.previousEnergy)
      || snapshot.grid.previousEnergy.length !== this.grid.previousEnergy.length
      || !restoreViews(this.grid.cellState, snapshot.grid.cellState, CELL_STATE_KEYS)
      || !this.flockField.restoreAppearanceState(snapshot.appearance)
      || !isCopiedBuffer(snapshot.disappearingCells)
      || snapshot.disappearingCells.length !== this.disappearingCells.length
      || !isCopiedBuffer(snapshot.previouslyDisappearingCells)
      || snapshot.previouslyDisappearingCells.length !== this.previouslyDisappearingCells.length
      || !isCopiedBuffer(snapshot.disappearanceCounts)
      || snapshot.disappearanceCounts.length !== this.disappearanceCounts.length
    ) return false;

    this.disableAutomaticEmission();
    this.interactiveTicks = snapshot.ticks;
    this.grid.energy.set(snapshot.grid.energy);
    this.grid.previousEnergy.set(snapshot.grid.previousEnergy);
    this.grid.meanEnergy = Number(snapshot.grid.meanEnergy) || 0;
    this.disappearingCells.set(snapshot.disappearingCells);
    this.previouslyDisappearingCells.set(snapshot.previouslyDisappearingCells);
    this.disappearanceCounts.set(snapshot.disappearanceCounts);
    this.disappearanceEventIndex = snapshot.disappearanceEventIndex ?? 0;
    this.interactiveAppliedSettings = structuredClone(snapshot.appliedSettings ?? {});
    this.applyInteractiveSettings(this.interactiveAppliedSettings, { replace: true });
    this.flockField.surface.draw(this.flock);
    return true;
  }

  restoreInteractivePrefix(index) {
    let candidate = Math.min(index, this.interactivePrefixCache.length - 1);
    while (candidate > 0 && !this.interactivePrefixCache[candidate]) candidate -= 1;
    const snapshot = this.interactivePrefixCache[candidate];
    if (snapshot && this.restoreInteractiveState(snapshot)) return true;
    this.resetInteractivePlayback();
    return candidate === 0;
  }

  advanceInteractiveTicks(targetTicks, beatTicks, steps, frame) {
    const fixedStep = this.interactiveFixedStep();
    const picassoPaths = new Map();
    while (this.interactiveTicks < targetTicks) {
      const tickInBeat = this.interactiveTicks % beatTicks;
      const stepIndex = Math.floor(this.interactiveTicks / beatTicks);
      const step = steps[stepIndex];
      if (!step) break;
      const interaction = interactionForStep(step);
      let guide;
      if (tickInBeat === 0) {
        if (interaction !== "flow") {
          this.applyInteractiveSettings(step.settings ?? {});
        }
        if (interaction === "launcher") {
          const gestures = gesturesForStep(step);
          for (const [launchIndex, gesture] of gestures.entries()) {
            this.flock.emitPulse(this.viewport.width, this.viewport.height, {
              originX: gesture.originX * this.viewport.width,
              originY: gesture.originY * this.viewport.height,
              directionX: gesture.directionX,
              directionY: gesture.directionY,
              strength: gesture.strength ?? 1,
            });
            debug.transition(
              "interactive-flock pulse step=%s index=%d launch=%d launches=%d tick=%d origin=%.3f,%.3f direction=%.3f,%.3f strength=%.3f",
              step.id,
              stepIndex,
              launchIndex,
              gestures.length,
              this.interactiveTicks,
              gesture.originX,
              gesture.originY,
              gesture.directionX,
              gesture.directionY,
              gesture.strength ?? 1,
            );
          }
        } else if (interaction === "boom") {
          const intensity = boomIntensityForStep(step, this.boom.intensity);
          const launchers = createBoomLaunchers(step.boom, this.viewport, intensity);
          for (const launcher of launchers) {
            this.flock.emitPulse(
              this.viewport.width,
              this.viewport.height,
              launcher,
            );
          }
          debug.transition(
            "interactive-flock boom step=%s index=%d tick=%d center=%.3f,%.3f radius=%.3f intensity=%d launchers=%d",
            step.id,
            stepIndex,
            this.interactiveTicks,
            step.boom.centerX,
            step.boom.centerY,
            step.boom.radius,
            intensity,
            launchers.length,
          );
        } else if (interaction === "picasso") {
          const path = createViewportFlockPath(step.path, this.viewport);
          picassoPaths.set(step, path);
          const origin = sampleArcLengthPath(path, 0);
          this.flock.emitPulse(this.viewport.width, this.viewport.height, {
            originX: origin.x,
            originY: origin.y,
            directionX: origin.directionX,
            directionY: origin.directionY,
          });
          debug.transition(
            "interactive-flock picasso-start step=%s index=%d tick=%d points=%d length=%.3f origin=%.3f,%.3f direction=%.3f,%.3f",
            step.id,
            stepIndex,
            this.interactiveTicks,
            path.points.length,
            path.length,
            origin.x / this.viewport.width,
            origin.y / this.viewport.height,
            origin.directionX,
            origin.directionY,
          );
        } else {
          debug.transition(
            "interactive-flock flow step=%s index=%d tick=%d ticks=%d",
            step.id,
            stepIndex,
            this.interactiveTicks,
            beatTicks,
          );
        }
      }

      if (interaction === "picasso") {
        let path = picassoPaths.get(step);
        if (!path) {
          path = createViewportFlockPath(step.path, this.viewport);
          picassoPaths.set(step, path);
        }
        const target = sampleArcLengthPath(path, (tickInBeat + 1) / beatTicks);
        guide = {
          x: target.x,
          y: target.y,
          directionX: target.directionX,
          directionY: target.directionY,
          force: this.picasso.guideForce,
          radius: this.flock.options.perceptionRadius * this.picasso.guideRadiusScale,
          tangentWeight: this.picasso.tangentWeight,
        };
      }

      this.flock.update(
        fixedStep,
        this.viewport.width,
        this.viewport.height,
        { active: false },
        guide,
      );
      this.disableAutomaticEmission();
      const simulationTime = (this.interactiveTicks + 1) * fixedStep;
      this.grid.update(this.fieldSources, fixedStep, {
        ...frame,
        dt: fixedStep,
        compositionDt: fixedStep,
        time: simulationTime,
        pointer: { active: false },
      });
      this.updateFlickerActivation();
      this.interactiveTicks += 1;
      if (this.interactiveTicks % beatTicks === 0) {
        const prefixIndex = this.interactiveTicks / beatTicks;
        this.interactivePrefixCache[prefixIndex] = this.captureInteractiveState();
      }
    }
  }

  applyInteractiveSettings(settings, { replace = false } = {}) {
    const next = replace
      ? structuredClone(settings ?? {})
      : {
        ...this.interactiveAppliedSettings,
        ...(settings ?? {}),
        simulation: {
          ...(this.interactiveAppliedSettings.simulation ?? {}),
          ...(settings?.simulation ?? {}),
        },
        flicker: mergeFlickerSettings(
          this.interactiveAppliedSettings.flicker,
          settings?.flicker,
        ),
      };
    this.interactiveAppliedSettings = next;
    const simulation = next.simulation ?? {};
    for (const [name, value] of Object.entries(simulation)) {
      if (name === "count" || name === "pulseEverySeconds") continue;
      if (Object.hasOwn(this.flock.options, name)) this.flock.options[name] = value;
    }
    this.flock.residenceSeconds = this.flock.effectiveResidenceSeconds();
    this.configureInteractiveFlicker(next.flicker);
  }

  configureInteractiveFlicker(overrides = this.interactiveAppliedSettings.flicker) {
    const signature = JSON.stringify(overrides ?? {});
    if (signature === this.interactiveFlickerSignature && this.flicker) return;
    this.interactiveFlickerSignature = signature;
    this.flicker = createFlicker({
      palette: this.grid.paletteColors,
      settings: mergeFlickerSettings(this.baseFlickerSettings, overrides),
      noiseFunction: this.flickerNoise,
      grid: this.flickerGrid(),
      autoCycleSeconds: this.takeState?.beatSeconds
        ?? this.options.timing?.beatSeconds
        ?? this.baseSimulationOptions.pulseEverySeconds,
    });
    this.flicker.resize(this.flickerGrid());
    this.configureFlickerEnvelope();
    this.endOfLifeStart = this.flicker.envelope.endOfLifeStart ?? 0.5;
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
    this.flockField.resetAppearanceState(this.grid.energy.length);
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
    this.drawVisibleBoids(context);
    if (this.interactiveEnabled) this.drawInteractivePath(context, frame);
    if (this.interactiveEnabled && frame?.exporting !== true) {
      this.drawAuthoringGesture(context);
    }
  }

  drawVisibleBoids(context) {
    const settings = visibleBoidSettings(this.visibleBoids, this.takeState);
    if (settings.show !== true) return;
    if (!Number.isFinite(settings.size) || settings.size <= 0) {
      throw new RangeError("interactiveFlock.visibleBoids.size must be a finite positive number.");
    }
    if (!Number.isFinite(settings.opacity) || settings.opacity < 0 || settings.opacity > 1) {
      throw new RangeError("interactiveFlock.visibleBoids.opacity must be between zero and one.");
    }
    if (typeof settings.color !== "string" || settings.color.trim() === "") {
      throw new TypeError("interactiveFlock.visibleBoids.color must be a non-empty string.");
    }

    const radius = settings.size * 0.5;
    const inheritedAlpha = Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1;
    context.save();
    try {
      context.fillStyle = settings.color;
      for (const boid of this.flock.boids) {
        if (
          !boid.active
          || boid.x + radius < 0
          || boid.x - radius > this.viewport.width
          || boid.y + radius < 0
          || boid.y - radius > this.viewport.height
        ) continue;
        context.globalAlpha = inheritedAlpha * settings.opacity * boid.opacity;
        context.beginPath();
        context.moveTo(boid.x + radius, boid.y);
        context.arc(boid.x, boid.y, radius, 0, Math.PI * 2);
        context.fill();
      }
    } finally {
      context.restore();
    }
  }

  drawAuthoringGesture(context) {
    const take = this.takeState;
    if (!take || take.mode === "sealed" || take.mode === "playing") return;
    if (take.interactionMode === "picasso") return;
    const selected = take.steps?.find(step => step.id === take.selectedStepId);
    if (take.interactionMode === "boom") {
      const boom = take.draftBoom ?? selected?.boom;
      if (!boom || !Number.isFinite(boom.radius) || boom.radius <= 0) return;
      const settings = take.draftBoom ? take.stagedSettings : selected?.settings;
      const intensity = boomIntensityForStep({ settings }, this.boom.intensity);
      this.drawAuthoringBoom(context, boom, intensity);
      return;
    }
    const draftGestures = Array.isArray(take.draftGestures)
      ? [...take.draftGestures]
      : [];
    if (take.draftGesture) draftGestures.push(take.draftGesture);
    const gestures = draftGestures.length > 0
      ? draftGestures
      : gesturesForStep(selected);
    if (gestures.length === 0) return;

    context.save();
    try {
      context.globalAlpha *= 0.9;
      context.strokeStyle = this.visibleBoids.color;
      context.lineWidth = 2;
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const gesture of gestures) this.drawAuthoringArrow(context, gesture);
    } finally {
      context.restore();
    }
  }

  drawAuthoringBoom(context, boom, intensity) {
    const launchers = createBoomLaunchers(boom, this.viewport, intensity);
    const centerX = boom.centerX * this.viewport.width;
    const centerY = boom.centerY * this.viewport.height;
    const radius = boom.radius * Math.min(this.viewport.width, this.viewport.height);
    const arrowLength = Math.max(
      12,
      Math.min(this.viewport.width, this.viewport.height) * 0.06,
    );

    context.save();
    try {
      context.globalAlpha *= 0.9;
      context.strokeStyle = this.visibleBoids.color;
      context.lineWidth = 2;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.stroke();
      for (const launcher of launchers) {
        this.drawAuthoringArrow(context, {
          originX: launcher.originX / this.viewport.width,
          originY: launcher.originY / this.viewport.height,
          directionX: launcher.directionX,
          directionY: launcher.directionY,
          endX: (launcher.originX + launcher.directionX * arrowLength)
            / this.viewport.width,
          endY: (launcher.originY + launcher.directionY * arrowLength)
            / this.viewport.height,
        });
      }
    } finally {
      context.restore();
    }
  }

  interactivePathPresentation(frame) {
    const take = this.takeState;
    if (!take) return null;
    const isAuthoring = take.mode !== "sealed" && take.mode !== "playing";
    if (
      frame?.exporting !== true
      && isAuthoring
      && Array.isArray(take.draftPath?.points)
      && take.draftPath.points.length >= 2
    ) {
      const beatSeconds = Number.isFinite(take.beatSeconds) && take.beatSeconds > 0
        ? take.beatSeconds
        : 1;
      // Marching dashes remain a live authoring cue while the simulation stays frozen.
      const time = Number.isFinite(frame?.time) ? frame.time : 0;
      return {
        path: take.draftPath,
        progress: (time / beatSeconds) - Math.floor(time / beatSeconds),
        draft: true,
      };
    }

    const showPath = take.takeSettings?.showPath ?? this.picasso.showPath;
    if (showPath !== true || !Array.isArray(take.steps) || take.steps.length === 0) {
      return null;
    }
    const beatSeconds = Number.isFinite(take.beatSeconds) && take.beatSeconds > 0
      ? take.beatSeconds
      : 1;
    const playbackTime = Number.isFinite(take.playbackTime)
      ? Math.max(0, take.playbackTime)
      : 0;
    let stepIndex;
    if (take.mode === "playing" || take.mode === "sealed") {
      stepIndex = Math.min(
        take.steps.length - 1,
        Math.floor(playbackTime / beatSeconds),
      );
    } else {
      const selectedIndex = take.steps.findIndex(step => step.id === take.selectedStepId);
      stepIndex = selectedIndex >= 0 ? selectedIndex : take.steps.length - 1;
    }
    const step = take.steps[stepIndex];
    if (!step || interactionForStep(step) !== "picasso") return null;

    let progress;
    if (take.mode === "playing" || take.mode === "sealed") {
      progress = Math.max(0, Math.min(
        1,
        playbackTime / beatSeconds - stepIndex,
      ));
    } else {
      // A selected route keeps advertising its drawn direction outside playback.
      const time = Number.isFinite(frame?.time) ? frame.time : 0;
      progress = (time / beatSeconds) - Math.floor(time / beatSeconds);
    }
    return { path: step.path, progress, draft: false };
  }

  drawInteractivePath(context, frame = {}) {
    const presentation = this.interactivePathPresentation(frame);
    if (!presentation) return false;
    const path = createViewportFlockPath(presentation.path, this.viewport);
    const dashPeriod = this.picasso.dashLengthPixels
      + this.picasso.dashGapPixels;
    const segments = dashArcLengthPath(path, {
      dashLength: this.picasso.dashLengthPixels,
      gapLength: this.picasso.dashGapPixels,
      offset: presentation.progress * dashPeriod * this.picasso.dashCyclesPerBeat,
    });
    const terminal = sampleArcLengthPath(path, 1);
    const arrowLength = Math.max(8, this.picasso.lineWidth * 5);
    const sideX = -terminal.directionY;
    const sideY = terminal.directionX;

    context.save();
    try {
      context.globalAlpha *= this.picasso.opacity;
      context.strokeStyle = this.picasso.color;
      context.lineWidth = this.picasso.lineWidth;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      for (const segment of segments) {
        context.moveTo(segment.from.x, segment.from.y);
        context.lineTo(segment.to.x, segment.to.y);
      }
      context.moveTo(terminal.x, terminal.y);
      context.lineTo(
        terminal.x - terminal.directionX * arrowLength + sideX * arrowLength * 0.55,
        terminal.y - terminal.directionY * arrowLength + sideY * arrowLength * 0.55,
      );
      context.moveTo(terminal.x, terminal.y);
      context.lineTo(
        terminal.x - terminal.directionX * arrowLength - sideX * arrowLength * 0.55,
        terminal.y - terminal.directionY * arrowLength - sideY * arrowLength * 0.55,
      );
      context.stroke();
    } finally {
      context.restore();
    }
    return true;
  }

  drawAuthoringArrow(context, gesture) {
    const originX = gesture.originX * this.viewport.width;
    const originY = gesture.originY * this.viewport.height;
    let endX = Number.isFinite(gesture.endX)
      ? gesture.endX * this.viewport.width
      : NaN;
    let endY = Number.isFinite(gesture.endY)
      ? gesture.endY * this.viewport.height
      : NaN;
    if (!Number.isFinite(endX) || !Number.isFinite(endY)) {
      const arrowLength = Math.max(28, Math.min(this.viewport.width, this.viewport.height) * 0.12);
      endX = originX + gesture.directionX * arrowLength;
      endY = originY + gesture.directionY * arrowLength;
    }
    const directionX = endX - originX;
    const directionY = endY - originY;
    const magnitude = Math.hypot(directionX, directionY);
    if (!(magnitude > 0)) return;
    const unitX = directionX / magnitude;
    const unitY = directionY / magnitude;
    const head = Math.max(8, Math.min(14, magnitude * 0.25));
    const sideX = -unitY;
    const sideY = unitX;

    context.beginPath();
    context.moveTo(originX, originY);
    context.lineTo(endX, endY);
    context.moveTo(endX, endY);
    context.lineTo(
      endX - unitX * head + sideX * head * 0.55,
      endY - unitY * head + sideY * head * 0.55,
    );
    context.moveTo(endX, endY);
    context.lineTo(
      endX - unitX * head - sideX * head * 0.55,
      endY - unitY * head - sideY * head * 0.55,
    );
    context.stroke();
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

  seek(time) {
    if (!this.interactiveEnabled) return false;
    if (!Number.isFinite(time) || time < 0) return false;
    // The rule publishes the authoritative wrapped playbackTime on the next
    // update; synchronization then restores or advances from a cached prefix.
    return true;
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
    this.flockField.resetAppearanceState(this.grid.energy.length);
    this.flicker.resize(this.flickerGrid());
    this.resetDisappearingCellState();
    if (this.interactiveEnabled) {
      this.interactiveGeometrySignature = null;
      this.resetInteractivePlayback();
    }
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
          ...(this.interactiveEnabled && this.takeState?.beatSeconds
            ? { beatSeconds: this.takeState.beatSeconds }
            : {}),
          simulationTime: this.flock.time,
          beatIndex: Math.floor(
            this.flock.time / (
              this.takeState?.beatSeconds ?? this.options.timing.beatSeconds
            ),
          ) % Math.max(
            1,
            this.options.timing.beatCount ?? this.takeState?.steps?.length ?? 1,
          ),
        },
      take: this.interactiveEnabled && this.takeState
        ? {
          mode: this.takeState.mode,
          revision: this.takeState.revision ?? null,
          stepCount: this.takeState.steps?.length ?? 0,
          selectedStepId: this.takeState.selectedStepId ?? null,
          previewStepId: this.takeState.previewStepId ?? null,
          playbackTime: this.takeState.playbackTime ?? 0,
          fixedStep: this.interactiveFixedStep(),
          cachedPrefixes: this.interactivePrefixCache.filter(Boolean).length,
          showBoids: visibleBoidSettings(this.visibleBoids, this.takeState).show === true,
          showPath: (this.takeState.takeSettings?.showPath ?? this.picasso.showPath) === true,
        }
        : null,
      flicker: {
        ...this.flicker.inspect(),
        trigger: this.flickerTrigger,
        probability: this.disappearingCellProbability,
        subdivisionLevel: this.disappearingCellSubdivisionLevel,
        disappearingCells: [...this.disappearingCells],
        endOfLifeStart: this.endOfLifeStart,
      },
      compositionEndpoint: this.endCompositionEndpoint?.inspect() ?? null,
      appearance: {
        probability: this.flockField.appearanceProbability,
        activeCells: this.flockField.appearingCells.reduce(
          (total, value) => total + value,
          0,
        ),
      },
      field: this.flockField.snapshot(),
      grid: this.grid.inspect(),
    };
  }

  snapshotProjectState() {
    if (!this.interactiveEnabled) return undefined;
    return {
      version: INTERACTIVE_TAKE_VERSION,
      revision: this.interactiveRevision,
      take: structuredClone(this.takeState),
      geometrySignature: this.interactiveGeometrySignature,
      playbackSignature: this.interactivePlaybackSignature,
      stepSignatures: [...this.interactiveStepSignatures],
      prefixCache: structuredClone(this.interactivePrefixCache),
      simulation: this.captureInteractiveState(),
    };
  }

  restoreProjectState(snapshot, restoreContext = {}) {
    if (!this.interactiveEnabled) return false;
    const restoredTake = restoreContext.ruleState ?? snapshot?.take;
    if (
      !snapshot
      || snapshot.version !== INTERACTIVE_TAKE_VERSION
      || !restoredTake
      || !Array.isArray(snapshot.stepSignatures)
      || !Array.isArray(snapshot.prefixCache)
    ) return false;
    this.takeState = structuredClone(restoredTake);
    this.interactiveGeometrySignature = null;
    this.rebuildInteractiveGeometry(this.takeState);
    this.interactiveRevision = snapshot.revision ?? null;
    this.interactivePlaybackSignature = snapshot.playbackSignature ?? null;
    this.interactiveStepSignatures = [...snapshot.stepSignatures];
    this.interactivePrefixCache = structuredClone(snapshot.prefixCache);
    return this.restoreInteractiveState(snapshot.simulation);
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
