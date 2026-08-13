import {
  CIRCLE_TAU,
  EMPTY_GRID_FACE_LEVEL,
  GRID_FACE_PALETTE_STEP_COUNT,
  MAX_GRID_FACE_LEVEL,
  candidateFlickerAmountAt,
  emptyGridFace,
  gridFaceSignature,
  minimumSceneHoldFraction,
} from "./grid-scene-strategies.js";
import { OrganicPaletteMotion } from "../visuals/organic-palette-motion.js";

export const DEFAULT_CIRCLE_GRID_SCENE_OPTIONS = Object.freeze({
  longSideCells: 9,
  dotMargin: 0.14,
  palette: "green",
  cycleSeconds: 2.4,
  stepCount: 7,
  flipSeconds: 0.04,
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
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

export function normalizeCircleGridSceneOptions(options = {}, specification = {}) {
  const compatibilityFlipSeconds = options.flipSeconds === undefined
    ? options.countTransitionSeconds
    : undefined;
  const prepared = specification.normalizeOptions
    ? specification.normalizeOptions(options)
    : options;
  const strategy = prepared.strategy ?? specification.defaultStrategy;
  const normalized = {
    ...DEFAULT_CIRCLE_GRID_SCENE_OPTIONS,
    ...specification.defaults,
    ...prepared,
    strategy,
    cycleSeconds: prepared.cycleSeconds
      ?? prepared.tokenSeconds
      ?? specification.defaults?.cycleSeconds
      ?? DEFAULT_CIRCLE_GRID_SCENE_OPTIONS.cycleSeconds,
    stepCount: prepared.stepCount
      ?? prepared.layerPasses
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
  const cellSize = Math.max(width, height) / longCells;
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
    runtime,
    palettes,
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
    this.paletteMotion = new OrganicPaletteMotion(
      palette,
      this.options.candidateFlicker
        ?? this.options.layerFlicker
        ?? this.options.birthFlicker
        ?? this.options.highDensityFlicker
        ?? this.options.finalSnapshotFlicker
        ?? this.options.regionFlicker,
      noise,
    );
    this.paletteIndexScratch = new Uint16Array(
      1 << (MAX_GRID_FACE_LEVEL * 2),
    );
    this.noiseSampleScratch = new Float32Array(this.paletteIndexScratch.length);
    this.noiseOrderScratch = Array.from(
      { length: this.paletteIndexScratch.length },
      (_, index) => index,
    );
    this.usedPaletteIndices = new Uint8Array(
      this.paletteMotion.paletteColors.length,
    );
    this.paletteMotionTime = 0;
    this.paletteMotionAmount = 0;
    this.elapsed = 0;
    this.cycleIndex = 0;
    this.cycleProgress = 0;
    this.scene = null;
    this.active = false;
    this.disposed = false;
    this.resize(runtime.viewport());
  }

  resize(viewport) {
    if (this.disposed) return;
    this.layout = createCircleGridSceneLayout(viewport, this.options.longSideCells);
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
  }

  enter() {
    if (this.disposed) throw new Error("Circle-grid scene generator has been disposed.");
    this.active = true;
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
  }

  exit() {
    this.active = false;
  }

  update(frame = {}) {
    if (this.disposed) throw new Error("Circle-grid scene generator has been disposed.");
    const dtSource = Number.isFinite(frame.compositionDt)
      ? frame.compositionDt
      : frame.dt;
    const dt = Number.isFinite(dtSource) ? Math.max(0, dtSource) : 0;
    this.elapsed += dt;
    const cyclePosition = this.elapsed / this.options.cycleSeconds;
    this.cycleIndex = Math.floor(cyclePosition);
    this.cycleProgress = cyclePosition - this.cycleIndex;
    const nextScene = this.specification.createScene({
      strategy: this.options.strategy,
      layout: this.layout,
      cycleIndex: this.cycleIndex,
      progress: this.cycleProgress,
      options: this.options,
    });

    for (let index = 0; index < this.currentFaces.length; index += 1) {
      const targetFace = nextScene.faces[index];
      const targetSignature = gridFaceSignature(targetFace);
      if (targetSignature !== this.faceSignatures[index]) {
        this.previousFaces[index] = transitionSourceFace(
          this.previousFaces[index],
          this.currentFaces[index],
          this.flipProgress[index],
        );
        this.currentFaces[index] = targetFace;
        this.faceSignatures[index] = targetSignature;
        // Land on the blank hinge for the boundary frame. With a 16 ms face
        // time this guarantees one readable off-frame even when a 60 Hz frame
        // would otherwise skip directly from the old face to the new one.
        this.flipProgress[index] = 0.5;
      } else {
        this.flipProgress[index] = Math.min(
          1,
          this.flipProgress[index] + dt / this.options.flipSeconds,
        );
      }
      this.levels[index] = targetFace.level;
      this.paletteSteps[index] = targetFace.paletteStep;
      this.paletteValues[index] = targetFace.paletteStep
        / (GRID_FACE_PALETTE_STEP_COUNT - 1);
    }
    this.paletteMotionMask.fill(0);
    if (this.paletteMotion.enabled && nextScene.paletteMotion) {
      for (const index of nextScene.paletteMotion.indices) {
        if (index >= 0 && index < this.paletteMotionMask.length) {
          this.paletteMotionMask[index] = 1;
        }
      }
      this.paletteMotionAmount = clamp01(nextScene.paletteMotion.amount);
    } else {
      this.paletteMotionAmount = 0;
    }
    this.scene = nextScene;
  }

  seek(time) {
    if (!Number.isFinite(time) || time < 0) return false;
    this.enter();
    const cycleSeconds = this.options.cycleSeconds;
    const targetCycle = Math.floor(time / cycleSeconds);
    const startCycle = Math.max(0, targetCycle - 1);
    this.elapsed = startCycle * cycleSeconds;
    const frame = (dt, frameTime) => ({
      dt,
      compositionDt: dt,
      time: frameTime,
      viewport: this.runtime.viewport(),
      pointer: { active: false, x: 0, y: 0 },
    });
    this.update(frame(0, this.elapsed));
    const step = 1 / 60;
    const tolerance = Number.EPSILON * Math.max(1, time) * 16;
    while (this.elapsed + step < time - tolerance) {
      this.update(frame(step, this.elapsed + step));
    }
    const remainder = time - this.elapsed;
    if (remainder > tolerance) this.update(frame(remainder, time));
    return true;
  }

  draw(frame, planEntry, context) {
    this.paletteMotionTime = Number.isFinite(frame?.time) ? frame.time : this.elapsed;
    for (let index = 0; index < this.currentFaces.length; index += 1) {
      const previousFace = this.previousFaces[index];
      const currentFace = this.currentFaces[index];
      const opacity = countTransitionOpacitiesAt(
        this.flipProgress[index],
        previousFace.level >= 0,
      );
      if (previousFace.level >= 0 && opacity.previous > 0) {
        this.drawFace(context, index, previousFace, opacity.previous);
      }
      if (currentFace.level >= 0 && opacity.current > 0) {
        this.drawFace(context, index, currentFace, opacity.current);
      }
    }
  }

  drawFace(context, index, face, opacity) {
    if (opacity <= 0 || face.level < 0) return;
    if (Array.isArray(face.detail?.paletteSteps)) {
      this.drawPerGlyphPalette(context, index, face, opacity);
      return;
    }

    const subdivisions = 1 << face.level;
    const radius = this.layout.cellSize
      / subdivisions
      * 0.5
      * (1 - this.options.dotMargin);
    const hasPaletteMotion = (
      this.paletteMotion.enabled
      && this.paletteMotionAmount > 0
      && this.paletteMotionMask[index] === 1
    );
    context.save();
    context.globalAlpha *= clamp01(opacity);
    if (hasPaletteMotion) {
      this.drawPaletteMotionFace(
        context,
        index,
        face,
        subdivisions,
        radius,
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
    context.beginPath();
    for (const center of centers) {
      context.moveTo(center.x + radius, center.y);
      context.arc(center.x, center.y, radius, 0, CIRCLE_TAU);
    }
    context.fill();
    context.restore();
  }

  drawPaletteMotionFace(context, index, face, subdivisions, radius) {
    const paletteIndex = Math.round(
      face.paletteStep / (GRID_FACE_PALETTE_STEP_COUNT - 1)
      * (this.paletteColors.length - 1),
    );
    const basePosition = paletteIndex / Math.max(1, this.paletteColors.length - 1);
    const amount = this.paletteMotionAmount * this.paletteMotion.options.amount;
    const finestSubdivisions = 1 << MAX_GRID_FACE_LEVEL;
    const coordinateStep = finestSubdivisions / subdivisions;
    const parentColumn = index % this.layout.columns;
    const parentRow = Math.floor(index / this.layout.columns);
    const noiseBaseX = parentColumn * finestSubdivisions + coordinateStep * 0.5;
    const noiseBaseY = parentRow * finestSubdivisions + coordinateStep * 0.5;
    const slot = this.layout.cellSize / subdivisions;
    const left = this.layout.offsetX + parentColumn * this.layout.cellSize;
    const top = this.layout.offsetY + parentRow * this.layout.cellSize;
    const glyphCount = subdivisions * subdivisions;
    const paletteByGlyph = this.paletteIndexScratch;
    const noiseByGlyph = this.noiseSampleScratch;
    const noiseOrder = this.noiseOrderScratch;
    const usedPaletteIndices = this.usedPaletteIndices;
    usedPaletteIndices.fill(0);

    for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex += 1) {
      const glyphColumn = glyphIndex % subdivisions;
      const glyphRow = Math.floor(glyphIndex / subdivisions);
      noiseByGlyph[glyphIndex] = this.paletteMotion.sampleAt(
        noiseBaseX + glyphColumn * coordinateStep,
        noiseBaseY + glyphRow * coordinateStep,
        this.paletteMotionTime,
      );
      noiseOrder[glyphIndex] = glyphIndex;
    }

    noiseOrder.length = glyphCount;
    noiseOrder.sort((first, second) => (
      noiseByGlyph[first] - noiseByGlyph[second] || first - second
    ));
    const paletteCount = this.paletteMotion.paletteColors.length;
    for (let rank = 0; rank < glyphCount; rank += 1) {
      const glyphIndex = noiseOrder[rank];
      const swatchIndex = glyphCount >= paletteCount
        ? this.paletteMotion.paletteIndexFromSample(
          basePosition,
          Math.min(paletteCount - 1, Math.floor(rank * paletteCount / glyphCount))
            / Math.max(1, paletteCount - 1),
          amount,
        )
        : this.paletteMotion.paletteIndexFromNoise(
          basePosition,
          noiseByGlyph[glyphIndex],
          amount,
        );
      paletteByGlyph[glyphIndex] = swatchIndex;
      usedPaletteIndices[swatchIndex] = 1;
    }

    for (
      let swatchIndex = 0;
      swatchIndex < usedPaletteIndices.length;
      swatchIndex += 1
    ) {
      if (usedPaletteIndices[swatchIndex] === 0) continue;
      context.fillStyle = this.paletteMotion.paletteColors[swatchIndex];
      context.beginPath();
      for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex += 1) {
        if (paletteByGlyph[glyphIndex] !== swatchIndex) continue;
        const glyphColumn = glyphIndex % subdivisions;
        const glyphRow = Math.floor(glyphIndex / subdivisions);
        const centerX = left + (glyphColumn + 0.5) * slot;
        const centerY = top + (glyphRow + 0.5) * slot;
        context.moveTo(centerX + radius, centerY);
        context.arc(centerX, centerY, radius, 0, CIRCLE_TAU);
      }
      context.fill();
    }
  }

  drawPerGlyphPalette(context, index, face, opacity) {
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
    const motion = face.detail.paletteMotion;
    const motionProgress = motion
      ? clamp01(
        (this.cycleProgress - motion.startProgress)
        / Math.max(Number.EPSILON, motion.endProgress - motion.startProgress),
      )
      : 0;
    centers.forEach((center, candidateIndex) => {
      const baseStep = paletteSteps[candidateIndex];
      const activation = this.paletteMotion.enabled && motion
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
        const sample = this.paletteMotion.sampleAt(
          glyphColumn,
          glyphRow,
          this.paletteMotionTime,
        );
        const paletteIndex = Math.round(
          baseStep / (GRID_FACE_PALETTE_STEP_COUNT - 1)
          * (this.paletteColors.length - 1),
        );
        context.fillStyle = this.paletteMotion.colorFromNoise(
          paletteIndex / Math.max(1, this.paletteColors.length - 1),
          sample,
          activation * this.paletteMotion.options.amount,
        );
      } else {
        context.fillStyle = this.paletteColorStep(baseStep);
      }
      context.beginPath();
      context.arc(center.x, center.y, radius, 0, CIRCLE_TAU);
      context.fill();
    });
    context.restore();
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
    return this.options.cycleSeconds;
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
  }
}

export default CircleGridSceneGenerator;
