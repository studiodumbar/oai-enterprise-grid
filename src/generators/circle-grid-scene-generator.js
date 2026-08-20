import {
  CIRCLE_TAU,
  EMPTY_GRID_FACE_LEVEL,
  GRID_FACE_PALETTE_STEP_COUNT,
  MAX_GRID_FACE_LEVEL,
  candidateFlickerAmountAt,
  emptyGridFace,
  gridFaceSignature,
  hashUnit,
  minimumSceneHoldFraction,
} from "./grid-scene-strategies.js";
import {
  createFlicker,
  resolveFlickerFromOptions,
} from "../visuals/flicker/index.js";
import {
  SceneTransition,
  createSceneTransitionModeRegistry,
  resolveSceneTransitionSettings,
} from "../scene-transitions/index.js";
import {
  CellStateTransition,
  createCellTransitionModeRegistry,
  resolveCellTransitionSettings,
} from "../cell-transitions/index.js";
import { NativeCircleEndpointTransition } from "../compositions/circle-endpoints.js";
import {
  createCompositionEndpointMode,
  nativeCircleEndpointSettings,
  resolveCompositionEndpointSettings,
} from "../composition-endpoints/index.js";
import {
  drawCompositionEndpointFrame as drawEndpointFrame,
} from "../composition-endpoints/render.js";
import { debug } from "../debug/index.js";
import {
  isAutomaticDurationSetting,
  resolveAutomaticDuration,
} from "../core/automatic-duration.js";
import {
  requireMatchingTimelineValue,
  resolveTimelineSettings,
} from "../timeline/timeline-settings.js";

export const DEFAULT_CIRCLE_GRID_SCENE_OPTIONS = Object.freeze({
  longSideCells: 9,
  dotMargin: 0.14,
  palette: "green",
  cycleSeconds: 2.4,
  stepCount: 7,
  flipSeconds: 0.04,
});

const IDENTITY_PRESENTATION = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  opacity: 1,
  scale: 1,
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function faceShowsGlyph(face, glyphIndex) {
  const visible = face.detail?.visibleGlyphIndices;
  return !Array.isArray(visible) || visible.includes(glyphIndex);
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const amount = clamp01((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function requireFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`);
  }
}

/**
 * One beat of a composition's timeline: the length a flicker mode authored with
 * `cycleSeconds: "auto"` adopts. Every circle-grid composition folds its own
 * domain parameter — voronoi's partition passes, an automaton's generations, a
 * layer pass — into `stepCount`, so the seconds one scene state holds is the
 * beat unless a specification calculates its own.
 */
export function autoFlickerCycleSeconds(options, specification = {}) {
  const calculated = specification.autoFlickerCycleSeconds
    ? specification.autoFlickerCycleSeconds(options)
    : options.cycleSeconds / options.stepCount;
  return Number.isFinite(calculated) && calculated > 0 ? calculated : null;
}

export function normalizeCircleGridSceneOptions(options = {}, specification = {}) {
  const compatibilityFlipSeconds = options.flipSeconds === undefined
    ? options.countTransitionSeconds
    : undefined;
  const prepared = specification.normalizeOptions
    ? specification.normalizeOptions(options)
    : options;
  const timing = prepared.timing === undefined
    ? null
    : resolveTimelineSettings(prepared.timing, "timing");
  const authoredCycleSeconds = prepared.cycleSeconds ?? prepared.tokenSeconds;
  const authoredStepCount = prepared.stepCount ?? prepared.layerPasses;
  if (timing) {
    requireMatchingTimelineValue(
      authoredCycleSeconds,
      timing.bodyDurationSeconds,
      { label: "cycleSeconds", source: "timing.bodyDurationSeconds" },
    );
    requireMatchingTimelineValue(
      authoredStepCount,
      timing.beatCount,
      { label: "stepCount", source: "timing.beatCount" },
    );
  }
  const strategy = prepared.strategy ?? specification.defaultStrategy;
  const normalized = {
    ...DEFAULT_CIRCLE_GRID_SCENE_OPTIONS,
    ...specification.defaults,
    ...prepared,
    strategy,
    cycleSeconds: authoredCycleSeconds
      ?? timing?.bodyDurationSeconds
      ?? specification.defaults?.cycleSeconds
      ?? DEFAULT_CIRCLE_GRID_SCENE_OPTIONS.cycleSeconds,
    stepCount: authoredStepCount
      ?? timing?.beatCount
      ?? specification.defaults?.stepCount
      ?? DEFAULT_CIRCLE_GRID_SCENE_OPTIONS.stepCount,
    ...(compatibilityFlipSeconds === undefined
      ? {}
      : { flipSeconds: compatibilityFlipSeconds }),
  };
  // Strategy functions use one internal clock/pass vocabulary even when an
  // authored settings file exposes domain names such as generations.
  normalized.tokenSeconds = normalized.cycleSeconds;
  normalized.layerPasses = normalized.stepCount;
  if (timing) normalized.timing = timing;

  if (!specification.strategies?.includes(normalized.strategy)) {
    throw new Error(
      `Generator type "${specification.type}" does not support strategy `
      + `"${normalized.strategy}". Available strategies: `
      + `${specification.strategies?.join(", ") || "<none>"}.`,
    );
  }
  requireFinitePositive(normalized.cycleSeconds, "cycleSeconds");
  requireFinitePositive(normalized.flipSeconds, "flipSeconds");
  if (
    !Number.isInteger(normalized.stepCount)
    || normalized.stepCount < 1
    || normalized.stepCount > 64
  ) {
    throw new RangeError("stepCount must be an integer between 1 and 64.");
  }
  const holdFraction = specification.minimumHoldFraction
    ?? minimumSceneHoldFraction;
  const shortestHoldSeconds = normalized.cycleSeconds * holdFraction(
    normalized.strategy,
    normalized.stepCount,
  );
  // New faces begin at the blank midpoint, so only the second half of the
  // configured flip envelope must complete inside a scene hold.
  if (normalized.flipSeconds * 0.5 > shortestHoldSeconds) {
    throw new RangeError("flipSeconds must fit inside the shortest display hold.");
  }
  if (!Number.isFinite(normalized.longSideCells) || normalized.longSideCells <= 0) {
    throw new RangeError("longSideCells must be a finite positive number.");
  }
  if (
    !Number.isFinite(normalized.dotMargin)
    || normalized.dotMargin < 0
    || normalized.dotMargin >= 1
  ) {
    throw new RangeError("dotMargin must be between 0 (inclusive) and 1 (exclusive).");
  }
  if (typeof normalized.palette !== "string" || normalized.palette.trim() === "") {
    throw new TypeError("palette must be a non-empty string.");
  }
  // Strategies and the renderer read exactly one flicker object, whether the
  // settings file authored the current `flicker` block or a legacy
  // per-composition one.
  normalized.autoFlickerCycleSeconds = autoFlickerCycleSeconds(
    normalized,
    specification,
  );
  normalized.flicker = resolveFlickerFromOptions(normalized, undefined, {
    autoCycleSeconds: normalized.autoFlickerCycleSeconds,
  });
  debug.config(
    "flicker auto type=%s strategy=%s cycle=%.3f steps=%d auto=%s",
    specification.type ?? "unknown",
    normalized.strategy,
    normalized.cycleSeconds,
    normalized.stepCount,
    normalized.autoFlickerCycleSeconds === null
      ? "none"
      : normalized.autoFlickerCycleSeconds.toFixed(3),
  );
  const authoredCellTransitions = resolveCellTransitionSettings(
    {},
    normalized.cellTransitions ?? {},
  );
  if (isAutomaticDurationSetting(authoredCellTransitions.durationSeconds)) {
    const exactCellTransitionSeconds = typeof specification.exactCellTransitionSeconds
      === "function"
      ? specification.exactCellTransitionSeconds(normalized)
      : null;
    const hasExactCellTransition = Number.isFinite(exactCellTransitionSeconds)
      && exactCellTransitionSeconds > 0;
    const duration = resolveAutomaticDuration(
      authoredCellTransitions.durationSeconds,
      {
        label: "cellTransitions.durationSeconds",
        candidates: [
          {
            source: hasExactCellTransition ? "next-scene" : "shortest-scene",
            seconds: hasExactCellTransition
              ? exactCellTransitionSeconds
              : shortestHoldSeconds,
          },
        ],
      },
    );
    normalized.cellTransitions = resolveCellTransitionSettings({}, {
      ...authoredCellTransitions,
      durationSeconds: duration.seconds,
    });
    debug.config(
      "duration setting=cell-transition authored=%s source=%s base=%.3f multiplier=%.3f resolved=%.3f",
      duration.authored,
      duration.source,
      duration.baseSeconds,
      duration.multiplier,
      duration.seconds,
    );
  } else {
    normalized.cellTransitions = authoredCellTransitions;
  }
  normalized.intro = resolveSceneTransitionSettings({}, normalized.intro ?? {});
  normalized.outro = normalized.outro === undefined
    ? resolveSceneTransitionSettings(normalized.intro, { fallbackToIntro: true })
    : resolveSceneTransitionSettings(normalized.intro, normalized.outro);
  specification.validateOptions?.(normalized);
  return normalized;
}

function paletteByName(palettes, requestedName) {
  if (!palettes || typeof palettes !== "object") {
    throw new TypeError("Circle-grid scene generator requires a palettes object.");
  }
  const normalizedName = requestedName.toLowerCase();
  const key = Object.keys(palettes).find(
    name => name.toLowerCase() === normalizedName,
  );
  if (!key) {
    throw new Error(
      `Unknown palette "${requestedName}". Available palettes: ${Object.keys(palettes).join(", ")}.`,
    );
  }
  const palette = palettes[key];
  if (!Array.isArray(palette) || palette.length < GRID_FACE_PALETTE_STEP_COUNT) {
    throw new TypeError(
      `Palette "${key}" must contain at least ${GRID_FACE_PALETTE_STEP_COUNT} colors.`,
    );
  }
  const logicalColors = Array.from(
    { length: GRID_FACE_PALETTE_STEP_COUNT },
    (_, step) => {
      const normalized = step / (GRID_FACE_PALETTE_STEP_COUNT - 1);
      return palette[Math.round(normalized * (palette.length - 1))].toLowerCase();
    },
  );
  if (new Set(logicalColors).size !== GRID_FACE_PALETTE_STEP_COUNT) {
    throw new TypeError(
      `Palette "${key}" must resolve to ${GRID_FACE_PALETTE_STEP_COUNT} distinct face colors.`,
    );
  }
  return palette;
}

function rgbColorFromHex(color) {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (!match) {
    throw new TypeError(
      `Circle-grid palettes must use six-digit hex colors; received "${color}".`,
    );
  }
  const [red, green, blue] = match
    .slice(1)
    .map(channel => Number.parseInt(channel, 16));
  return `rgb(${red} ${green} ${blue})`;
}

export function createCircleGridSceneLayout(viewport, longSideCells = 9) {
  const width = Number(viewport?.width);
  const height = Number(viewport?.height);
  requireFinitePositive(width, "viewport width");
  requireFinitePositive(height, "viewport height");

  const requested = Math.max(3, Math.round(longSideCells));
  const longCells = requested % 2 === 0 ? requested - 1 : requested;
  const minimumShortCells = Math.min(3, longCells);
  const cellSize = Math.min(
    Math.max(width, height) / longCells,
    Math.min(width, height) / minimumShortCells,
  );
  const fitOdd = size => {
    const count = Math.max(1, Math.floor(size / cellSize));
    return count % 2 === 0 ? Math.max(1, count - 1) : count;
  };
  const columns = width >= height ? longCells : fitOdd(width);
  const rows = width >= height ? fitOdd(height) : longCells;
  const patternWidth = columns * cellSize;
  const patternHeight = rows * cellSize;

  return {
    width,
    height,
    columns,
    rows,
    cellSize,
    patternWidth,
    patternHeight,
    offsetX: (width - patternWidth) * 0.5,
    offsetY: (height - patternHeight) * 0.5,
    readoutIndex: Math.floor(rows * 0.5) * columns + columns - 1,
  };
}

export function subdivisionCentersForGridCell(layout, index, level) {
  const cellCount = layout.columns * layout.rows;
  if (!Number.isInteger(index) || index < 0 || index >= cellCount) {
    throw new RangeError(`Cell index ${index} is outside a grid of ${cellCount} cells.`);
  }
  if (
    !Number.isInteger(level)
    || level < EMPTY_GRID_FACE_LEVEL
    || level > MAX_GRID_FACE_LEVEL
  ) {
    throw new RangeError(
      `Cell level must be between ${EMPTY_GRID_FACE_LEVEL} and ${MAX_GRID_FACE_LEVEL}.`,
    );
  }
  if (level === EMPTY_GRID_FACE_LEVEL) return [];

  const subdivisions = 1 << level;
  const slot = layout.cellSize / subdivisions;
  const row = Math.floor(index / layout.columns);
  const column = index % layout.columns;
  const left = layout.offsetX + column * layout.cellSize;
  const top = layout.offsetY + row * layout.cellSize;
  const centers = [];
  for (let subRow = 0; subRow < subdivisions; subRow += 1) {
    for (let subColumn = 0; subColumn < subdivisions; subColumn += 1) {
      centers.push({
        x: left + (subColumn + 0.5) * slot,
        y: top + (subRow + 0.5) * slot,
      });
    }
  }
  return centers;
}

export function countTransitionOpacitiesAt(progress, hasPrevious = true) {
  const value = clamp01(progress);
  if (!hasPrevious) {
    return {
      previous: 0,
      current: smoothstep(0.5, 1, value),
    };
  }
  if (value < 0.5) {
    return {
      previous: 1 - smoothstep(0, 0.5, value),
      current: 0,
    };
  }
  return {
    previous: 0,
    current: smoothstep(0.5, 1, value),
  };
}

export const flipFaceOpacitiesAt = countTransitionOpacitiesAt;

function transitionSourceFace(previousFace, currentFace, progress) {
  const hasPrevious = previousFace?.level >= 0;
  const opacity = countTransitionOpacitiesAt(progress, hasPrevious);
  if (opacity.current >= opacity.previous) return currentFace;
  return previousFace;
}

export class CircleGridSceneGenerator {
  constructor({
    name,
    definition = {},
    settingsKey = null,
    options,
    settings,
    runtime,
    palettes,
    cellTransitionTypes,
    sceneTransitionTypes,
  }, specification) {
    if (!runtime || typeof runtime.viewport !== "function") {
      throw new TypeError("Circle-grid scene generator requires runtime.viewport().");
    }
    if (
      !specification
      || typeof specification.type !== "string"
      || !Array.isArray(specification.strategies)
      || typeof specification.createScene !== "function"
    ) {
      throw new TypeError(
        "Circle-grid scene generator requires a type, strategies, and createScene().",
      );
    }
    const strategy = definition.strategy
      ?? options?.strategy
      ?? specification.defaultStrategy;
    this.specification = specification;
    this.generatorInstanceId = name ?? null;
    this.settingsKey = settingsKey
      ?? definition.settingsKey
      ?? (typeof definition.options === "string" ? definition.options : null);
    this.options = normalizeCircleGridSceneOptions(
      { ...options, strategy },
      specification,
    );
    this.runtime = runtime;
    const palette = paletteByName(palettes, this.options.palette);
    this.paletteColors = palette.map(rgbColorFromHex);
    const noise = typeof runtime.p5?.noise === "function"
      ? runtime.p5.noise.bind(runtime.p5)
      : undefined;
    this.flicker = createFlicker({
      palette,
      settings: this.options.flicker,
      noiseFunction: noise,
      autoCycleSeconds: this.options.autoFlickerCycleSeconds,
    });
    const lifecycleTransitionRegistry = sceneTransitionTypes
      ?? createSceneTransitionModeRegistry();
    const stateTransitionRegistry = cellTransitionTypes
      ?? createCellTransitionModeRegistry();
    this.cellTransition = new CellStateTransition({
      settings: this.options.cellTransitions,
      modeRegistry: stateTransitionRegistry,
    });
    this.intro = new SceneTransition({
      direction: "intro",
      settings: this.options.intro,
      modeRegistry: lifecycleTransitionRegistry,
    });
    this.outro = new SceneTransition({
      direction: "outro",
      settings: this.options.outro,
      modeRegistry: lifecycleTransitionRegistry,
    });
    this.compositionEndpoints = resolveCompositionEndpointSettings(
      settings?.composition ?? {},
      this.options.circleEndpoints ?? {},
    );
    this.circleEndpoint = new NativeCircleEndpointTransition({
      settings: nativeCircleEndpointSettings(this.compositionEndpoints),
      intro: this.options.intro,
      outro: this.options.outro,
      modeRegistry: lifecycleTransitionRegistry,
    });
    this.endCompositionEndpoint = createCompositionEndpointMode(
      this.compositionEndpoints.end,
      this.compositionEndpoints.modes,
    );
    this.circleEndpointActive = false;
    this.compositionEndpoint = null;
    this.paletteIndexScratch = new Uint16Array(
      1 << (MAX_GRID_FACE_LEVEL * 2),
    );
    this.noiseSampleScratch = new Float32Array(this.paletteIndexScratch.length);
    this.noiseOrderScratch = Array.from(
      { length: this.paletteIndexScratch.length },
      (_, index) => index,
    );
    this.usedPaletteIndices = new Uint8Array(
      this.flicker.paletteColors.length,
    );
    this.paletteMotionTime = 0;
    this.paletteMotionAmount = 0;
    this.timelineElapsed = 0;
    this.elapsed = 0;
    this.cycleIndex = 0;
    this.cycleProgress = 0;
    this.pendingSceneTransition = null;
    this.scenePresentationTransition = null;
    this.circleEndpoint.reset();
    this.endCompositionEndpoint?.reset();
    this.circleEndpointActive = false;
    this.scene = null;
    this.active = false;
    this.disposed = false;
    this.resize(runtime.viewport());
  }

  resize(viewport) {
    if (this.disposed) return;
    this.layout = createCircleGridSceneLayout(viewport, this.options.longSideCells);
    this.flicker.resize(this.flickerGrid());
    const count = this.layout.columns * this.layout.rows;
    this.currentFaces = Array.from({ length: count }, () => emptyGridFace());
    this.previousFaces = Array.from({ length: count }, () => emptyGridFace());
    this.faceSignatures = new Array(count).fill("empty");
    this.flipProgress = new Float32Array(count);
    this.flipProgress.fill(1);
    this.levels = new Int8Array(count);
    this.levels.fill(EMPTY_GRID_FACE_LEVEL);
    this.paletteValues = new Float32Array(count);
    this.paletteSteps = new Uint8Array(count);
    this.paletteMotionMask = new Uint8Array(count);
    this.paletteMotionAmount = 0;
    this.scene = null;
    this.cellTransition.reset();
    this.intro.reset();
    this.outro.reset();
    this.pendingSceneTransition = null;
    this.scenePresentationTransition = null;
    this.circleEndpoint.reset();
    this.endCompositionEndpoint?.reset();
    this.circleEndpointActive = false;
  }

  enter() {
    if (this.disposed) throw new Error("Circle-grid scene generator has been disposed.");
    this.active = true;
    this.timelineElapsed = 0;
    this.elapsed = 0;
    this.cycleIndex = 0;
    this.cycleProgress = 0;
    this.currentFaces.fill(emptyGridFace());
    this.previousFaces.fill(emptyGridFace());
    this.faceSignatures.fill("empty");
    this.flipProgress.fill(1);
    this.levels.fill(EMPTY_GRID_FACE_LEVEL);
    this.paletteValues.fill(0);
    this.paletteSteps.fill(0);
    this.paletteMotionTime = 0;
    this.paletteMotionAmount = 0;
    this.paletteMotionMask.fill(0);
    this.scene = null;
    this.cellTransition.reset();
    this.intro.reset();
    this.outro.reset();
    this.pendingSceneTransition = null;
    this.scenePresentationTransition = null;
    this.circleEndpoint.reset();
    this.endCompositionEndpoint?.reset();
    this.circleEndpointActive = false;
    this.compositionEndpoint = null;
  }

  exit() {
    this.active = false;
  }

  syncCycleClock() {
    const cyclePosition = this.elapsed / this.options.cycleSeconds;
    this.cycleIndex = Math.floor(cyclePosition);
    this.cycleProgress = cyclePosition - this.cycleIndex;
  }

  sceneOptions() {
    const projectSeed = Number(this.runtime.projectSeed?.());
    if (
      !Number.isInteger(projectSeed)
      || projectSeed < 0
      || projectSeed > 0xffffffff
    ) return this.options;
    return { ...this.options, projectSeed: projectSeed >>> 0 };
  }

  createSceneAtCurrentTime() {
    return this.specification.createScene({
      strategy: this.options.strategy,
      layout: this.layout,
      cycleIndex: this.cycleIndex,
      progress: this.cycleProgress,
      options: this.sceneOptions(),
    });
  }

  glyphId(cellIndex, glyphIndex) {
    return `${cellIndex}:${glyphIndex}`;
  }

  introItemsForFaces(faces) {
    const items = [];
    faces.forEach((face, cellIndex) => {
      if (face.level < 0) return;
      const subdivisions = 1 << face.level;
      const size = this.layout.cellSize / subdivisions;
      subdivisionCentersForGridCell(this.layout, cellIndex, face.level)
        .forEach((center, glyphIndex) => {
          if (!faceShowsGlyph(face, glyphIndex)) return;
          items.push({
            id: this.glyphId(cellIndex, glyphIndex),
            x: center.x,
            y: center.y,
            size,
          });
        });
    });
    return items;
  }

  beginTransition(transition, scene, fromItems = null) {
    const event = {
      items: this.introItemsForFaces(scene.faces),
      layout: this.layout,
      key: `${scene.key}:${this.layout.columns}x${this.layout.rows}`,
    };
    if (Array.isArray(fromItems)) event.fromItems = fromItems;
    return transition.begin(event);
  }

  beginIntro(scene, fromItems = null) {
    this.cellTransition.reset();
    return this.beginTransition(this.intro, scene, fromItems);
  }

  beginCellTransition(scene, fromItems) {
    return this.beginTransition(this.cellTransition, scene, fromItems);
  }

  beginOutro(scene) {
    this.cellTransition.reset();
    return this.outro.begin({
      items: this.introItemsForFaces(scene.faces),
      layout: this.layout,
      key: `${scene.key}:${this.layout.columns}x${this.layout.rows}`,
    });
  }

  advanceFlipProgress(dt) {
    if (dt <= 0) return;
    for (let index = 0; index < this.flipProgress.length; index += 1) {
      this.flipProgress[index] = Math.min(
        1,
        this.flipProgress[index] + dt / this.options.flipSeconds,
      );
    }
  }

  applyPaletteMotion(scene) {
    this.paletteMotionMask.fill(0);
    if (this.flicker.enabled && scene.paletteMotion) {
      for (const index of scene.paletteMotion.indices) {
        if (index >= 0 && index < this.paletteMotionMask.length) {
          this.paletteMotionMask[index] = 1;
        }
      }
      this.paletteMotionAmount = clamp01(scene.paletteMotion.amount);
    } else {
      this.paletteMotionAmount = 0;
    }
  }

  applyScene(nextScene, faceDt, transition = null, sourceItems = null) {
    const sceneChanged = nextScene.key !== this.scene?.key;
    // The circle endpoint is an arrangement too, applied at draw time instead of
    // through a SceneTransition. While its intro runs the core clock is paused,
    // so a native flip hinge started here would freeze half-open and draw
    // nothing for the whole phase — REFACTOR_PLAN.md §1.3, finding 1.
    const withArrangement = transition !== null
      || this.compositionEndpoint?.phase === "start";
    const withCut = nextScene.transitionStyle === "cut";
    if (sceneChanged && withCut) {
      this.cellTransition.reset();
      debug.transition(
        "scene=cut strategy=%s key=%s",
        this.options.strategy,
        nextScene.key,
      );
    }
    for (let index = 0; index < this.currentFaces.length; index += 1) {
      const targetFace = nextScene.faces[index];
      const targetSignature = gridFaceSignature(targetFace);
      if (targetSignature !== this.faceSignatures[index]) {
        if (withCut || (withArrangement && targetFace.level >= 0)) {
          // The arrangement transition owns incoming motion, so the native
          // blank hinge does not run concurrently with it.
          this.previousFaces[index] = emptyGridFace();
          this.flipProgress[index] = 1;
        } else {
          this.previousFaces[index] = transitionSourceFace(
            this.previousFaces[index],
            this.currentFaces[index],
            this.flipProgress[index],
          );
          this.flipProgress[index] = 0.5;
        }
        this.currentFaces[index] = targetFace;
        this.faceSignatures[index] = targetSignature;
      } else {
        this.flipProgress[index] = Math.min(
          1,
          this.flipProgress[index] + faceDt / this.options.flipSeconds,
        );
      }
      this.levels[index] = targetFace.level;
      this.paletteSteps[index] = targetFace.paletteStep;
      this.paletteValues[index] = targetFace.paletteStep
        / (GRID_FACE_PALETTE_STEP_COUNT - 1);
    }
    this.applyPaletteMotion(nextScene);
    this.scene = nextScene;
    if (transition !== null || sceneChanged) {
      this.scenePresentationTransition = transition;
    }
    if (transition === this.intro) this.beginIntro(nextScene, sourceItems);
    if (transition === this.cellTransition) {
      this.beginCellTransition(nextScene, sourceItems ?? []);
    }
  }

  transitionAtElapsed(elapsed) {
    const cyclePosition = elapsed / this.options.cycleSeconds;
    const cycleIndex = Math.floor(cyclePosition);
    const cycleProgress = cyclePosition - cycleIndex;
    const scene = this.specification.createScene({
      strategy: this.options.strategy,
      layout: this.layout,
      cycleIndex,
      progress: cycleProgress,
      options: this.sceneOptions(),
    });
    return { elapsed, cycleIndex, cycleProgress, scene };
  }

  shouldRunLifecycle(transition, eventType) {
    if (
      !transition.settings.enabled
      || (transition.direction === "outro" && transition.settings.fallbackToIntro)
      || this.compositionEndpointOwnsLifecycle(transition)
    ) return false;
    return eventType === "cycle";
  }

  compositionEndpointOwnsLifecycle(transition) {
    const direction = transition.direction === "intro" ? "start" : "end";
    return this.compositionEndpoints[direction]?.enabled === true;
  }

  shouldRunCellTransition(eventType, sceneChanged, scene) {
    return this.cellTransition.settings.enabled
      && eventType === "state"
      && sceneChanged
      && scene?.transitionStyle !== "cut";
  }

  queueSceneTransition(target, faceDt, eventType) {
    this.pendingSceneTransition = { ...target, faceDt, eventType };
    this.beginOutro(this.scene);
  }

  commitPendingScene() {
    const pending = this.pendingSceneTransition;
    if (!pending) return;
    this.pendingSceneTransition = null;
    this.elapsed = pending.elapsed;
    this.cycleIndex = pending.cycleIndex;
    this.cycleProgress = pending.cycleProgress;
    const withIntro = this.shouldRunLifecycle(this.intro, pending.eventType);
    this.applyScene(
      pending.scene,
      pending.faceDt,
      withIntro ? this.intro : null,
      null,
    );
  }

  consumeTimeline(dt) {
    let remaining = dt;
    if (this.outro.active) {
      remaining = this.outro.update(remaining);
      if (this.outro.active) return;
      this.commitPendingScene();
    }
    if (this.intro.active) {
      const afterIntro = this.intro.update(remaining);
      this.advanceFlipProgress(remaining - afterIntro);
      remaining = afterIntro;
      if (this.intro.active) return;
    }
    if (remaining > 0) this.advanceCycle(remaining);
  }

  advanceCycle(dt) {
    if (dt <= 0) return;
    const cycleSeconds = this.options.cycleSeconds;
    const cycleTransition = this.shouldRunLifecycle(this.intro, "cycle")
      || this.shouldRunLifecycle(this.outro, "cycle");
    const nextBoundary = (this.cycleIndex + 1) * cycleSeconds;
    const secondsToBoundary = Math.max(0, nextBoundary - this.elapsed);

    if (cycleTransition && this.scene !== null && dt >= secondsToBoundary) {
      this.cellTransition.update(secondsToBoundary);
      const target = this.transitionAtElapsed(nextBoundary);
      if (this.shouldRunLifecycle(this.outro, "cycle")) {
        this.queueSceneTransition(target, secondsToBoundary, "cycle");
        this.consumeTimeline(dt - secondsToBoundary);
      } else {
        this.elapsed = target.elapsed;
        this.cycleIndex = target.cycleIndex;
        this.cycleProgress = target.cycleProgress;
        const withIntro = this.shouldRunLifecycle(this.intro, "cycle");
        const introSourceItems = withIntro
          ? this.introItemsForFaces(this.currentFaces)
          : null;
        this.applyScene(
          target.scene,
          secondsToBoundary,
          withIntro ? this.intro : null,
          introSourceItems,
        );
        this.consumeTimeline(dt - secondsToBoundary);
      }
      return;
    }

    this.cellTransition.update(dt);
    const target = this.transitionAtElapsed(this.elapsed + dt);
    const sceneChanged = target.scene.key !== this.scene?.key;
    const eventType = target.cycleIndex !== this.cycleIndex ? "cycle" : "state";
    if (this.shouldRunLifecycle(this.outro, eventType)) {
      this.queueSceneTransition(target, dt, eventType);
      return;
    }
    this.elapsed = target.elapsed;
    this.cycleIndex = target.cycleIndex;
    this.cycleProgress = target.cycleProgress;
    const withIntro = this.shouldRunLifecycle(this.intro, eventType);
    const withCellTransition = this.shouldRunCellTransition(
      eventType,
      sceneChanged,
      target.scene,
    );
    const sourceItems = withIntro || withCellTransition
      ? this.introItemsForFaces(this.currentFaces)
      : null;
    this.applyScene(
      target.scene,
      dt,
      withIntro
        ? this.intro
        : (withCellTransition ? this.cellTransition : null),
      sourceItems,
    );
  }

  update(frame = {}) {
    if (this.disposed) throw new Error("Circle-grid scene generator has been disposed.");
    const dtSource = Number.isFinite(frame.compositionDt)
      ? frame.compositionDt
      : frame.dt;
    const dt = Number.isFinite(dtSource) ? Math.max(0, dtSource) : 0;
    this.compositionEndpoint = frame.compositionEndpoint ?? null;
    this.timelineElapsed += dt;
    if (this.scene === null) {
      if (this.intro.settings.enabled && this.compositionEndpoint?.phase !== "start") {
        this.syncCycleClock();
        const initialScene = this.createSceneAtCurrentTime();
        this.applyScene(initialScene, 0, this.intro, null);
        this.consumeTimeline(dt);
      } else {
        this.elapsed += dt;
        this.syncCycleClock();
        this.applyScene(this.createSceneAtCurrentTime(), 0, null);
      }
    } else {
      this.consumeTimeline(dt);
    }
    this.flicker.beginFrame({
      time: this.elapsed,
      progress: this.cycleProgress,
      cycleIndex: this.cycleIndex,
    });
  }

  seek(time) {
    if (!Number.isFinite(time) || time < 0) return false;
    this.enter();
    const frame = (dt, frameTime) => ({
      dt,
      compositionDt: dt,
      time: frameTime,
      viewport: this.runtime.viewport(),
      pointer: { active: false, x: 0, y: 0 },
    });
    this.update(frame(0, 0));
    const step = 1 / 60;
    const tolerance = Number.EPSILON * Math.max(1, time) * 16;
    while (this.timelineElapsed + step < time - tolerance) {
      this.update(frame(step, this.timelineElapsed + step));
    }
    const remainder = time - this.timelineElapsed;
    if (remainder > tolerance) this.update(frame(remainder, time));
    return true;
  }

  draw(frame, planEntry, context) {
    const customEndpoint = frame?.compositionEndpoint?.phase === "end"
      ? this.endCompositionEndpoint
      : null;
    const endpointPreparationProgress = this.scene?.endpointPreparationProgress;
    const preparingEndpoint = frame?.compositionEndpoint == null
      && Number.isFinite(endpointPreparationProgress)
      && typeof this.endCompositionEndpoint?.preparationFrameAt === "function"
      ? this.endCompositionEndpoint
      : null;
    this.paletteMotionTime = customEndpoint
      ? this.elapsed + frame.compositionEndpoint.progress
        * frame.compositionEndpoint.durationSeconds
      : Number.isFinite(frame?.time)
      ? frame.time
      : this.timelineElapsed;
    if (customEndpoint) {
      const endpointFrame = customEndpoint.frameAt({
        layout: this.layout,
        scene: this.scene,
        cycleIndex: frame.compositionEndpoint.cycleIndex,
        progress: frame.compositionEndpoint.progress,
      });
      this.drawCompositionEndpointFrame(context, endpointFrame);
      return;
    }
    if (preparingEndpoint) {
      const endpointFrame = preparingEndpoint.preparationFrameAt({
        layout: this.layout,
        scene: this.scene,
        cycleIndex: this.cycleIndex,
        progress: endpointPreparationProgress,
      });
      this.drawCompositionEndpointFrame(context, endpointFrame);
      return;
    }
    this.circleEndpointActive = this.circleEndpoint.prepare(
      frame?.compositionEndpoint,
      this.introItemsForFaces(this.currentFaces),
      this.layout,
    );
    for (let index = 0; index < this.currentFaces.length; index += 1) {
      const previousFace = this.previousFaces[index];
      const currentFace = this.currentFaces[index];
      const opacity = countTransitionOpacitiesAt(
        this.flipProgress[index],
        previousFace.level >= 0,
      );
      if (previousFace.level >= 0 && opacity.previous > 0) {
        this.drawFace(context, index, previousFace, opacity.previous, false);
      }
      if (currentFace.level >= 0 && opacity.current > 0) {
        this.drawFace(context, index, currentFace, opacity.current, true);
      }
    }
  }

  drawCompositionEndpointFrame(context, endpointFrame) {
    const finestSubdivisions = 1 << MAX_GRID_FACE_LEVEL;
    const basePosition = endpointFrame.paletteStep
      / (GRID_FACE_PALETTE_STEP_COUNT - 1);
    drawEndpointFrame(context, endpointFrame, {
      dotMargin: this.options.dotMargin,
      colorForGlyph: ({
        cellColumn,
        cellRow,
        glyphColumn,
        glyphRow,
        subdivisions,
        paletteStep,
      }) => {
        if (endpointFrame.flicker && this.flicker.enabled) {
          // Same coordinate convention as flickerOriginX/Y: canvas scope
          // addresses the whole board in finest-subdivision units, cell scope
          // drops the parent offset. Mixing parent-cell units in here samples
          // the field at a different spatial scale than the scene draw does.
          const coordinateStep = finestSubdivisions / subdivisions;
          const localX = (glyphColumn + 0.5) * coordinateStep;
          const localY = (glyphRow + 0.5) * coordinateStep;
          const sampleX = this.flicker.scope === "cell"
            ? localX
            : cellColumn * finestSubdivisions + localX;
          const sampleY = this.flicker.scope === "cell"
            ? localY
            : cellRow * finestSubdivisions + localY;
          const sample = this.flicker.sampleAt(
            sampleX,
            sampleY,
            this.paletteMotionTime,
          );
          return this.flicker.paletteColors[this.flickerSwatchIndex(
            basePosition,
            sample,
            endpointFrame.flickerAmount * this.flicker.amount,
          )];
        }
        return this.paletteColorStep(paletteStep);
      },
    });
  }

  glyphPresentations(cellIndex, glyphIndex, withTransition) {
    const id = this.glyphId(cellIndex, glyphIndex);
    if (this.circleEndpointActive) return this.circleEndpoint.presentationsFor(id);
    if (!withTransition) return [IDENTITY_PRESENTATION];
    const transition = this.outro.active
      ? this.outro
      : this.scenePresentationTransition;
    return transition?.presentationsFor(id) ?? [IDENTITY_PRESENTATION];
  }

  drawPresentedGlyph(context, centerX, centerY, radius, presentation, alpha) {
    const opacity = Number.isFinite(presentation?.opacity)
      ? clamp01(presentation.opacity)
      : 1;
    const scale = Number.isFinite(presentation?.scale) ? presentation.scale : 1;
    const x = centerX + (Number(presentation?.offsetX) || 0);
    const y = centerY + (Number(presentation?.offsetY) || 0);
    const glyphRadius = radius * Math.max(0, scale);
    if (opacity <= 0 || glyphRadius <= 0) return;

    context.save();
    context.globalAlpha = alpha * opacity;
    context.beginPath();
    context.moveTo(x + glyphRadius, y);
    context.arc(x, y, glyphRadius, 0, CIRCLE_TAU);
    context.fill();
    context.restore();
  }

  drawFace(context, index, face, opacity, withIntro = false) {
    if (opacity <= 0 || face.level < 0) return;
    if (Array.isArray(face.detail?.paletteSteps)) {
      this.drawPerGlyphPalette(context, index, face, opacity, withIntro);
      return;
    }

    const subdivisions = 1 << face.level;
    const radius = this.layout.cellSize
      / subdivisions
      * 0.5
      * (1 - this.options.dotMargin);
    const hasPaletteMotion = (
      this.flicker.enabled
      && this.paletteMotionAmount > 0
      && this.paletteMotionMask[index] === 1
    );
    context.save();
    context.globalAlpha *= clamp01(opacity);
    if (context.globalAlpha <= 0) {
      context.restore();
      return;
    }
    if (hasPaletteMotion) {
      this.drawPaletteMotionFace(
        context,
        index,
        face,
        subdivisions,
        radius,
        withIntro,
      );
      context.restore();
      return;
    }
    const centers = subdivisionCentersForGridCell(
      this.layout,
      index,
      face.level,
    );
    context.fillStyle = this.paletteColorStep(face.paletteStep);
    const inheritedAlpha = context.globalAlpha;
    centers.forEach((center, glyphIndex) => {
      if (!faceShowsGlyph(face, glyphIndex)) return;
      for (const presentation of this.glyphPresentations(index, glyphIndex, withIntro)) {
        this.drawPresentedGlyph(
          context,
          center.x,
          center.y,
          radius,
          presentation,
          inheritedAlpha,
        );
      }
    });
    context.restore();
  }

  drawPaletteMotionFace(
    context,
    index,
    face,
    subdivisions,
    radius,
    withIntro = false,
  ) {
    const paletteIndex = Math.round(
      face.paletteStep / (GRID_FACE_PALETTE_STEP_COUNT - 1)
      * (this.paletteColors.length - 1),
    );
    const basePosition = paletteIndex / Math.max(1, this.paletteColors.length - 1);
    const amount = this.paletteMotionAmount * this.flicker.amount;
    const finestSubdivisions = 1 << MAX_GRID_FACE_LEVEL;
    const coordinateStep = finestSubdivisions / subdivisions;
    const parentColumn = index % this.layout.columns;
    const parentRow = Math.floor(index / this.layout.columns);
    const noiseBaseX = this.flickerOriginX(index, coordinateStep);
    const noiseBaseY = this.flickerOriginY(index, coordinateStep);
    const slot = this.layout.cellSize / subdivisions;
    const left = this.layout.offsetX + parentColumn * this.layout.cellSize;
    const top = this.layout.offsetY + parentRow * this.layout.cellSize;
    const glyphCount = subdivisions * subdivisions;
    const paletteByGlyph = this.paletteIndexScratch;
    const noiseByGlyph = this.noiseSampleScratch;
    const noiseOrder = this.noiseOrderScratch;
    const usedPaletteIndices = this.usedPaletteIndices;
    const inheritedAlpha = context.globalAlpha;
    usedPaletteIndices.fill(0);
    const flickerTime = this.flickerTimeFor(index);

    for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex += 1) {
      const glyphColumn = glyphIndex % subdivisions;
      const glyphRow = Math.floor(glyphIndex / subdivisions);
      noiseByGlyph[glyphIndex] = this.flicker.sampleAt(
        noiseBaseX + glyphColumn * coordinateStep,
        noiseBaseY + glyphRow * coordinateStep,
        flickerTime,
      );
      noiseOrder[glyphIndex] = glyphIndex;
    }

    const paletteCount = this.flicker.paletteColors.length;
    // Cell scope may spread a cell's dots evenly across the palette by sample
    // order, which fields with no meaningful absolute level (noise) need to use
    // the whole palette. Canvas scope never does — see
    // FlickerController.spreadsRankAcrossCell — so a board-wide pattern keeps
    // showing each cell only its own slice.
    const useRankSpread = this.flicker.spreadsRankAcrossCell(glyphCount);
    if (useRankSpread) {
      noiseOrder.length = glyphCount;
      noiseOrder.sort((first, second) => (
        noiseByGlyph[first] - noiseByGlyph[second] || first - second
      ));
    }
    for (let rank = 0; rank < glyphCount; rank += 1) {
      const glyphIndex = useRankSpread ? noiseOrder[rank] : rank;
      const swatchIndex = useRankSpread
        ? this.flicker.paletteIndexFromSample(
          basePosition,
          Math.min(paletteCount - 1, Math.floor(rank * paletteCount / glyphCount))
            / Math.max(1, paletteCount - 1),
          amount,
        )
        : this.flickerSwatchIndex(basePosition, noiseByGlyph[glyphIndex], amount);
      paletteByGlyph[glyphIndex] = swatchIndex;
      usedPaletteIndices[swatchIndex] = 1;
    }

    for (
      let swatchIndex = 0;
      swatchIndex < usedPaletteIndices.length;
      swatchIndex += 1
    ) {
      if (usedPaletteIndices[swatchIndex] === 0) continue;
      context.fillStyle = this.flicker.paletteColors[swatchIndex];
      for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex += 1) {
        if (paletteByGlyph[glyphIndex] !== swatchIndex) continue;
        const glyphColumn = glyphIndex % subdivisions;
        const glyphRow = Math.floor(glyphIndex / subdivisions);
        for (const presentation of this.glyphPresentations(index, glyphIndex, withIntro)) {
          this.drawPresentedGlyph(
            context,
            left + (glyphColumn + 0.5) * slot,
            top + (glyphRow + 0.5) * slot,
            radius,
            presentation,
            inheritedAlpha,
          );
        }
      }
    }
  }

  drawPerGlyphPalette(context, index, face, opacity, withIntro = false) {
    const centers = subdivisionCentersForGridCell(
      this.layout,
      index,
      face.level,
    );
    const subdivisions = 1 << face.level;
    const radius = this.layout.cellSize
      / subdivisions
      * 0.5
      * (1 - this.options.dotMargin);
    const { paletteSteps } = face.detail;
    if (paletteSteps.length !== centers.length) {
      throw new RangeError(
        `Per-glyph palette needs ${centers.length} steps; received ${paletteSteps.length}.`,
      );
    }

    context.save();
    context.globalAlpha *= clamp01(opacity);
    if (context.globalAlpha <= 0) {
      context.restore();
      return;
    }
    const motion = face.detail.paletteMotion;
    const motionProgress = motion
      ? clamp01(
        (this.cycleProgress - motion.startProgress)
        / Math.max(Number.EPSILON, motion.endProgress - motion.startProgress),
      )
      : 0;
    const inheritedAlpha = context.globalAlpha;
    centers.forEach((center, candidateIndex) => {
      const baseStep = paletteSteps[candidateIndex];
      const activation = this.flicker.enabled && motion
        ? candidateFlickerAmountAt({
          candidateIndex,
          selectedIndex: motion.selectedIndex,
          candidateCount: motion.candidateCount,
          progress: motionProgress,
          leadFraction: motion.leadFraction,
          spreadFraction: motion.spreadFraction,
          rampFraction: motion.rampFraction,
        })
        : 0;
      if (activation > 0) {
        const glyphColumn = candidateIndex % subdivisions;
        const glyphRow = Math.floor(candidateIndex / subdivisions);
        const sample = this.flicker.sampleAt(
          this.flickerOriginX(index, 0) + glyphColumn,
          this.flickerOriginY(index, 0) + glyphRow,
          this.flickerTimeFor(index),
        );
        const paletteIndex = Math.round(
          baseStep / (GRID_FACE_PALETTE_STEP_COUNT - 1)
          * (this.paletteColors.length - 1),
        );
        context.fillStyle = this.flicker.paletteColors[this.flickerSwatchIndex(
          paletteIndex / Math.max(1, this.paletteColors.length - 1),
          sample,
          activation * this.flicker.amount,
        )];
      } else {
        context.fillStyle = this.paletteColorStep(baseStep);
      }
      for (const presentation of this.glyphPresentations(index, candidateIndex, withIntro)) {
        this.drawPresentedGlyph(
          context,
          center.x,
          center.y,
          radius,
          presentation,
          inheritedAlpha,
        );
      }
    });
    context.restore();
  }

  // A "level" field's sample is a brightness, so it maps straight onto the
  // palette. Every other field's sample is banded first, which keeps a
  // continuous signal visiting whole swatches instead of hovering mid-palette.
  flickerSwatchIndex(basePosition, sample, amount) {
    return this.flicker.distribution === "level"
      ? this.flicker.paletteIndexFromSample(basePosition, sample, amount)
      : this.flicker.paletteIndexFromNoise(basePosition, sample, amount);
  }

  paletteColorStep(step) {
    const normalized = clamp01(step / (GRID_FACE_PALETTE_STEP_COUNT - 1));
    const index = Math.round(normalized * (this.paletteColors.length - 1));
    return this.paletteColors[index];
  }

  contentBounds() {
    return {
      x: this.layout.offsetX,
      y: this.layout.offsetY,
      width: this.layout.patternWidth,
      height: this.layout.patternHeight,
    };
  }

  animationDuration() {
    return this.options.cycleSeconds
      + this.transitionEventsPerCycle(this.intro) * this.intro.settings.durationSeconds
      + this.transitionEventsPerCycle(this.outro) * this.outro.settings.durationSeconds;
  }

  transitionEventsPerCycle(transition) {
    if (
      !transition.settings.enabled
      || (transition.direction === "outro" && transition.settings.fallbackToIntro)
      || this.compositionEndpointOwnsLifecycle(transition)
    ) return 0;
    return 1;
  }

  // Pattern-based flicker fields need the grid extent to place a sweep, ripple,
  // or route; noise ignores it. Cell scope hands the field a one-cell board, so
  // the same pattern fits inside every cell instead of spanning the canvas.
  flickerGrid() {
    const dotsPerCellAxis = 1 << MAX_GRID_FACE_LEVEL;
    if (this.flicker.scope === "cell") {
      return {
        columns: 1,
        rows: 1,
        cellSize: this.layout.cellSize,
        dotsPerCellAxis,
      };
    }
    return {
      columns: this.layout.columns,
      rows: this.layout.rows,
      cellSize: this.layout.cellSize,
      dotsPerCellAxis,
    };
  }

  // The dot coordinates handed to sampleAt. Canvas scope addresses the whole
  // board in finest-subdivision units; cell scope drops the parent offset so
  // every cell reads the same local field.
  flickerOriginX(index, coordinateStep) {
    const half = coordinateStep * 0.5;
    if (this.flicker.scope === "cell") return half;
    return (index % this.layout.columns) * (1 << MAX_GRID_FACE_LEVEL) + half;
  }

  flickerOriginY(index, coordinateStep) {
    const half = coordinateStep * 0.5;
    if (this.flicker.scope === "cell") return half;
    return Math.floor(index / this.layout.columns) * (1 << MAX_GRID_FACE_LEVEL)
      + half;
  }

  // Under cell scope every cell reads the same local field, so they would pulse
  // in unison. Each cell's clock is pushed forward by a fixed slice of the
  // configured stagger, keyed on its position so the offset never drifts.
  flickerTimeFor(index) {
    if (this.flicker.scope !== "cell") return this.paletteMotionTime;
    const stagger = this.flicker.cellStaggerSeconds;
    if (stagger === 0) return this.paletteMotionTime;
    return this.paletteMotionTime + hashUnit(index, this.layout.columns, 977) * stagger;
  }

  /**
   * Swap the active flicker mode while the composition runs. Settings for every
   * registered mode were resolved when this generator was built, so the swap
   * cannot fail on authored values.
   */
  useFlickerMode(name) {
    this.flicker.useMode(name);
    this.flicker.resize(this.flickerGrid());
    return this;
  }

  availableFlickerModes() {
    return this.flicker.availableModes();
  }

  inspect() {
    const scene = this.scene ?? {};
    const { faces, key, ...sceneMetadata } = scene;
    return {
      generatorInstanceId: this.generatorInstanceId,
      generatorType: this.specification.type,
      settingsKey: this.settingsKey,
      strategy: this.options.strategy,
      active: this.active,
      timelinePhase: this.outro.active
        ? "outro"
        : (this.intro.active ? "intro" : "cycle"),
      timelineElapsed: this.timelineElapsed,
      cycleElapsed: this.elapsed,
      phase: scene.phase ?? null,
      cycleIndex: this.cycleIndex,
      cycleProgress: this.cycleProgress,
      stepIndex: scene.stepIndex ?? 0,
      stepCount: this.options.stepCount,
      sceneKey: key ?? null,
      whitespaceCount: this.levels.reduce(
        (count, level) => count + (level < 0 ? 1 : 0),
        0,
      ),
      readout: {
        index: this.layout.readoutIndex,
        row: Math.floor(this.layout.readoutIndex / this.layout.columns),
        column: this.layout.readoutIndex % this.layout.columns,
      },
      layout: { ...this.layout },
      flicker: {
        enabled: this.flicker.enabled,
        mode: this.flicker.modeName,
        scope: this.flicker.scope,
        amount: this.flicker.amount,
      },
      intro: this.intro.inspect(),
      outro: this.outro.inspect(),
      cellTransition: this.cellTransition.inspect(),
      compositionEndpoint: this.endCompositionEndpoint?.inspect() ?? null,
      levels: this.levels,
      paletteValues: this.paletteValues,
      paletteSteps: this.paletteSteps,
      flipProgress: this.flipProgress,
      ...sceneMetadata,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.active = false;
    this.disposed = true;
    this.currentFaces = [];
    this.previousFaces = [];
    this.faceSignatures = [];
    this.flipProgress = new Float32Array(0);
    this.levels = new Int8Array(0);
    this.paletteValues = new Float32Array(0);
    this.paletteSteps = new Uint8Array(0);
    this.paletteMotionMask = new Uint8Array(0);
    this.paletteIndexScratch = new Uint16Array(0);
    this.noiseSampleScratch = new Float32Array(0);
    this.noiseOrderScratch = [];
    this.usedPaletteIndices = new Uint8Array(0);
    this.paletteMotionAmount = 0;
    this.scene = null;
    this.cellTransition.reset();
    this.intro.reset();
    this.outro.reset();
    this.circleEndpoint.reset();
    this.endCompositionEndpoint?.reset();
    this.pendingSceneTransition = null;
    this.scenePresentationTransition = null;
  }
}

export default CircleGridSceneGenerator;
