import { debug } from "../debug/index.js";
import { resolveAutomaticDuration } from "../core/automatic-duration.js";
import {
  countdownClockDotColors,
  countdownClockFrame,
  countdownClockPlan,
  drawCountdownClock,
  resolveCountdownClockSettings,
  validateCountdownClockLayout,
} from "../countdown-appearance-effects/clock.js";
import {
  countdownAppearanceEffectTicks,
  countdownAppearanceStageAt,
  resolveCountdownAppearanceOrder,
} from "../countdown-appearance-effects/order.js";
import {
  countdownFrameAt,
  countdownFrameAvoidanceEnvelopesAt,
  countdownFrameAvoidanceRadiusAt,
  countdownFrameDigitCircles,
  countdownFrameDotColors,
  countdownFrameGrowthAt,
  countdownFrameNoiseBeatOffsetAt,
  countdownFramePlan,
  countdownFramePlanWithSnakeTrail,
  countdownFrameRadiusAt,
  countdownFrameSquareCapacity,
  countdownFrameSquareCountAt,
  countdownFrameSquaresWithEdgeDistance,
  countdownFrameTextSafeRectangle,
  countdownSnakeBubbleExclusionCircles,
  countdownSnakeBubblePlan,
  drawCountdownFrame,
  resolveCountdownFrameSettings,
} from "../countdown-appearance-effects/frame.js";
import { createFlicker } from "../visuals/flicker/index.js";
import {
  countdownAppearanceSeed,
  countdownSnakeFrame,
  countdownSnakeLengthAt,
  countdownSnakeMergeFrame,
  countdownSnakePath,
  countdownSnakeTextSafeCells,
  drawCountdownSnake,
  resolveCountdownSnakeSettings,
} from "../countdown-appearance-effects/snake.js";
import { drawCellGridGuides } from "../grid/cell-grid-guides.js";
import {
  createNoiseFieldRegistry,
  NoiseFieldSampler,
  resolveNoiseFieldSettings,
} from "../noise-fields/index.js";
import { createCircleGridSceneLayout } from "./circle-grid-scene-generator.js";
import { hashUnit } from "./grid-scene-strategies.js";
import { manhattanGridDistance } from "./pathfinding-strategies.js";

const CELL_SELECTION_SALT = 1879;

function requireFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`);
  }
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function relativeLuminance(hex) {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!match) {
    throw new TypeError(`Countdown palette color "${hex}" must be six-digit hex.`);
  }
  const channels = match.slice(1).map(channel => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function boundedHashIndex(seed, tick, count) {
  return Math.min(count - 1, Math.floor(hashUnit(seed, tick, CELL_SELECTION_SALT) * count));
}

export function formatCountdown(totalSeconds) {
  const seconds = requireNonNegativeInteger(totalSeconds, "Countdown seconds");
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

/** A seeded cell sequence with a strict parent-grid separation. */
export function countdownCellIndex(
  projectSeed,
  tick,
  layout,
  minimumDistance = 1,
  cycleLength = null,
) {
  const seed = requireNonNegativeInteger(projectSeed, "Countdown project seed") >>> 0;
  const targetTick = requireNonNegativeInteger(tick, "Countdown tick");
  const columns = requireNonNegativeInteger(layout?.columns, "Countdown grid columns");
  const rows = requireNonNegativeInteger(layout?.rows, "Countdown grid rows");
  const distance = requireNonNegativeInteger(
    minimumDistance,
    "Countdown minimum cell distance",
  );
  if (columns === 0 || rows === 0) {
    throw new RangeError("Countdown grid dimensions must be greater than zero.");
  }
  if (cycleLength !== null) {
    requireNonNegativeInteger(cycleLength, "Countdown cycle length");
    if (cycleLength <= 1 || targetTick >= cycleLength) {
      throw new RangeError("Countdown cycle length must contain the requested tick.");
    }
  }
  const count = columns * rows;
  if (count === 1 && (distance > 0 || targetTick > 0)) {
    throw new RangeError("Countdown grid cannot satisfy its minimum cell distance.");
  }

  let selected = boundedHashIndex(seed, 0, count);
  const first = selected;
  for (let index = 1; index <= targetTick; index += 1) {
    const candidates = Array.from({ length: count }, (_, cellIndex) => cellIndex)
      .filter(cellIndex => (
        manhattanGridDistance(layout, selected, cellIndex) >= distance
        && (
          cycleLength === null
          || index !== cycleLength - 1
          || manhattanGridDistance(layout, first, cellIndex) >= distance
        )
      ));
    if (candidates.length === 0) {
      throw new RangeError(
        `Countdown grid cannot keep cells ${distance} parent cells apart.`,
      );
    }
    selected = candidates[boundedHashIndex(seed, index, candidates.length)];
  }
  return selected;
}

export function countdownPalette(options, palettes) {
  const palette = palettes?.[options.palette];
  if (!Array.isArray(palette) || palette.length === 0) {
    throw new Error(
      `countdownFramed refers to unavailable palette "${options.palette}".`,
    );
  }
  return palette
    .map((color, authoredIndex) => ({
      color: requireString(color, `Palette ${options.palette} color`),
      authoredIndex,
      luminance: relativeLuminance(color),
    }))
    .sort((first, second) => (
      first.luminance - second.luminance
      || first.authoredIndex - second.authoredIndex
    ))
    .map(entry => entry.color);
}

export function countdownRevealPaletteIndices(label, paletteLength, revealStep) {
  requireString(label, "Countdown label");
  const colorCount = requireNonNegativeInteger(paletteLength, "Countdown palette length");
  const step = requireNonNegativeInteger(revealStep, "Countdown reveal step");
  if (colorCount === 0) {
    throw new RangeError("Countdown palette length must be greater than zero.");
  }
  const glyphs = [...label];
  const centerIndex = glyphs.indexOf(":");
  if (centerIndex < 0) throw new Error("Countdown label must contain a center colon.");
  const finalPaletteIndex = colorCount - 1;
  return glyphs.map((glyph, index) => Math.min(
    finalPaletteIndex,
    Math.max(0, step - Math.abs(index - centerIndex)),
  ));
}

export class CountdownFramedGenerator {
  constructor({
    name,
    settingsKey,
    options,
    settings,
    runtime,
    palettes,
    noiseFieldModes,
  }) {
    if (!runtime || typeof runtime.viewport !== "function") {
      throw new TypeError("Countdown framed requires runtime.viewport().");
    }
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Countdown framed options must be an object.");
    }
    if (!options.timing || typeof options.timing !== "object") {
      throw new TypeError("countdownFramed requires resolved composition timing.");
    }

    this.generatorInstanceId = name ?? null;
    this.settingsKey = settingsKey ?? null;
    this.runtime = runtime;
    this.countFromSeconds = requireNonNegativeInteger(
      options.countFromSeconds,
      "countdownFramed.countFromSeconds",
    );
    if (this.countFromSeconds === 0) {
      throw new RangeError("countdownFramed.countFromSeconds must be positive.");
    }
    this.tickSeconds = requireFinitePositive(
      options.timing.beatSeconds,
      "countdownFramed.timing.beatSeconds",
    );
    if (
      !options.textReveal
      || typeof options.textReveal !== "object"
      || Array.isArray(options.textReveal)
    ) {
      throw new TypeError("countdownFramed.textReveal must be an object.");
    }
    this.revealDuration = resolveAutomaticDuration(
      options.textReveal.durationSeconds,
      {
        label: "countdownFramed.textReveal.durationSeconds",
        candidates: [{ source: "composition-beat", seconds: this.tickSeconds }],
      },
    );
    if (this.revealDuration.seconds > this.tickSeconds) {
      throw new RangeError(
        "countdownFramed.textReveal.durationSeconds cannot exceed one composition beat.",
      );
    }
    this.durationSeconds = requireFinitePositive(
      options.timing.bodyDurationSeconds,
      "countdownFramed.timing.bodyDurationSeconds",
    );
    this.appearanceOrderSettings = resolveCountdownAppearanceOrder(
      options.appearance,
      this.durationSeconds,
    );
    const expectedBeatCount = this.countFromSeconds;
    if (options.timing.beatCount !== expectedBeatCount) {
      throw new Error(
        `countdownFramed.timing.beatCount must equal countFromSeconds (${expectedBeatCount}).`,
      );
    }
    if (options.timing.bodyDurationSeconds !== this.countFromSeconds) {
      throw new Error(
        "countdownFramed.timing.bodyDurationSeconds must equal countFromSeconds "
        + `(${this.countFromSeconds}).`,
      );
    }
    this.longSideCells = requireFinitePositive(
      options.longSideCells,
      "countdownFramed.longSideCells",
    );
    this.fontFamily = requireString(options.fontFamily, "countdownFramed.fontFamily");
    this.fontWeight = requireFinitePositive(
      options.fontWeight,
      "countdownFramed.fontWeight",
    );
    this.fontSizeInCells = requireFinitePositive(
      options.fontSizeInCells,
      "countdownFramed.fontSizeInCells",
    );
    this.palette = countdownPalette(options, palettes);
    this.snakeSettings = resolveCountdownSnakeSettings(
      options.appearance,
      this.tickSeconds,
    );
    this.snakePalette = countdownPalette(
      { palette: this.snakeSettings.palette },
      palettes,
    );
    this.clockSettings = resolveCountdownClockSettings(
      options.appearance,
      this.tickSeconds,
    );
    this.clockPalette = countdownPalette(
      { palette: this.clockSettings.palette },
      palettes,
    );
    this.clockFlicker = createFlicker({
      palette: this.clockPalette,
      settings: options.flicker,
      noiseFunction: typeof runtime.p5?.noise === "function"
        ? runtime.p5.noise.bind(runtime.p5)
        : undefined,
      autoCycleSeconds: this.tickSeconds,
    });
    this.frameSettings = resolveCountdownFrameSettings(options.appearance);
    const authoredFrameNoise = options.appearance?.effects?.frame?.noiseFields;
    if (
      !authoredFrameNoise
      || typeof authoredFrameNoise !== "object"
      || Array.isArray(authoredFrameNoise)
    ) {
      throw new TypeError(
        "countdownFramed.appearance.effects.frame.noiseFields must be an object.",
      );
    }
    this.frameNoiseEdgeWidth = requireNonNegativeInteger(
      authoredFrameNoise.edgeWidthInSquares,
      "countdownFramed.appearance.effects.frame.noiseFields.edgeWidthInSquares",
    );
    if (this.frameNoiseEdgeWidth === 0) {
      throw new RangeError(
        "countdownFramed.appearance.effects.frame.noiseFields.edgeWidthInSquares must be positive.",
      );
    }
    this.frameNoiseModes = noiseFieldModes ?? createNoiseFieldRegistry();
    this.frameNoiseSettings = resolveNoiseFieldSettings(
      settings?.noiseFields ?? {},
      authoredFrameNoise,
      { modeRegistry: this.frameNoiseModes, timing: options.timing },
    );
    if (this.frameNoiseSettings.layers.visibility.holdSeconds !== 0) {
      throw new RangeError(
        "countdownFramed frame visibility noise requires holdSeconds to be zero.",
      );
    }
    this.frameNoiseSampler = new NoiseFieldSampler({
      modeRegistry: this.frameNoiseModes,
    });
    this.framePalette = countdownPalette(
      { palette: this.frameSettings.palette },
      palettes,
    );
    this.frameFlicker = createFlicker({
      palette: this.framePalette,
      settings: options.flicker,
      noiseFunction: typeof runtime.p5?.noise === "function"
        ? runtime.p5.noise.bind(runtime.p5)
        : undefined,
      autoCycleSeconds: this.tickSeconds,
    });
    const initialGlyphs = [...formatCountdown(this.countFromSeconds)];
    const centerGlyphIndex = initialGlyphs.indexOf(":");
    this.maximumGlyphDistance = Math.max(
      centerGlyphIndex,
      initialGlyphs.length - 1 - centerGlyphIndex,
    );
    this.revealStepCount = this.palette.length - 1 + this.maximumGlyphDistance;
    this.revealStepSeconds = this.revealDuration.seconds / this.revealStepCount;
    debug.config(
      "countdown-intro authored=%s source=%s beat=%.3f duration=%.3f step=%.3f",
      this.revealDuration.authored,
      this.revealDuration.source,
      this.tickSeconds,
      this.revealDuration.seconds,
      this.revealStepSeconds,
    );
    debug.config(
      "countdown-order stages=%s stageDuration=%.3f",
      this.appearanceOrderSettings.stageDefinitions
        .map(stage => `${stage.effect}:${stage.evolutionStartsAt}`)
        .join(","),
      this.appearanceOrderSettings.stageDurationSeconds,
    );
    const authoredSeed = Number(runtime.projectSeed?.() ?? 0);
    this.projectSeed = Number.isInteger(authoredSeed) && authoredSeed >= 0
      ? authoredSeed >>> 0
      : 0;
    debug.config(
      "countdown-effect mode=snake enabled=%s seed=%d evolve=%s distance=%d palette=%s duration=%.3f cells=%d grow=%s mergeBubbles=%s bubbleClearanceCells=%.3f curve=%j",
      this.snakeSettings.enabled ? "yes" : "no",
      this.snakeSettings.seed,
      this.snakeSettings.evolveSeed ? "yes" : "no",
      this.snakeSettings.minimumCellDistance,
      this.snakeSettings.palette,
      this.snakeSettings.duration.seconds,
      this.snakeSettings.lengthCells,
      this.snakeSettings.growAfterEachTick ? "yes" : "no",
      this.snakeSettings.mergeIntoBubbles ? "yes" : "no",
      this.snakeSettings.bubbleClearanceInCells,
      this.snakeSettings.timingCurve,
    );
    debug.config(
      "countdown-effect mode=clock enabled=%s seed=%d evolveSeed=%s palette=%s duration=%.3f level=%d squares=%d dotsPerSquare=%d behindText=%s evolutionSizes=%j rangeX=%d rangeY=%d safeWidthCells=%.3f safeHeightCells=%.3f squareGap=%d curve=%j",
      this.clockSettings.enabled ? "yes" : "no",
      this.clockSettings.seed,
      this.clockSettings.evolveSeed ? "yes" : "no",
      this.clockSettings.palette,
      this.clockSettings.duration.seconds,
      this.clockSettings.subdivisionLevel,
      this.clockSettings.squareCount,
      this.clockSettings.dotsPerSquare,
      this.clockSettings.behindText ? "yes" : "no",
      this.clockSettings.evolutionSquareSizes,
      this.clockSettings.rangeInSubdivisions.x,
      this.clockSettings.rangeInSubdivisions.y,
      this.clockSettings.textSafeZone.widthInCells,
      this.clockSettings.textSafeZone.heightInCells,
      this.clockSettings.minimumSquareGapInSubdivisions,
      this.clockSettings.timingCurve,
    );
    debug.config(
      "countdown-effect mode=bubbles enabled=%s seed=%d evolveSeed=%s evolveSquares=%s palette=%s level=%d squares=%d dotsPerSquare=%d avoidanceRadiusStartCells=%.3f avoidanceRadiusEndCells=%.3f avoidanceBeats=%.3f numberSpacing=%.3f grow=%s avoidanceCurve=%j avoidanceRadiusCurve=%j growthCurve=%j",
      this.frameSettings.enabled ? "yes" : "no",
      this.snakeSettings.seed,
      this.snakeSettings.evolveSeed ? "yes" : "no",
      this.frameSettings.evolveSquareCount ? "yes" : "no",
      this.frameSettings.palette,
      this.frameSettings.subdivisionLevel,
      this.frameSettings.squareCount,
      this.frameSettings.dotsPerSquare,
      this.frameSettings.avoidance.radiusInCells,
      this.frameSettings.avoidance.radiusAtEndInCells,
      this.frameSettings.avoidance.durationBeats,
      this.frameSettings.numberSpacingInSubdivisions,
      this.frameSettings.growTowardZero ? "yes" : "no",
      this.frameSettings.avoidance.timingCurve,
      this.frameSettings.avoidance.radiusGrowthTimingCurve,
      this.frameSettings.growthTimingCurve,
    );
    debug.config(
      "countdown-effect mode=bubbles-noise-motion beatWiggleDistance=%.3f curve=%j",
      this.frameSettings.visibilityNoiseMotion.beatWiggleDistance,
      this.frameSettings.visibilityNoiseMotion.timingCurve,
    );
    const frameFlicker = this.frameFlicker.inspect();
    debug.config(
      "countdown-effect mode=bubbles-flicker enabled=%s field=%s scope=%s amount=%.3f speed=%.3f spatialScale=%.3f",
      frameFlicker.enabled ? "yes" : "no",
      frameFlicker.mode,
      frameFlicker.scope,
      frameFlicker.amount,
      frameFlicker.modeSettings.speed,
      frameFlicker.modeSettings.spatialScale,
    );
    const visibilityNoise = this.frameNoiseSettings.layers.visibility;
    debug.config(
      "countdown-effect mode=bubbles-visibility-noise enabled=%s field=%s edgeWidth=%d scale=%.3f threshold=%.3f softness=%.3f seed=%d",
      this.frameNoiseSettings.enabled ? "yes" : "no",
      visibilityNoise.mode,
      this.frameNoiseEdgeWidth,
      visibilityNoise.scale,
      visibilityNoise.threshold,
      visibilityNoise.softness,
      visibilityNoise.seed,
    );

    this.active = false;
    this.disposed = false;
    this.elapsed = 0;
    this.tick = -1;
    this.revealStep = -1;
    this.paletteIndices = [];
    this.remainingSeconds = this.countFromSeconds;
    this.label = formatCountdown(this.remainingSeconds);
    this.cellIndex = 0;
    this.appearanceStage = countdownAppearanceStageAt(
      0,
      this.appearanceOrderSettings,
    );
    this.snakePlan = null;
    this.snakeFrame = null;
    this.snakeRenderFrame = null;
    this.snakeFrameSettings = null;
    this.snakeMergeActive = false;
    this.snakeMergeTick = 0;
    this.clockSnakeHandoff = null;
    this.snakeHandoff = null;
    this.snakeBubblePlan = null;
    this.snakeBubbleFrame = null;
    this.snakeBubbleExclusionCircles = [];
    this.availableSnakeCellCount = 1;
    this.clockPlan = null;
    this.clockFrame = null;
    this.framePlan = null;
    this.frameRenderPlan = null;
    this.frameFrame = null;
    this.frameAvoidanceBubbles = [];
    this.frameAvoidanceCircles = [];
    this.frameTextSafeRectangle = null;
    this.frameAvoidanceRadiusInCells = this.frameSettings.avoidance.radiusInCells;
    this.frameVisibilityPlane = null;
    this.frameNoiseTemporalOffset = 0;
    this.frameNoiseWigglePhase = "out";
    this.frameGrowthProgress = 0;
    this.resize(runtime.viewport());
  }

  resize(viewport) {
    this.layout = createCircleGridSceneLayout(viewport, this.longSideCells);
    let clockLayout;
    try {
      clockLayout = validateCountdownClockLayout(
        this.layout,
        this.clockSettings,
      );
    } catch (error) {
      debug.config(
        "countdown-clock-layout columns=%d rows=%d safe=invalid error=%s",
        this.layout.columns,
        this.layout.rows,
        error?.message ?? "unknown",
      );
      throw error;
    }
    debug.config(
      "countdown-clock-layout columns=%d rows=%d checkedCells=%d maximumSize=%d safe=valid",
      this.layout.columns,
      this.layout.rows,
      clockLayout.checkedCellCount,
      clockLayout.maximumSquareSize,
    );
    this.availableSnakeCellCount = Math.max(
      1,
      this.layout.columns * this.layout.rows - 2,
    );
    let maximumSafePathLength = 0;
    try {
      for (let tick = 0; tick < this.countFromSeconds; tick += 1) {
        maximumSafePathLength = Math.max(
          maximumSafePathLength,
          this.snakeStateAt(tick).plan.path.length,
        );
      }
    } catch (error) {
      debug.config(
        "countdown-snake-layout columns=%d rows=%d checkedTicks=%d safe=invalid error=%s",
        this.layout.columns,
        this.layout.rows,
        this.countFromSeconds,
        error?.message ?? "unknown",
      );
      throw error;
    }
    debug.config(
      "countdown-snake-layout columns=%d rows=%d checkedTicks=%d maximumPath=%d safe=valid",
      this.layout.columns,
      this.layout.rows,
      this.countFromSeconds,
      maximumSafePathLength,
    );
    this.prepareSnakeHandoff();
    this.clockFlicker.resize({
      columns: this.layout.columns,
      rows: this.layout.rows,
      cellSize: this.layout.cellSize,
      dotsPerCellAxis: 1 << this.clockSettings.subdivisionLevel,
    });
    this.frameFlicker.resize({
      columns: this.layout.columns,
      rows: this.layout.rows,
      cellSize: this.layout.cellSize,
      dotsPerCellAxis: 1 << this.frameSettings.subdivisionLevel,
    });
    this.cellIndex = countdownCellIndex(
      this.projectSeed,
      Math.max(0, this.tick),
      this.layout,
      this.snakeSettings.minimumCellDistance,
      this.countFromSeconds,
    );
    if (this.tick >= 0) {
      this.prepareSnakePlan(this.tick, false);
      this.snakeFrame = countdownSnakeFrame(
        this.snakePlan,
        this.snakeFrame?.linearProgress ?? 0,
        this.snakeFrameSettings,
      );
      this.snakeRenderFrame = this.snakeMergeActive
        ? countdownSnakeMergeFrame(this.snakeFrame)
        : this.snakeFrame;
      this.prepareClockPlan(this.tick, false);
      this.clockFrame = countdownClockFrame(
        this.clockPlan,
        this.clockFrame?.linearProgress ?? 0,
        this.clockSettings,
      );
      this.prepareFramePlan(this.tick, false, true);
      const localTime = this.elapsed % this.durationSeconds;
      this.prepareFrameAvoidance(
        this.tick,
        localTime - this.tick * this.tickSeconds,
      );
      this.sampleFrameVisibility(this.elapsed);
      this.prepareSnakeBubbleRenderPlan();
      this.frameFrame = countdownFrameAt(
        this.frameRenderPlan,
        this.frameFrame?.linearProgress ?? 0,
        this.frameSettings,
        this.frameAvoidanceCircles,
        this.frameVisibilityPlane,
        this.snakeBubbleExclusionCircles,
      );
    }
  }

  snakeStateAt(tick) {
    const evolution = countdownAppearanceEffectTicks(
      "snake",
      tick,
      this.tickSeconds,
      this.countFromSeconds,
      this.appearanceOrderSettings,
    );
    const mergeActive = tick >= evolution.evolutionStartTick;
    const mergeTick = mergeActive
      ? Math.min(tick, evolution.endTick) - evolution.evolutionStartTick
      : 0;
    const sourceCellIndex = countdownCellIndex(
      this.projectSeed,
      tick,
      this.layout,
      this.snakeSettings.minimumCellDistance,
      this.countFromSeconds,
    );
    const lengthCells = countdownSnakeLengthAt(
      this.snakeSettings.lengthCells,
      mergeTick,
      this.snakeSettings.growAfterEachTick && mergeActive,
      this.availableSnakeCellCount,
    );
    const frameSettings = { ...this.snakeSettings, lengthCells };
    const destinationTick = (tick + 1) % this.countFromSeconds;
    const targetCellIndex = countdownCellIndex(
      this.projectSeed,
      destinationTick,
      this.layout,
      this.snakeSettings.minimumCellDistance,
      this.countFromSeconds,
    );
    const seed = countdownAppearanceSeed(
      this.projectSeed,
      this.snakeSettings.seed,
      mergeTick,
      this.snakeSettings.evolveSeed && mergeActive,
    );
    const textSafeCellIndices = countdownSnakeTextSafeCells(
      this.layout,
      sourceCellIndex,
      this.clockSettings.textSafeZone,
    );
    const pathBetweenCells = countdownSnakePath(
      this.layout,
      sourceCellIndex,
      targetCellIndex,
      seed,
      textSafeCellIndices,
    );
    const path = mergeActive
      ? pathBetweenCells.slice(1)
      : pathBetweenCells.slice(1, -1);
    return {
      evolution,
      mergeActive,
      mergeTick,
      frameSettings,
      plan: {
        seed,
        sourceCellIndex,
        targetCellIndex,
        sourceIndex: path[0],
        targetIndex: path.at(-1),
        path,
        textSafeCellIndices,
      },
    };
  }

  prepareSnakeHandoff() {
    const snakeTicks = countdownAppearanceEffectTicks(
      "snake",
      0,
      this.tickSeconds,
      this.countFromSeconds,
      this.appearanceOrderSettings,
    );
    const startState = this.snakeStateAt(snakeTicks.startTick);
    this.clockSnakeHandoff = {
      tick: snakeTicks.startTick,
      plan: startState.plan,
    };
    const state = this.snakeStateAt(snakeTicks.endTick);
    const snakeWindow = this.appearanceOrderSettings.windows.find(
      window => window.effect === "snake",
    );
    const boundaryProgress = Math.max(0, Math.min(
      1,
      (snakeWindow.endSeconds - snakeTicks.endTick * this.tickSeconds)
        / this.snakeSettings.duration.seconds,
    ));
    const frame = countdownSnakeFrame(
      state.plan,
      boundaryProgress,
      state.frameSettings,
    );
    this.snakeHandoff = {
      tick: snakeTicks.endTick,
      boundaryProgress,
      plan: state.plan,
      frameSettings: state.frameSettings,
      frame,
    };
  }

  prepareSnakePlan(tick, emitDebug = true) {
    const state = this.snakeStateAt(tick);
    this.snakeFrameSettings = state.frameSettings;
    this.snakeMergeActive = this.snakeSettings.mergeIntoBubbles
      && state.mergeActive;
    this.snakeMergeTick = state.mergeTick;
    this.snakePlan = state.plan;
    if (
      emitDebug
      && this.snakeSettings.enabled
      && (
        this.appearanceStage.effect === "snake"
        || (this.snakeSettings.mergeIntoBubbles
          && this.appearanceStage.effect === "bubbles")
      )
    ) {
      debug.plan(
        "countdown-effect mode=snake tick=%d evolution=%s evolutionTick=%d merge=%s mergeTick=%d seed=%d length=%d maximum=%d cellFrom=%d cellTo=%d from=%d to=%d textSafeCells=%s path=%s",
        tick,
        state.evolution.evolutionEnabled ? "yes" : "no",
        state.evolution.evolutionTick,
        this.snakeMergeActive ? "yes" : "no",
        this.snakeMergeTick,
        state.plan.seed,
        state.frameSettings.lengthCells,
        this.availableSnakeCellCount,
        state.plan.sourceCellIndex,
        state.plan.targetCellIndex,
        state.plan.sourceIndex,
        state.plan.targetIndex,
        state.plan.textSafeCellIndices.join(","),
        state.plan.path.join(","),
      );
    }
  }

  prepareClockPlan(tick, emitDebug = true) {
    const evolution = countdownAppearanceEffectTicks(
      "clock",
      tick,
      this.tickSeconds,
      this.countFromSeconds,
      this.appearanceOrderSettings,
    );
    const seed = countdownAppearanceSeed(
      this.projectSeed,
      this.clockSettings.seed,
      evolution.evolutionTick,
      this.clockSettings.evolveSeed && evolution.evolutionEnabled,
    );
    this.clockPlan = countdownClockPlan({
      seed,
      tick,
      layout: this.layout,
      cellIndex: this.cellIndex,
      subdivisionLevel: this.clockSettings.subdivisionLevel,
      squareCount: this.clockSettings.squareCount,
      dotsPerSquare: this.clockSettings.dotsPerSquare,
      evolutionSquareSizes: this.clockSettings.evolutionSquareSizes,
      evolutionEnabled: evolution.evolutionEnabled,
      evolutionProgress: evolution.evolutionProgress,
      handoffCellIndex: this.clockSnakeHandoff.plan.sourceIndex,
      rangeInSubdivisions: this.clockSettings.rangeInSubdivisions,
      textSafeZone: this.clockSettings.textSafeZone,
      minimumSquareGapInSubdivisions:
        this.clockSettings.minimumSquareGapInSubdivisions,
    });
    if (
      emitDebug
      && this.clockSettings.enabled
      && this.appearanceStage.effect === "clock"
    ) {
      debug.plan(
        "countdown-effect mode=clock tick=%d evolution=%s evolutionTick=%d seed=%d cell=%d mode=%s size=%d handoff=%d squares=%d safeText=%s squareGap=%d reserveExpansion=%s reservations=%s placements=%s dots=%s",
        tick,
        evolution.evolutionEnabled ? "yes" : "no",
        evolution.evolutionTick,
        seed,
        this.cellIndex,
        this.clockPlan.evolutionMode,
        this.clockPlan.squareSize,
        this.clockPlan.handoffCellIndex,
        this.clockPlan.squares.length,
        [
          this.clockPlan.textSafeZone.left,
          this.clockPlan.textSafeZone.top,
          this.clockPlan.textSafeZone.right,
          this.clockPlan.textSafeZone.bottom,
        ].join(":"),
        this.clockPlan.minimumSquareGapInSubdivisions,
        this.clockPlan.reservationExpansion ?? "origin",
        this.clockPlan.squares.map(square => square.reservation
          ? `${square.reservation.left}:${square.reservation.top}`
          : "origin").join(","),
        this.clockPlan.squares.map(square => (
          `${square.topLeftColumn}:${square.topLeftRow}`
        )).join(","),
        this.clockPlan.dots.map(dot => dot.index).join(","),
      );
    }
  }

  appendFramePlan(tick, retainedPlan = null) {
    const evolution = countdownAppearanceEffectTicks(
      "bubbles",
      tick,
      this.tickSeconds,
      this.countFromSeconds,
      this.appearanceOrderSettings,
    );
    const seed = countdownAppearanceSeed(
      this.projectSeed,
      this.snakeSettings.seed,
      evolution.evolutionTick,
      this.snakeSettings.evolveSeed && evolution.evolutionEnabled,
    );
    const maximumSquareCount = countdownFrameSquareCapacity(
      this.layout,
      this.frameSettings.subdivisionLevel,
    );
    const requestedSquareCount = countdownFrameSquareCountAt(
      this.frameSettings.squareCount,
      evolution.evolutionTick,
      this.frameSettings.evolveSquareCount && evolution.evolutionEnabled,
      maximumSquareCount,
      evolution.evolutionTickCount,
    );
    const retainedSquares = retainedPlan?.squares ?? [];
    const cellIndex = countdownCellIndex(
      this.projectSeed,
      tick,
      this.layout,
      this.snakeSettings.minimumCellDistance,
      this.countFromSeconds,
    );
    const additions = countdownFramePlan({
      seed,
      tick,
      layout: this.layout,
      cellIndex,
      subdivisionLevel: this.frameSettings.subdivisionLevel,
      squareCount: Math.max(0, requestedSquareCount - retainedSquares.length),
      minimumSquareCount: retainedPlan === null ? this.frameSettings.squareCount : 0,
      dotsPerSquare: this.frameSettings.dotsPerSquare,
      numberSpacingInSubdivisions: this.frameSettings.numberSpacingInSubdivisions,
      excludedTileIndices: retainedSquares.map(square => square.tileIndex),
      squareIndexOffset: retainedSquares.length,
    });
    const squares = countdownFrameSquaresWithEdgeDistance(
      [...retainedSquares, ...additions.squares],
      additions.gridColumns,
      additions.gridRows,
    );
    return {
      ...additions,
      evolutionEnabled: evolution.evolutionEnabled,
      evolutionTick: evolution.evolutionTick,
      evolutionTickCount: evolution.evolutionTickCount,
      requestedSquareCount,
      constrainedSquareCount: squares.length,
      retainedSquareCount: retainedSquares.length,
      addedSquareCount: additions.squares.length,
      squares,
      dots: squares.flatMap(square => square.dots),
    };
  }

  prepareFramePlan(tick, emitDebug = true, forceRebuild = false) {
    const effectTicks = countdownAppearanceEffectTicks(
      "bubbles",
      tick,
      this.tickSeconds,
      this.countFromSeconds,
      this.appearanceOrderSettings,
    );
    const planStartTick = tick >= effectTicks.startTick
      ? effectTicks.startTick
      : tick;
    const subdivisions = 1 << this.frameSettings.subdivisionLevel;
    const gridColumns = this.layout.columns * subdivisions;
    const gridRows = this.layout.rows * subdivisions;
    const canAppend = !forceRebuild
      && this.framePlan !== null
      && this.framePlan.tick === tick - 1
      && this.framePlan.planStartTick === planStartTick
      && this.framePlan.gridColumns === gridColumns
      && this.framePlan.gridRows === gridRows;
    if (canAppend) {
      this.framePlan = this.appendFramePlan(tick, this.framePlan);
    } else if (
      !forceRebuild
      && this.framePlan?.tick === tick
      && this.framePlan.planStartTick === planStartTick
      && this.framePlan.gridColumns === gridColumns
      && this.framePlan.gridRows === gridRows
    ) {
      return;
    } else {
      this.framePlan = null;
      for (let planTick = planStartTick; planTick <= tick; planTick += 1) {
        this.framePlan = this.appendFramePlan(planTick, this.framePlan);
        this.framePlan.planStartTick = planStartTick;
      }
    }
    if (this.framePlan.planStartTick === undefined) {
      this.framePlan.planStartTick = planStartTick;
    }
    if (
      emitDebug
      && this.frameSettings.enabled
      && this.appearanceStage.effect === "bubbles"
    ) {
      const squareSample = this.framePlan.squares.slice(0, 4);
      const edgeSquareCount = this.framePlan.squares.filter(
        square => square.edgeDistance === 0,
      ).length;
      debug.plan(
        "countdown-effect mode=bubbles tick=%d evolution=%s evolutionTick=%d/%d seed=%d cell=%d level=%d requested=%d retained=%d added=%d squares=%d maximum=%d edgeSquares=%d targetSample=%s placementSample=%s dotSample=%s",
        tick,
        this.framePlan.evolutionEnabled ? "yes" : "no",
        this.framePlan.evolutionTick,
        this.framePlan.evolutionTickCount - 1,
        this.framePlan.seed,
        this.cellIndex,
        this.frameSettings.subdivisionLevel,
        this.framePlan.requestedSquareCount,
        this.framePlan.retainedSquareCount,
        this.framePlan.addedSquareCount,
        this.framePlan.squares.length,
        this.framePlan.maximumSquareCount,
        edgeSquareCount,
        squareSample.map(square => square.targetDigitIndex).join(","),
        squareSample.map(square => (
          `${square.topLeftColumn}:${square.topLeftRow}`
        )).join(","),
        this.framePlan.dots.slice(0, 8).map(dot => dot.index).join(","),
      );
    }
  }

  prepareSnakeBubbleRenderPlan() {
    const snakeEnteringBubbles = this.snakeSettings.mergeIntoBubbles
      && this.appearanceStage.effect === "snake"
      && this.appearanceStage.evolutionEnabled;
    const snakeRoamingInBubbles = this.snakeSettings.mergeIntoBubbles
      && this.appearanceStage.effect === "bubbles";
    if (!snakeEnteringBubbles && !snakeRoamingInBubbles) {
      this.snakeBubblePlan = null;
      this.snakeBubbleFrame = null;
      this.snakeBubbleExclusionCircles = [];
      this.frameTextSafeRectangle = null;
      this.frameRenderPlan = this.framePlan;
      return;
    }
    const progress = snakeEnteringBubbles
      ? this.appearanceStage.evolutionProgress
      : 1;
    const sourceFrame = this.snakeRenderFrame;
    const sourceTick = this.tick;
    this.snakeBubblePlan = countdownSnakeBubblePlan({
      layout: this.layout,
      cells: sourceFrame.cells,
      progress,
      appearanceTick: sourceTick,
      subdivisionLevel: this.frameSettings.subdivisionLevel,
    });
    this.snakeBubbleExclusionCircles = countdownSnakeBubbleExclusionCircles({
      layout: this.layout,
      cells: sourceFrame.cells,
      subdivisionLevel: this.frameSettings.subdivisionLevel,
      clearanceInCells: this.snakeSettings.bubbleClearanceInCells,
      dotMargin: this.snakeSettings.dotMargin,
    });
    this.frameRenderPlan = countdownFramePlanWithSnakeTrail(
      this.framePlan,
      this.snakeBubblePlan,
    );
    if (snakeRoamingInBubbles) {
      this.snakeBubbleFrame = null;
      this.frameTextSafeRectangle = null;
      return;
    }
    this.frameTextSafeRectangle = countdownFrameTextSafeRectangle({
      layout: this.layout,
      cellIndex: this.cellIndex,
      subdivisionLevel: this.frameSettings.subdivisionLevel,
      textSafeZone: this.clockSettings.textSafeZone,
    });
    this.snakeBubbleFrame = countdownFrameAt(
      this.frameRenderPlan,
      1,
      this.frameSettings,
      [],
      this.frameVisibilityPlane,
      this.snakeBubbleExclusionCircles,
      [this.frameTextSafeRectangle],
    );
  }

  prepareFrameAvoidance(tick, beatElapsed) {
    if (this.appearanceStage.effect !== "bubbles") {
      this.frameAvoidanceBubbles = [];
      this.frameAvoidanceCircles = [];
      return;
    }
    const effectTicks = countdownAppearanceEffectTicks(
      "bubbles",
      tick,
      this.tickSeconds,
      this.countFromSeconds,
      this.appearanceOrderSettings,
    );
    const beatFraction = Math.max(
      0,
      Math.min(1, beatElapsed / this.tickSeconds),
    );
    const bubbles = [];
    const lifetime = this.frameSettings.avoidance.durationBeats;
    const historyLength = Math.ceil(lifetime);
    for (let tickOffset = 0; tickOffset < historyLength; tickOffset += 1) {
      const ageBeats = tickOffset + beatFraction;
      if (ageBeats >= lifetime) continue;
      const sourceTick = tick - tickOffset;
      if (sourceTick < effectTicks.startTick) continue;
      const sourceCellIndex = countdownCellIndex(
        this.projectSeed,
        sourceTick,
        this.layout,
        this.snakeSettings.minimumCellDistance,
        this.countFromSeconds,
      );
      const sourceEvolution = countdownAppearanceEffectTicks(
        "bubbles",
        sourceTick,
        this.tickSeconds,
        this.countFromSeconds,
        this.appearanceOrderSettings,
      );
      const radiusInCells = countdownFrameAvoidanceRadiusAt(
        sourceEvolution.evolutionProgress,
        this.frameSettings.avoidance,
      );
      const envelopes = countdownFrameAvoidanceEnvelopesAt(
        ageBeats,
        this.frameSettings.avoidance,
      );
      const circles = countdownFrameDigitCircles({
        layout: this.layout,
        cellIndex: sourceCellIndex,
        subdivisionLevel: this.frameSettings.subdivisionLevel,
        numberSpacingInSubdivisions: this.frameSettings.numberSpacingInSubdivisions,
        radiusInCells,
        emptyEnvelope: envelopes.emptyEnvelope,
        refillEnvelope: envelopes.refillEnvelope,
      }).map(circle => ({ ...circle, sourceTick }));
      bubbles.push({
        sourceTick,
        sourceCellIndex,
        ageBeats,
        radiusInCells,
        ...envelopes,
        circles,
      });
    }
    this.frameAvoidanceBubbles = bubbles;
    this.frameAvoidanceCircles = bubbles.flatMap(bubble => bubble.circles);
  }

  sampleFrameVisibility(time) {
    if (!this.framePlan || !this.frameNoiseSettings.enabled) {
      this.frameVisibilityPlane = null;
      return;
    }
    const localTime = time % this.durationSeconds;
    const plane = this.frameNoiseSampler.samplePlane({
      name: "visibility",
      width: this.framePlan.gridColumns,
      height: this.framePlan.gridRows,
      progress: localTime / this.durationSeconds,
      timeSeconds: localTime,
      temporalOffset: this.frameNoiseTemporalOffset,
      projectSeed: this.projectSeed,
      settings: this.frameNoiseSettings,
    });
    this.frameVisibilityPlane = {
      enabled: true,
      ...plane,
      layer: this.frameNoiseSettings.layers.visibility,
      edgeWidthInSquares: this.frameNoiseEdgeWidth,
      seed: (this.projectSeed ^ this.frameNoiseSettings.layers.visibility.seed) >>> 0,
    };
  }

  enter(frame = {}) {
    if (this.disposed) throw new Error("Countdown framed has been disposed.");
    this.active = true;
    this.setTime(Number.isFinite(frame.time) ? frame.time : 0, true);
  }

  exit() {
    this.active = false;
  }

  update(frame = {}) {
    if (this.disposed) throw new Error("Countdown framed has been disposed.");
    const dt = Number.isFinite(frame.compositionDt)
      ? frame.compositionDt
      : (Number.isFinite(frame.dt) ? frame.dt : 0);
    const time = Number.isFinite(frame.time) ? frame.time : this.elapsed + Math.max(0, dt);
    this.setTime(time);
  }

  setTime(time, force = false) {
    if (!Number.isFinite(time) || time < 0) {
      throw new RangeError("Countdown framed time must be finite and non-negative.");
    }
    this.elapsed = time;
    const localTime = time % this.durationSeconds;
    const previousStage = this.appearanceStage;
    const nextStage = countdownAppearanceStageAt(
      localTime,
      this.appearanceOrderSettings,
    );
    const orderChanged = nextStage.effect !== previousStage.effect
      || nextStage.phase !== previousStage.phase;
    this.appearanceStage = nextStage;
    const bubblesEvolution = countdownAppearanceEffectTicks(
      "bubbles",
      Math.min(
        this.countFromSeconds - 1,
        Math.floor(localTime / this.tickSeconds),
      ),
      this.tickSeconds,
      this.countFromSeconds,
      this.appearanceOrderSettings,
    );
    this.frameGrowthProgress = countdownFrameGrowthAt(
      this.appearanceStage.effect === "bubbles"
        ? bubblesEvolution.evolutionProgress
        : 0,
      this.frameSettings,
    );
    const nextTick = Math.min(
      this.countFromSeconds - 1,
      Math.floor(localTime / this.tickSeconds),
    );
    this.frameAvoidanceRadiusInCells = countdownFrameAvoidanceRadiusAt(
      bubblesEvolution.evolutionProgress,
      this.frameSettings.avoidance,
    );
    const beatElapsed = localTime - nextTick * this.tickSeconds;
    const beatProgress = beatElapsed / this.tickSeconds;
    const previousNoiseWigglePhase = this.frameNoiseWigglePhase;
    this.frameNoiseWigglePhase = beatProgress < 0.5 ? "out" : "back";
    this.frameNoiseTemporalOffset = countdownFrameNoiseBeatOffsetAt(
      beatProgress,
      this.frameSettings.visibilityNoiseMotion,
    );
    const noiseWiggleChanged = this.frameNoiseWigglePhase
      !== previousNoiseWigglePhase;
    const nextRevealStep = Math.min(
      this.revealStepCount,
      Math.floor(beatElapsed / this.revealStepSeconds),
    );
    const tickChanged = nextTick !== this.tick;
    const revealChanged = nextRevealStep !== this.revealStep;

    if (force || tickChanged) {
      this.tick = nextTick;
      this.remainingSeconds = this.countFromSeconds - nextTick;
      this.label = formatCountdown(this.remainingSeconds);
      this.cellIndex = countdownCellIndex(
        this.projectSeed,
        nextTick,
        this.layout,
        this.snakeSettings.minimumCellDistance,
        this.countFromSeconds,
      );
      debug.cells(
        "countdown tick=%d label=%s cell=%d",
        this.tick,
        this.label,
        this.cellIndex,
      );
      this.prepareSnakePlan(nextTick);
      this.prepareClockPlan(nextTick);
      this.prepareFramePlan(
        nextTick,
        true,
        orderChanged && this.appearanceStage.effect === "bubbles",
      );
    } else if (orderChanged) {
      if (this.appearanceStage.effect === "clock") {
        this.prepareClockPlan(nextTick);
      } else if (this.appearanceStage.effect === "snake") {
        this.prepareSnakePlan(nextTick);
      } else {
        this.prepareFramePlan(nextTick, true, true);
      }
    }
    const previousSnakeHead = this.snakeFrame?.headStep ?? -1;
    const nextSnakeFrame = countdownSnakeFrame(
      this.snakePlan,
      beatElapsed / this.snakeSettings.duration.seconds,
      this.snakeFrameSettings,
    );
    this.snakeFrame = nextSnakeFrame;
    const nextSnakeRenderFrame = this.snakeMergeActive
      ? countdownSnakeMergeFrame(nextSnakeFrame)
      : nextSnakeFrame;
    this.snakeRenderFrame = nextSnakeRenderFrame;
    const snakeChanged = nextSnakeFrame.headStep !== previousSnakeHead;
    const previousSnakeBubbleCount = this.snakeBubblePlan?.squares.length ?? 0;
    const previousClockVisible = this.clockFrame?.visibleCount ?? -1;
    const nextClockFrame = countdownClockFrame(
      this.clockPlan,
      beatElapsed / this.clockSettings.duration.seconds,
      this.clockSettings,
    );
    this.clockFrame = nextClockFrame;
    const clockChanged = nextClockFrame.visibleCount !== previousClockVisible;
    const previousAvoidancePhases = this.frameAvoidanceBubbles
      .map(bubble => `${bubble.sourceTick}:${bubble.phase}`)
      .join(",");
    this.prepareFrameAvoidance(nextTick, beatElapsed);
    const avoidancePhases = this.frameAvoidanceBubbles
      .map(bubble => `${bubble.sourceTick}:${bubble.phase}`)
      .join(",");
    const avoidanceChanged = avoidancePhases !== previousAvoidancePhases;
    this.sampleFrameVisibility(time);
    this.prepareSnakeBubbleRenderPlan();
    const snakeBubbleChanged = (this.snakeBubblePlan?.squares.length ?? 0)
      !== previousSnakeBubbleCount;
    const nextFrameFrame = countdownFrameAt(
      this.frameRenderPlan,
      beatElapsed / this.tickSeconds,
      this.frameSettings,
      this.frameAvoidanceCircles,
      this.frameVisibilityPlane,
      this.snakeBubbleExclusionCircles,
    );
    this.frameFrame = nextFrameFrame;
    if (
      !force
      && !tickChanged
      && !orderChanged
      && !revealChanged
      && !snakeChanged
      && !snakeBubbleChanged
      && !clockChanged
      && !avoidanceChanged
      && !noiseWiggleChanged
    ) return;

    this.revealStep = nextRevealStep;
    if (force || orderChanged) {
      debug.timeline(
        "countdown-order stage=%s index=%d/3 next=%s phase=%s evolution=%s stageProgress=%.3f evolutionProgress=%.3f",
        this.appearanceStage.effect,
        this.appearanceStage.index,
        this.appearanceStage.nextEffect,
        this.appearanceStage.phase,
        this.appearanceStage.evolutionEnabled ? "yes" : "no",
        this.appearanceStage.stageProgress,
        this.appearanceStage.evolutionProgress,
      );
    }
    if (force || tickChanged || revealChanged) {
      this.paletteIndices = countdownRevealPaletteIndices(
        this.label,
        this.palette.length,
        this.revealStep,
      );
      debug.transition(
        "countdown-intro tick=%d step=%d colors=%j",
        this.tick,
        this.revealStep,
        this.paletteIndices,
      );
    }
    if (
      (
        this.appearanceStage.effect === "snake"
        || (this.snakeSettings.mergeIntoBubbles
          && this.appearanceStage.effect === "bubbles")
      )
      && this.snakeSettings.enabled
      && (force || orderChanged || tickChanged || snakeChanged)
    ) {
      debug.transition(
        "countdown-snake stage=%s tick=%d merge=%s head=%d/%d cell=%d levels=%s progress=%.3f",
        this.appearanceStage.effect,
        this.tick,
        this.snakeMergeActive ? "yes" : "no",
        nextSnakeFrame.headStep,
        this.snakePlan.path.length - 1,
        this.snakePlan.path[nextSnakeFrame.headStep],
        nextSnakeRenderFrame.cells.map(cell => cell.level).join(","),
        nextSnakeFrame.progress,
      );
    }
    if (
      this.snakeSettings.mergeIntoBubbles
      && (this.appearanceStage.effect === "snake" || this.appearanceStage.effect === "bubbles")
      && (force || orderChanged || tickChanged || snakeChanged || snakeBubbleChanged)
    ) {
      debug.transition(
        "countdown-merge from=snake to=bubbles phase=%s progress=%.3f sourceTick=%d headCell=%d levels=%s trailSquares=%d mergedSquares=%d overlap=%d exclusionCircles=%d hiddenDots=%d textSafeHiddenSquares=%d",
        this.appearanceStage.effect === "snake" ? "entering" : "roaming",
        this.appearanceStage.effect === "snake"
          ? this.appearanceStage.evolutionProgress
          : 1,
        this.snakeBubblePlan?.tick ?? -1,
        nextSnakeRenderFrame.cells.at(-1)?.index ?? -1,
        nextSnakeRenderFrame.cells.map(cell => cell.level).join(","),
        this.snakeBubblePlan?.squares.length ?? 0,
        this.frameRenderPlan?.squares.length ?? 0,
        this.frameRenderPlan?.trailOverlapCount ?? 0,
        this.snakeBubbleExclusionCircles.length,
        nextFrameFrame.snakeHiddenCount,
        this.snakeBubbleFrame?.rectangleAvoidedSquareCount ?? 0,
      );
    }
    if (
      this.appearanceStage.effect === "clock"
      && this.clockSettings.enabled
      && (force || orderChanged || tickChanged || clockChanged)
    ) {
      debug.transition(
        "countdown-clock tick=%d mode=%s size=%d visible=%d/%d handoff=%d progress=%.3f",
        this.tick,
        nextClockFrame.evolutionMode,
        nextClockFrame.squareSize,
        nextClockFrame.visibleCount,
        nextClockFrame.totalDotCount,
        this.clockPlan.handoffCellIndex,
        nextClockFrame.progress,
      );
    }
    if (
      this.frameSettings.enabled
      && this.appearanceStage.effect === "bubbles"
      && (
        force
        || orderChanged
        || tickChanged
        || avoidanceChanged
        || noiseWiggleChanged
      )
    ) {
      const maximumEmptyRadius = Math.max(
        0,
        ...this.frameAvoidanceCircles.map(circle => circle.radius),
      );
      const maximumRefillRadius = Math.max(
        0,
        ...this.frameAvoidanceCircles.map(circle => circle.refillRadius),
      );
      debug.transition(
        "countdown-bubbles tick=%d visible=%d/%d snakeHidden=%d noiseHidden=%d avoided=%d bubbles=%d wipe=%s emptyRadius=%.3f refillRadius=%.3f pushRadiusCells=%.3f noiseWiggle=%s noiseOffset=%.3f progress=%.3f",
        this.tick,
        nextFrameFrame.visibleCount,
        this.frameRenderPlan.squares.length * this.frameSettings.dotsPerSquare,
        nextFrameFrame.snakeHiddenCount,
        nextFrameFrame.noiseHiddenCount,
        nextFrameFrame.avoidedSquareCount,
        this.frameAvoidanceBubbles.length,
        avoidancePhases || "none",
        maximumEmptyRadius,
        maximumRefillRadius,
        this.frameAvoidanceRadiusInCells,
        this.frameNoiseWigglePhase,
        this.frameNoiseTemporalOffset,
        nextFrameFrame.progress,
      );
    }
  }

  draw(frame, planEntry, context) {
    if (!this.active) return;
    const column = this.cellIndex % this.layout.columns;
    const row = Math.floor(this.cellIndex / this.layout.columns);
    const x = this.layout.offsetX + (column + 0.5) * this.layout.cellSize;
    const y = this.layout.offsetY + (row + 0.5) * this.layout.cellSize;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${this.fontWeight} `
      + `${this.layout.cellSize * this.fontSizeInCells}px ${this.fontFamily}`;
    const glyphs = [...this.label];
    const widths = glyphs.map(glyph => context.measureText(glyph).width);
    const totalWidth = widths.reduce((sum, width) => sum + width, 0);
    const textLeft = x - totalWidth * 0.5;
    const drawClock = () => {
      if (this.appearanceStage.effect !== "clock") return;
      if (
        this.clockFrame.evolutionMode === "snake-origin"
        && this.clockFrame.visibleCount === this.clockFrame.totalDotCount
      ) {
        drawCountdownSnake(
          context,
          this.layout,
          { cells: [{ index: this.clockPlan.handoffCellIndex, level: 0 }] },
          this.snakeSettings,
          this.snakePalette,
        );
      } else {
        drawCountdownClock(
          context,
          this.layout,
          this.clockFrame,
          this.clockSettings,
          countdownClockDotColors(
            this.clockFrame,
            this.clockPalette,
            this.clockFlicker,
            this.elapsed,
          ),
        );
      }
    };
    if (this.appearanceStage.effect === "clock") {
      if (this.clockSettings.behindText) drawClock();
    } else if (this.appearanceStage.effect === "snake") {
      if (this.snakeBubbleFrame !== null) {
        drawCountdownFrame(
          context,
          this.layout,
          this.snakeBubbleFrame,
          this.frameSettings,
          countdownFrameDotColors(
            this.snakeBubbleFrame,
            this.framePalette,
            this.frameFlicker,
            this.elapsed,
          ),
          0,
        );
      }
      drawCountdownSnake(
        context,
        this.layout,
        this.snakeRenderFrame,
        this.snakeSettings,
        this.snakePalette,
      );
    } else {
      drawCountdownFrame(
        context,
        this.layout,
        this.frameFrame,
        this.frameSettings,
        countdownFrameDotColors(
          this.frameFrame,
          this.framePalette,
          this.frameFlicker,
          this.elapsed,
        ),
        this.frameGrowthProgress,
      );
      if (this.snakeSettings.mergeIntoBubbles) {
        drawCountdownSnake(
          context,
          this.layout,
          this.snakeRenderFrame,
          this.snakeSettings,
          this.snakePalette,
        );
      }
    }
    let cursor = textLeft;
    for (let index = 0; index < glyphs.length; index += 1) {
      const width = widths[index];
      context.fillStyle = this.palette[this.paletteIndices[index]];
      context.fillText(glyphs[index], cursor + width * 0.5, y);
      cursor += width;
    }
    if (
      this.appearanceStage.effect === "clock"
      && !this.clockSettings.behindText
    ) {
      drawClock();
    }
    if (frame?.showCellGrid === true) drawCellGridGuides(context, this.layout);
  }

  animationDuration() {
    return this.durationSeconds;
  }

  seek(time) {
    if (!Number.isFinite(time) || time < 0) return false;
    this.setTime(time, true);
    return true;
  }

  contentBounds() {
    return {
      x: this.layout.offsetX,
      y: this.layout.offsetY,
      width: this.layout.patternWidth,
      height: this.layout.patternHeight,
    };
  }

  countdownNoisePreviewSnapshot({ previewWidth, previewHeight } = {}) {
    if (!this.framePlan || !this.frameNoiseSettings.enabled) return null;
    const dense = Number.isFinite(previewWidth) && Number.isFinite(previewHeight);
    const width = dense
      ? Math.max(2, Math.trunc(previewWidth))
      : this.framePlan.gridColumns;
    const height = dense
      ? Math.max(2, Math.trunc(previewHeight))
      : this.framePlan.gridRows;
    const localTime = this.elapsed % this.durationSeconds;
    const visibility = dense
      ? this.frameNoiseSampler.samplePlane({
        name: "visibility",
        width,
        height,
        progress: localTime / this.durationSeconds,
        timeSeconds: localTime,
        temporalOffset: this.frameNoiseTemporalOffset,
        projectSeed: this.projectSeed,
        settings: this.frameNoiseSettings,
      }).data
      : this.frameVisibilityPlane?.data.slice();
    if (!visibility) return null;
    const flicker = new Uint8Array(width * height);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const x = (column + 0.5) / width * this.framePlan.gridColumns;
        const y = (row + 0.5) / height * this.framePlan.gridRows;
        flicker[row * width + column] = Math.round(
          this.frameFlicker.sampleAt(x, y, this.elapsed) * 255,
        );
      }
    }
    return {
      dimensions: {
        columns: this.framePlan.gridColumns,
        rows: this.framePlan.gridRows,
      },
      fields: [
        {
          id: "frame-visibility",
          label: "frame visibility",
          data: visibility,
          width,
          height,
        },
        {
          id: "flicker-color",
          label: `flicker color (${this.frameFlicker.modeName})`,
          data: flicker,
          width,
          height,
          palette: [...this.framePalette],
        },
      ],
    };
  }

  inspect() {
    return {
      generatorInstanceId: this.generatorInstanceId,
      generatorType: "countdown-framed",
      settingsKey: this.settingsKey,
      active: this.active,
      elapsed: this.elapsed,
      tick: this.tick,
      remainingSeconds: this.remainingSeconds,
      label: this.label,
      reveal: {
        step: this.revealStep,
        stepCount: this.revealStepCount,
        stepSeconds: this.revealStepSeconds,
        durationSeconds: this.revealDuration.seconds,
        authoredDuration: this.revealDuration.authored,
        durationSource: this.revealDuration.source,
        durationMultiplier: this.revealDuration.multiplier,
        palette: [...this.palette],
        paletteIndices: [...this.paletteIndices],
      },
      appearance: {
        seed: this.snakeSettings.seed,
        evolveSeed: this.snakeSettings.evolveSeed,
        minimumCellDistance: this.snakeSettings.minimumCellDistance,
        order: {
          stages: this.appearanceOrderSettings.stageDefinitions.map(
            stage => ({ ...stage }),
          ),
          stageDurationSeconds: this.appearanceOrderSettings.stageDurationSeconds,
          evolutionStartsAt: this.appearanceStage.evolutionStartsAt,
          activeEffect: this.appearanceStage.effect,
          nextEffect: this.appearanceStage.nextEffect,
          stageIndex: this.appearanceStage.index,
          phase: this.appearanceStage.phase,
          evolutionEnabled: this.appearanceStage.evolutionEnabled,
          stageProgress: this.appearanceStage.stageProgress,
          phaseProgress: this.appearanceStage.phaseProgress,
          evolutionProgress: this.appearanceStage.evolutionProgress,
        },
        snake: {
          enabled: this.snakeSettings.enabled,
          paletteName: this.snakeSettings.palette,
          palette: [...this.snakePalette],
          durationSeconds: this.snakeSettings.duration.seconds,
          durationSource: this.snakeSettings.duration.source,
          timingCurve: [...this.snakeSettings.timingCurve],
          baseLengthCells: this.snakeSettings.lengthCells,
          lengthCells: this.snakeFrameSettings?.lengthCells
            ?? this.snakeSettings.lengthCells,
          maximumLengthCells: this.availableSnakeCellCount,
          growAfterEachTick: this.snakeSettings.growAfterEachTick,
          mergeIntoBubbles: this.snakeSettings.mergeIntoBubbles,
          mergeActive: this.snakeMergeActive,
          mergeTick: this.snakeMergeTick,
          bubbleClearanceInCells: this.snakeSettings.bubbleClearanceInCells,
          maximumSubdivisionLevel: this.snakeSettings.maximumSubdivisionLevel,
          handoff: this.snakeHandoff === null ? null : {
            tick: this.snakeHandoff.tick,
            boundaryProgress: this.snakeHandoff.boundaryProgress,
            sourceIndex: this.snakeHandoff.plan.sourceIndex,
            cells: this.snakeHandoff.frame.cells.map(cell => ({ ...cell })),
          },
          plan: this.snakePlan === null ? null : {
            seed: this.snakePlan.seed,
            sourceCellIndex: this.snakePlan.sourceCellIndex,
            targetCellIndex: this.snakePlan.targetCellIndex,
            sourceIndex: this.snakePlan.sourceIndex,
            targetIndex: this.snakePlan.targetIndex,
            textSafeCellIndices: [...this.snakePlan.textSafeCellIndices],
            path: [...this.snakePlan.path],
          },
          frame: this.snakeFrame === null ? null : {
            linearProgress: this.snakeFrame.linearProgress,
            progress: this.snakeFrame.progress,
            headStep: this.snakeFrame.headStep,
            cells: this.snakeFrame.cells.map(cell => ({ ...cell })),
          },
          renderFrame: this.snakeRenderFrame === null ? null : {
            linearProgress: this.snakeRenderFrame.linearProgress,
            progress: this.snakeRenderFrame.progress,
            headStep: this.snakeRenderFrame.headStep,
            cells: this.snakeRenderFrame.cells.map(cell => ({ ...cell })),
          },
        },
        clock: {
          enabled: this.clockSettings.enabled,
          seed: this.clockSettings.seed,
          evolveSeed: this.clockSettings.evolveSeed,
          paletteName: this.clockSettings.palette,
          palette: [...this.clockPalette],
          durationSeconds: this.clockSettings.duration.seconds,
          durationSource: this.clockSettings.duration.source,
          timingCurve: [...this.clockSettings.timingCurve],
          subdivisionLevel: this.clockSettings.subdivisionLevel,
          subdivisions: 1 << this.clockSettings.subdivisionLevel,
          squareCount: this.clockSettings.squareCount,
          dotsPerSquare: this.clockSettings.dotsPerSquare,
          dotCount: this.clockSettings.squareCount * this.clockSettings.dotsPerSquare,
          behindText: this.clockSettings.behindText,
          evolutionSquareSizes: [...this.clockSettings.evolutionSquareSizes],
          rangeInSubdivisions: { ...this.clockSettings.rangeInSubdivisions },
          textSafeZone: { ...this.clockSettings.textSafeZone },
          minimumSquareGapInSubdivisions:
            this.clockSettings.minimumSquareGapInSubdivisions,
          flicker: this.clockFlicker.inspect(),
          plan: this.clockPlan === null ? null : {
            seed: this.clockPlan.seed,
            tick: this.clockPlan.tick,
            cellIndex: this.clockPlan.textCellIndex,
            gridColumns: this.clockPlan.gridColumns,
            gridRows: this.clockPlan.gridRows,
            handoffCellIndex: this.clockPlan.handoffCellIndex,
            evolutionMode: this.clockPlan.evolutionMode,
            evolutionProgress: this.clockPlan.evolutionProgress,
            squareSize: this.clockPlan.squareSize,
            maximumSquareSize: this.clockPlan.maximumSquareSize,
            reservationExpansion: this.clockPlan.reservationExpansion,
            snakeOriginBounds: this.clockPlan.snakeOriginBounds
              ? { ...this.clockPlan.snakeOriginBounds }
              : null,
            textSafeZone: { ...this.clockPlan.textSafeZone },
            minimumSquareGapInSubdivisions:
              this.clockPlan.minimumSquareGapInSubdivisions,
            squares: this.clockPlan.squares.map(square => ({
              squareIndex: square.squareIndex,
              offsetX: square.offsetX,
              offsetY: square.offsetY,
              topLeftColumn: square.topLeftColumn,
              topLeftRow: square.topLeftRow,
              reservation: square.reservation
                ? { ...square.reservation }
                : null,
              dots: square.dots.map(dot => ({ ...dot })),
            })),
            dots: this.clockPlan.dots.map(dot => ({ ...dot })),
          },
          frame: this.clockFrame === null ? null : {
            linearProgress: this.clockFrame.linearProgress,
            progress: this.clockFrame.progress,
            visibleCount: this.clockFrame.visibleCount,
            visiblePerSquare: this.clockFrame.visiblePerSquare,
            totalDotCount: this.clockFrame.totalDotCount,
            evolutionMode: this.clockFrame.evolutionMode,
            evolutionProgress: this.clockFrame.evolutionProgress,
            squareSize: this.clockFrame.squareSize,
            dots: this.clockFrame.dots.map(dot => ({ ...dot })),
          },
        },
        frame: {
          stageName: "bubbles",
          enabled: this.frameSettings.enabled,
          paletteName: this.frameSettings.palette,
          palette: [...this.framePalette],
          subdivisionLevel: this.frameSettings.subdivisionLevel,
          subdivisions: 1 << this.frameSettings.subdivisionLevel,
          baseSquareCount: this.frameSettings.squareCount,
          squareCount: this.framePlan?.squares.length ?? this.frameSettings.squareCount,
          requestedSquareCount: this.framePlan?.requestedSquareCount
            ?? this.frameSettings.squareCount,
          maximumSquareCount: this.framePlan?.maximumSquareCount
            ?? countdownFrameSquareCapacity(
              this.layout,
              this.frameSettings.subdivisionLevel,
            ),
          evolveSquareCount: this.frameSettings.evolveSquareCount,
          dotsPerSquare: this.frameSettings.dotsPerSquare,
          dotCount: (this.framePlan?.squares.length ?? this.frameSettings.squareCount)
            * this.frameSettings.dotsPerSquare,
          renderedSquareCount: this.frameRenderPlan?.squares.length
            ?? this.frameSettings.squareCount,
          renderedDotCount: (this.frameRenderPlan?.squares.length
            ?? this.frameSettings.squareCount) * this.frameSettings.dotsPerSquare,
          numberSpacingInSubdivisions: this.frameSettings.numberSpacingInSubdivisions,
          avoidance: {
            radiusInCells: this.frameSettings.avoidance.radiusInCells,
            radiusAtEndInCells: this.frameSettings.avoidance.radiusAtEndInCells,
            currentRadiusInCells: this.frameAvoidanceRadiusInCells,
            durationBeats: this.frameSettings.avoidance.durationBeats,
            timingCurve: [...this.frameSettings.avoidance.timingCurve],
            radiusGrowthTimingCurve: [
              ...this.frameSettings.avoidance.radiusGrowthTimingCurve,
            ],
            bubbles: this.frameAvoidanceBubbles.map(bubble => ({
              sourceTick: bubble.sourceTick,
              sourceCellIndex: bubble.sourceCellIndex,
              ageBeats: bubble.ageBeats,
              radiusInCells: bubble.radiusInCells,
              phase: bubble.phase,
              emptyEnvelope: bubble.emptyEnvelope,
              refillEnvelope: bubble.refillEnvelope,
              circles: bubble.circles.map(circle => ({ ...circle })),
            })),
          },
          growTowardZero: this.frameSettings.growTowardZero,
          growthTimingCurve: [...this.frameSettings.growthTimingCurve],
          growthProgress: this.frameGrowthProgress,
          radius: countdownFrameRadiusAt(
            this.layout,
            this.frameSettings,
            this.frameGrowthProgress,
          ),
          flicker: this.frameFlicker.inspect(),
          visibilityNoise: {
            enabled: this.frameNoiseSettings.enabled,
            edgeWidthInSquares: this.frameNoiseEdgeWidth,
            mode: this.frameNoiseSettings.layers.visibility.mode,
            scale: this.frameNoiseSettings.layers.visibility.scale,
            contrast: this.frameNoiseSettings.layers.visibility.contrast,
            seed: this.frameNoiseSettings.layers.visibility.seed,
            threshold: this.frameNoiseSettings.layers.visibility.threshold,
            softness: this.frameNoiseSettings.layers.visibility.softness,
            cyclesPerLoop: this.frameNoiseSettings.layers.visibility.cyclesPerLoop,
            beatWiggleDistance: this.frameSettings.visibilityNoiseMotion
              .beatWiggleDistance,
            beatWiggleTimingCurve: [
              ...this.frameSettings.visibilityNoiseMotion.timingCurve,
            ],
            beatWigglePhase: this.frameNoiseWigglePhase,
            temporalOffset: this.frameNoiseTemporalOffset,
            dimensions: this.frameVisibilityPlane === null ? null : {
              width: this.frameVisibilityPlane.width,
              height: this.frameVisibilityPlane.height,
            },
          },
          merge: {
            active: this.snakeBubblePlan !== null,
            phase: this.snakeBubblePlan === null
              ? "inactive"
              : (this.appearanceStage.effect === "snake" ? "entering" : "roaming"),
            progress: this.snakeBubblePlan?.progress ?? 0,
            sourceTick: this.snakeBubblePlan?.tick ?? null,
            trailSquareCount: this.snakeBubblePlan?.squares.length ?? 0,
            availableTrailSquareCount: this.snakeBubblePlan?.availableSquareCount ?? 0,
            overlapSquareCount: this.frameRenderPlan?.trailOverlapCount ?? 0,
            renderedSquareCount: this.frameRenderPlan?.squares.length ?? 0,
            exclusionCircleCount: this.snakeBubbleExclusionCircles.length,
            textSafeRectangle: this.frameTextSafeRectangle === null
              ? null
              : { ...this.frameTextSafeRectangle },
            textSafeHiddenSquareCount:
              this.snakeBubbleFrame?.rectangleAvoidedSquareCount ?? 0,
            visibleDotCount: this.snakeBubbleFrame?.visibleCount ?? 0,
            frame: this.snakeBubbleFrame === null ? null : {
              visibleCount: this.snakeBubbleFrame.visibleCount,
              avoidedSquareCount: this.snakeBubbleFrame.avoidedSquareCount,
              textSafeHiddenSquareCount:
                this.snakeBubbleFrame.rectangleAvoidedSquareCount,
              dots: this.snakeBubbleFrame.dots.map(dot => ({ ...dot })),
            },
            trailSquares: this.snakeBubblePlan?.squares.map(square => ({
              squareIndex: square.squareIndex,
              tileIndex: square.tileIndex,
              sourceCellIndex: square.sourceCellIndex,
              sourceLevel: square.sourceLevel,
              topLeftColumn: square.topLeftColumn,
              topLeftRow: square.topLeftRow,
              dots: square.dots.map(dot => ({ ...dot })),
            })) ?? [],
          },
          plan: this.framePlan === null ? null : {
            seed: this.framePlan.seed,
            tick: this.framePlan.tick,
            planStartTick: this.framePlan.planStartTick,
            evolutionEnabled: this.framePlan.evolutionEnabled,
            evolutionTick: this.framePlan.evolutionTick,
            evolutionTickCount: this.framePlan.evolutionTickCount,
            cellIndex: this.framePlan.textCellIndex,
            subdivisions: this.framePlan.subdivisions,
            gridColumns: this.framePlan.gridColumns,
            gridRows: this.framePlan.gridRows,
            requestedSquareCount: this.framePlan.requestedSquareCount,
            constrainedSquareCount: this.framePlan.constrainedSquareCount,
            maximumSquareCount: this.framePlan.maximumSquareCount,
            retainedSquareCount: this.framePlan.retainedSquareCount,
            addedSquareCount: this.framePlan.addedSquareCount,
            digitCircles: this.framePlan.digitCircles.map(circle => ({ ...circle })),
            squares: this.framePlan.squares.map(square => ({
              squareIndex: square.squareIndex,
              tileIndex: square.tileIndex,
              appearanceTick: square.appearanceTick,
              targetDigitIndex: square.targetDigitIndex,
              topLeftColumn: square.topLeftColumn,
              topLeftRow: square.topLeftRow,
              gap: square.gap,
              edgeDistance: square.edgeDistance,
              dots: square.dots.map(dot => ({ ...dot })),
            })),
            dots: this.framePlan.dots.map(dot => ({ ...dot })),
          },
          frame: this.frameFrame === null ? null : {
            linearProgress: this.frameFrame.linearProgress,
            progress: this.frameFrame.progress,
            visibleCount: this.frameFrame.visibleCount,
            avoidedSquareCount: this.frameFrame.avoidedSquareCount,
            eligibleVisibleCount: this.frameFrame.eligibleVisibleCount,
            snakeHiddenCount: this.frameFrame.snakeHiddenCount,
            noiseHiddenCount: this.frameFrame.noiseHiddenCount,
            dots: this.frameFrame.dots.map(dot => ({ ...dot })),
          },
        },
      },
      cellIndex: this.cellIndex,
      cell: {
        column: this.cellIndex % this.layout.columns,
        row: Math.floor(this.cellIndex / this.layout.columns),
      },
      layout: { ...this.layout },
      animationDuration: this.animationDuration(),
    };
  }

  dispose() {
    this.active = false;
    this.disposed = true;
  }
}
