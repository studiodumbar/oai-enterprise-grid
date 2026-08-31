import { debug } from "../debug/index.js";
import { CompositionTimelineDebug } from "../debug/composition-timeline.js";
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
  countdownSynthAt,
  countdownSynthEffectTicks,
  countdownSynthSeed,
  countdownSynthStageAt,
  countdownSnakeToBubblesAt,
  createCountdownConnectorRegistry,
  createCountdownEffectRegistry,
  resolveCountdownSynth,
  sortCountdownRenderLayers,
} from "../countdown-effect-synth/index.js";
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
  countdownSnakeBubblePlan,
  drawCountdownFrame,
  resolveCountdownFrameSettings,
} from "../countdown-appearance-effects/frame.js";
import { drawCountdownBubblesDebug } from "../countdown-appearance-effects/bubbles-debug.js";
import { createFlicker } from "../visuals/flicker/index.js";
import {
  countdownAppearanceSeed,
  countdownSnakeEngorgementFrame,
  countdownSnakeFrame,
  countdownSnakeLengthAt,
  countdownSnakePath,
  countdownSnakeTextSafeCells,
  createCountdownSnakeEngorgementPlan,
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

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

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

function countdownTimelineDebugItems(synthSettings) {
  const connectionsBySource = new Map();
  for (const connection of synthSettings.connections) {
    const connections = connectionsBySource.get(connection.from) ?? [];
    connections.push(connection);
    connectionsBySource.set(connection.from, connections);
  }
  return synthSettings.tracks.flatMap(track => [
    { id: `track:${track.id}`, label: track.use.toUpperCase() },
    ...(connectionsBySource.get(track.id) ?? []).map(connection => ({
      id: `connection:${connection.id}`,
      label: `${connection.fromTrack.use.toUpperCase()}→${connection.toTrack.use.toUpperCase()}`,
    })),
  ]);
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
    if (cycleLength === 0 || targetTick >= cycleLength) {
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
    this.effectRegistry = createCountdownEffectRegistry();
    this.connectorRegistry = createCountdownConnectorRegistry();
    try {
      this.synthSettings = resolveCountdownSynth(
        options.appearance,
        this.durationSeconds,
        {
          effectRegistry: this.effectRegistry,
          connectorRegistry: this.connectorRegistry,
        },
      );
    } catch (error) {
      debug.config(
        "countdown-synth resolution=failed error=%s",
        error?.message ?? "unknown",
      );
      throw error;
    }
    this.synthEffectUses = new Set(
      this.synthSettings.tracks.map(track => track.use),
    );
    this.hasClockTrack = this.synthEffectUses.has("clock");
    this.hasSnakeTrack = this.synthEffectUses.has("snake");
    this.hasBubblesTrack = this.synthEffectUses.has("bubbles");
    this.clockSnakeConnection = this.synthSettings.connections.find(
      connection => connection.use === "clock-to-snake",
    ) ?? null;
    this.hasClockSnakeConnector = this.clockSnakeConnection !== null;
    this.snakeBubblesConnection = this.synthSettings.connections.find(
      connection => connection.use === "snake-to-bubbles",
    ) ?? null;
    this.hasSnakeBubblesConnector = this.snakeBubblesConnection !== null;
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
    this.shortSideParity = options.shortSideParity ?? "odd";
    if (!["odd", "any"].includes(this.shortSideParity)) {
      throw new RangeError(
        'countdownFramed.shortSideParity must be either "odd" or "any".',
      );
    }
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
    const sharedAppearance = requireObject(
      this.synthSettings.shared,
      "countdownFramed.appearance.shared",
    );
    this.appearanceSeed = requireNonNegativeInteger(
      sharedAppearance.seed,
      "countdownFramed.appearance.shared.seed",
    ) >>> 0;
    if (typeof sharedAppearance.evolveSeed !== "boolean") {
      throw new TypeError("countdownFramed.appearance.shared.evolveSeed must be a boolean.");
    }
    this.appearanceEvolveSeed = sharedAppearance.evolveSeed;
    this.minimumCellDistance = requireNonNegativeInteger(
      sharedAppearance.minimumCellDistance,
      "countdownFramed.appearance.shared.minimumCellDistance",
    );
    if (this.minimumCellDistance < 3) {
      throw new RangeError(
        "countdownFramed.appearance.shared.minimumCellDistance must be at least three.",
      );
    }
    const sharedTextSafeZone = requireObject(
      sharedAppearance.textSafeZone,
      "countdownFramed.appearance.shared.textSafeZone",
    );
    this.textSafeZone = Object.freeze({
      widthInCells: requireFinitePositive(
        sharedTextSafeZone.widthInCells,
        "countdownFramed.appearance.shared.textSafeZone.widthInCells",
      ),
      heightInCells: requireFinitePositive(
        sharedTextSafeZone.heightInCells,
        "countdownFramed.appearance.shared.textSafeZone.heightInCells",
      ),
    });
    const authoredTracksByUse = new Map(
      options.appearance.synth.tracks.map(track => [track.use, track]),
    );
    const effectSettings = (use, legacyKey) => {
      const track = authoredTracksByUse.get(use);
      return track && Object.hasOwn(track, "settings")
        ? track.settings
        : options.appearance?.effects?.[legacyKey];
    };
    const effectAppearance = (use, legacyKey) => ({
      ...sharedAppearance,
      effects: { [legacyKey]: effectSettings(use, legacyKey) },
    });
    const noiseFunction = typeof runtime.p5?.noise === "function"
      ? runtime.p5.noise.bind(runtime.p5)
      : undefined;

    this.snakeSettings = this.hasSnakeTrack
      ? resolveCountdownSnakeSettings(
        effectAppearance("snake", "snake"),
        this.tickSeconds,
      )
      : null;
    this.snakePalette = this.snakeSettings === null
      ? null
      : countdownPalette({ palette: this.snakeSettings.palette }, palettes);
    this.snakeFlicker = this.snakeSettings === null
      ? null
      : createFlicker({
        palette: this.snakePalette,
        settings: options.flicker,
        noiseFunction,
        autoCycleSeconds: this.tickSeconds,
      }).useMode(this.snakeSettings.engorgement.deathFlicker.mode);
    this.clockSettings = this.hasClockTrack
      ? resolveCountdownClockSettings(
        effectAppearance("clock", "clock"),
        this.tickSeconds,
      )
      : null;
    this.clockBirthRippleWindow = null;
    if (
      this.clockSettings?.birthRipple.enabled === true
      && this.clockSnakeConnection !== null
    ) {
      const durationSeconds = this.clockSettings.birthRipple.durationBeats
        * this.tickSeconds;
      const startBeforeHandoffSeconds = this.clockSettings.birthRipple
        .startBeforeHandoffBeats * this.tickSeconds;
      const handoffSeconds = this.clockSnakeConnection.endSeconds;
      const startSeconds = handoffSeconds - startBeforeHandoffSeconds;
      const endSeconds = startSeconds + durationSeconds;
      if (startSeconds < this.clockSnakeConnection.startSeconds - 1e-9) {
        throw new RangeError(
          "countdownFramed.appearance.effects.clock.birthRipple."
          + "startBeforeHandoffBeats cannot exceed the clock-to-snake "
          + "connector window.",
        );
      }
      if (endSeconds > this.clockSnakeConnection.toTrack.endSeconds + 1e-9) {
        throw new RangeError(
          "countdownFramed.appearance.effects.clock.birthRipple.durationBeats "
          + "must finish before the destination snake track ends.",
        );
      }
      this.clockBirthRippleWindow = Object.freeze({
        startSeconds,
        endSeconds,
        durationSeconds,
        handoffSeconds,
        startBeforeHandoffSeconds,
      });
    }
    this.clockPalette = this.clockSettings === null
      ? null
      : countdownPalette({ palette: this.clockSettings.palette }, palettes);
    this.clockFlicker = this.clockSettings === null
      ? null
      : createFlicker({
        palette: this.clockPalette,
        settings: options.flicker,
        noiseFunction,
        autoCycleSeconds: this.tickSeconds,
      });
    this.frameSettings = this.hasBubblesTrack
      ? resolveCountdownFrameSettings(effectAppearance("bubbles", "frame"))
      : null;
    this.frameNoiseEdgeWidth = 0;
    this.frameNoiseModes = null;
    this.frameNoiseSettings = null;
    this.frameNoiseSampler = null;
    this.framePalette = null;
    this.frameFlicker = null;
    if (this.frameSettings !== null) {
      const authoredFrameNoise = effectSettings("bubbles", "frame")?.noiseFields;
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
          "Countdown framed frame visibility noise requires holdSeconds to be zero.",
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
        noiseFunction,
        autoCycleSeconds: this.tickSeconds,
      });
    }
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
      "countdown-synth tracks=%s connections=%s",
      this.synthSettings.tracks
        .map(track => `${track.id}:${track.use}@${track.startSeconds}+${track.durationSeconds}`)
        .join(","),
      this.synthSettings.connections
        .map(connection => `${connection.id}:${connection.use}`)
        .join(","),
    );
    const authoredSeed = Number(runtime.projectSeed?.() ?? 0);
    this.projectSeed = Number.isInteger(authoredSeed) && authoredSeed >= 0
      ? authoredSeed >>> 0
      : 0;
    this.effectInstances = new Map(this.synthSettings.tracks.map(track => [
      track.id,
      this.effectRegistry.create(track.use, {
        host: this,
        track,
        seed: countdownSynthSeed(
          this.projectSeed,
          track.id,
          track.descriptor.seedSalt,
        ),
      }),
    ]));
    this.connectorInstances = new Map(this.synthSettings.connections.map(connection => [
      connection.id,
      this.connectorRegistry.create(connection.use, {
        host: this,
        connection,
      }),
    ]));
    debug.config(
      "countdown-synth resolution=ok tracks=%d connections=%d duration=%.3f",
      this.synthSettings.tracks.length,
      this.synthSettings.connections.length,
      this.synthSettings.totalDurationSeconds,
    );
    if (this.snakeSettings !== null) {
      debug.config(
        "countdown-effect mode=snake enabled=%s seed=%d evolve=%s distance=%d palette=%s duration=%.3f cells=%d grow=%s mergeBubbles=%s engorgement=%s growthMode=%s growthStartProgress=%.3f mealRevealBeats=%.3f mealPulseScale=%.3f mealPulseCurve=%j deathFlicker=%s deathFlickerBeats=%.3f deathFlickerMode=%s curve=%j",
        this.snakeSettings.enabled ? "yes" : "no",
        this.snakeSettings.seed,
        this.snakeSettings.evolveSeed ? "yes" : "no",
        this.snakeSettings.minimumCellDistance,
        this.snakeSettings.palette,
        this.snakeSettings.duration.seconds,
        this.snakeSettings.lengthCells,
        this.snakeSettings.growAfterEachTick ? "yes" : "no",
        this.snakeSettings.mergeIntoBubbles ? "yes" : "no",
        this.snakeSettings.engorgement.enabled ? "yes" : "no",
        this.snakeSettings.engorgement.growthMode,
        this.snakeSettings.engorgement.growthStartProgress,
        this.snakeSettings.engorgement.mealRevealBeforeEndBeats,
        this.snakeSettings.engorgement.mealPulseScale,
        this.snakeSettings.engorgement.mealPulseTimingCurve,
        this.snakeSettings.engorgement.deathFlicker.enabled ? "yes" : "no",
        this.snakeSettings.engorgement.deathFlicker.beforeEndBeats,
        this.snakeFlicker.modeName,
        this.snakeSettings.timingCurve,
      );
    } else {
      debug.config("countdown-effect mode=snake enabled=no reason=no-track");
    }
    if (this.clockSettings !== null) {
      debug.config(
        "countdown-effect mode=clock enabled=%s seed=%d evolveSeed=%s palette=%s duration=%.3f level=%d squares=%d dotsPerSquare=%d travelingStaggerBeats=%.3f waterfall=%s waterfallBothCells=%s clockProbability=%.3f farSeparation=%s farSeparationProbability=%.3f birthRipple=%s rippleStartBeforeHandoffBeats=%.3f rippleDurationBeats=%.3f rippleWakeCells=%.3f rippleSecondaryRadiusCells=%.3f rippleCurve=%j rippleFlicker=%s rippleFlickerProbability=%.3f rippleFlickerDecayCells=%.3f rippleFlickerFlashesPerBeat=%d rippleFlickerMinimumOpacity=%.3f behindText=%s evolutionSizes=%j rangeX=%d rangeY=%d safeWidthCells=%.3f safeHeightCells=%.3f squareGap=%d curve=%j",
        this.clockSettings.enabled ? "yes" : "no",
        this.clockSettings.seed,
        this.clockSettings.evolveSeed ? "yes" : "no",
        this.clockSettings.palette,
        this.clockSettings.duration.seconds,
        this.clockSettings.subdivisionLevel,
        this.clockSettings.squareCount,
        this.clockSettings.dotsPerSquare,
        this.clockSettings.travelingSquareStaggerBeats,
        this.clockSettings.sizeWaterfall.enabled ? "yes" : "no",
        this.clockSettings.sizeWaterfall.bothCells ? "yes" : "no",
        this.clockSettings.sizeWaterfall.clockProbability,
        this.clockSettings.farSeparation.enabled ? "yes" : "no",
        this.clockSettings.farSeparation.probability,
        this.clockSettings.birthRipple.enabled ? "yes" : "no",
        this.clockSettings.birthRipple.startBeforeHandoffBeats,
        this.clockSettings.birthRipple.durationBeats,
        this.clockSettings.birthRipple.wakeDepthInCells,
        this.clockSettings.birthRipple.secondaryRadiusInCells,
        this.clockSettings.birthRipple.radialTimingCurve,
        this.clockSettings.birthRipple.wakeFlicker.enabled ? "yes" : "no",
        this.clockSettings.birthRipple.wakeFlicker.probability,
        this.clockSettings.birthRipple.wakeFlicker.distanceDecayInCells,
        this.clockSettings.birthRipple.wakeFlicker.flashesPerBeat,
        this.clockSettings.birthRipple.wakeFlicker.minimumOpacity,
        this.clockSettings.behindText ? "yes" : "no",
        this.clockSettings.evolutionSquareSizes,
        this.clockSettings.rangeInSubdivisions.x,
        this.clockSettings.rangeInSubdivisions.y,
        this.clockSettings.textSafeZone.widthInCells,
        this.clockSettings.textSafeZone.heightInCells,
        this.clockSettings.minimumSquareGapInSubdivisions,
        this.clockSettings.timingCurve,
      );
    } else {
      debug.config("countdown-effect mode=clock enabled=no reason=no-track");
    }
    if (this.frameSettings !== null) {
      debug.config(
        "countdown-effect mode=bubbles enabled=%s seed=%d evolveSeed=%s evolveSquares=%s palette=%s level=%d squares=%d dotsPerSquare=%d avoidanceRadiusStartCells=%.3f avoidanceRadiusEndCells=%.3f avoidanceBeats=%.3f numberSpacing=%.3f grow=%s avoidanceCurve=%j avoidanceRadiusCurve=%j growthCurve=%j",
        this.frameSettings.enabled ? "yes" : "no",
        this.appearanceSeed,
        this.appearanceEvolveSeed ? "yes" : "no",
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
      debug.config(
        "countdown-effect mode=bubbles-debug visualize=%s opacity=%.3f",
        this.frameSettings.debug.visualizeBubbles ? "yes" : "no",
        this.frameSettings.debug.opacity,
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
    } else {
      debug.config("countdown-effect mode=bubbles enabled=no reason=no-track");
    }

    this.active = false;
    this.disposed = false;
    this.elapsed = 0;
    this.tick = -1;
    this.revealStep = -1;
    this.paletteIndices = [];
    this.remainingSeconds = this.countFromSeconds;
    this.label = formatCountdown(this.remainingSeconds);
    this.cellIndex = 0;
    this.appearanceStage = countdownSynthStageAt(0, this.synthSettings);
    this.synthState = countdownSynthAt(0, this.synthSettings);
    this.timelineDebug = new CompositionTimelineDebug({
      compositionId: "countdown-framed",
      items: countdownTimelineDebugItems(this.synthSettings),
      accentColor: this.palette.at(-2) ?? this.palette.at(-1),
    });
    this.renderLayers = [];
    this.previousActiveTrackIds = new Set();
    this.previousActiveConnectionIds = new Set();
    this.renderLayerSignature = "";
    this.snakePlan = null;
    this.snakeFrame = null;
    this.snakeRenderFrame = null;
    this.snakeFrameSettings = null;
    this.snakeGrowthTick = 0;
    this.snakeConnectorProgress = 0;
    this.clockSnakeHandoff = null;
    this.snakeHandoff = null;
    this.snakeEngorgementPlan = null;
    this.snakeEngorgementFrame = null;
    this.snakeDeathSnapshot = null;
    this.snakeFieldCommitState = "idle";
    this.snakeBubblePlan = null;
    this.snakeBubbleFrame = null;
    this.availableSnakeCellCount = 1;
    this.clockPlan = null;
    this.clockFrame = null;
    this.framePlan = null;
    this.frameRenderPlan = null;
    this.frameFrame = null;
    this.frameAvoidanceBubbles = [];
    this.frameAvoidanceCircles = [];
    this.frameTextSafeRectangle = null;
    this.frameAvoidanceRadiusInCells = this.frameSettings?.avoidance.radiusInCells ?? 0;
    this.frameVisibilityPlane = null;
    this.frameNoiseTemporalOffset = 0;
    this.frameNoiseWigglePhase = "out";
    this.frameGrowthProgress = 0;
    this.birthRippleDebugState = {
      primaryActive: false,
      echoActive: false,
      handoffActive: false,
      flickerStep: -1,
    };
    this.bubblesDebugActive = false;
    this.engorgementDebugState = {
      active: false,
      growthActive: false,
      deathFlickerActive: false,
      mealVisible: false,
      dead: false,
      committed: false,
      beatIndex: -1,
    };
    this.resize(runtime.viewport());
  }

  resize(viewport) {
    this.layout = createCircleGridSceneLayout(
      viewport,
      this.longSideCells,
      { shortSideParity: this.shortSideParity },
    );
    if (this.hasClockTrack) {
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
    } else {
      debug.config(
        "countdown-clock-layout columns=%d rows=%d safe=skipped reason=no-track",
        this.layout.columns,
        this.layout.rows,
      );
    }
    this.availableSnakeCellCount = Math.max(
      1,
      this.layout.columns * this.layout.rows - 2,
    );
    if (this.hasSnakeTrack) {
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
      this.prepareSnakeEngorgementPlan();
    } else {
      this.clockSnakeHandoff = null;
      this.snakeHandoff = null;
      this.snakeEngorgementPlan = null;
      this.snakeEngorgementFrame = null;
      this.snakeDeathSnapshot = null;
      debug.config(
        "countdown-snake-layout columns=%d rows=%d checkedTicks=0 safe=skipped reason=no-track",
        this.layout.columns,
        this.layout.rows,
      );
    }
    if (this.clockFlicker !== null) {
      this.clockFlicker.resize({
        columns: this.layout.columns,
        rows: this.layout.rows,
        cellSize: this.layout.cellSize,
        dotsPerCellAxis: 1 << this.clockSettings.subdivisionLevel,
      });
    }
    if (this.snakeFlicker !== null) {
      this.snakeFlicker.resize({
        columns: this.layout.columns,
        rows: this.layout.rows,
        cellSize: this.layout.cellSize,
        dotsPerCellAxis: 1 << this.snakeSettings.maximumSubdivisionLevel,
      });
    }
    if (this.frameFlicker !== null) {
      this.frameFlicker.resize({
        columns: this.layout.columns,
        rows: this.layout.rows,
        cellSize: this.layout.cellSize,
        dotsPerCellAxis: 1 << this.frameSettings.subdivisionLevel,
      });
    }
    for (const instance of this.effectInstances.values()) instance.resize(viewport);
    for (const instance of this.connectorInstances.values()) instance.resize(viewport);
    this.cellIndex = countdownCellIndex(
      this.projectSeed,
      Math.max(0, this.tick),
      this.layout,
      this.minimumCellDistance,
      this.countFromSeconds,
    );
    if (this.tick >= 0) {
      const localTime = this.elapsed % this.durationSeconds;
      if (this.hasSnakeTrack) {
        this.prepareSnakePlan(this.tick, false);
        this.snakeFrame = countdownSnakeFrame(
          this.snakePlan,
          this.snakeFrame?.linearProgress ?? 0,
          this.snakeFrameSettings,
        );
        this.prepareSnakeRenderFrame(localTime);
      }
      if (this.hasClockTrack) {
        this.prepareClockPlan(this.tick, false);
        this.clockFrame = countdownClockFrame(
          this.clockPlan,
          this.clockFrame?.linearProgress ?? 0,
          this.clockSettings,
          this.clockBirthRippleProgressAt(localTime),
        );
      }
      if (this.hasBubblesTrack) {
        this.prepareFramePlan(this.tick, false, true);
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
          [],
        );
      }
      this.rebuildCountdownRenderPlan(true);
    }
  }

  effectTicks(effect, tick) {
    const matchingTracks = this.synthSettings.tracks.filter(
      track => track.use === effect,
    );
    let selector = effect;
    if (matchingTracks.length > 1) {
      const stage = countdownSynthStageAt(
        tick * this.tickSeconds,
        this.synthSettings,
      );
      selector = matchingTracks.some(track => track.id === stage.trackId)
        ? stage.trackId
        : matchingTracks[0].id;
    }
    return countdownSynthEffectTicks(
      selector,
      tick,
      this.tickSeconds,
      this.countFromSeconds,
      this.synthSettings,
    );
  }

  connectorActiveAt(use, time) {
    return countdownSynthAt(time, this.synthSettings).activeConnections.some(
      state => state.connection.use === use,
    );
  }

  clockBirthRippleProgressAt(time) {
    const window = this.clockBirthRippleWindow;
    if (
      window === null
      || time < window.startSeconds
      || time >= window.endSeconds
    ) return null;
    return (time - window.startSeconds) / window.durationSeconds;
  }

  emitBirthRippleTransitions(localTime) {
    const primaryActive = this.clockFrame?.birthRipple !== null
      && this.clockFrame?.birthRipple !== undefined;
    const echoActive = primaryActive
      && this.clockFrame.birthRipple.secondary.active;
    const handoffActive = this.clockBirthRippleWindow !== null
      && localTime >= this.clockBirthRippleWindow.handoffSeconds
      && localTime < this.clockBirthRippleWindow.handoffSeconds + this.tickSeconds
      && this.appearanceStage.effect === "snake";
    if (primaryActive && !this.birthRippleDebugState.primaryActive) {
      debug.transition(
        "countdown-birth-ripple wave=primary state=start tick=%d cell=%d start=%.3f end=%.3f glyphShape=circle thinningLevel=3",
        this.tick,
        this.clockFrame.birthRipple.originCellIndex,
        this.clockBirthRippleWindow.startSeconds,
        this.clockBirthRippleWindow.endSeconds,
      );
    }
    if (!primaryActive && this.birthRippleDebugState.primaryActive) {
      debug.transition(
        "countdown-birth-ripple wave=primary state=end tick=%d at=%.3f",
        this.tick,
        this.clockBirthRippleWindow.endSeconds,
      );
    }
    if (echoActive && !this.birthRippleDebugState.echoActive) {
      debug.transition(
        "countdown-birth-ripple wave=text-echo state=start tick=%d cell=%d level=%d radius=%.3f",
        this.tick,
        this.clockFrame.birthRipple.secondary.originCellIndex,
        this.clockFrame.birthRipple.secondary.sourceLevel,
        this.clockFrame.birthRipple.secondary.activationRadiusInCells,
      );
    }
    if (handoffActive && !this.birthRippleDebugState.handoffActive) {
      debug.transition(
        "countdown-birth-ripple state=handoff tick=%d cell=%d snakeHead=%d",
        this.tick,
        this.clockPlan.handoffCellIndex,
        this.snakeFrame?.cells.at(-1)?.index ?? -1,
      );
    }
    const flicker = primaryActive
      ? this.clockFrame.birthRipple.primary.flicker
      : null;
    if (
      flicker?.enabled === true
      && flicker.step !== this.birthRippleDebugState.flickerStep
    ) {
      debug.transition(
        "countdown-birth-ripple flickerStep=%d eligible=%d triggered=%d probabilityMax=%.3f",
        flicker.step,
        flicker.eligibleCellCount,
        flicker.triggeredCellIndices.length,
        flicker.maximumProbability,
      );
    }
    this.birthRippleDebugState = {
      primaryActive,
      echoActive,
      handoffActive,
      flickerStep: flicker?.step ?? -1,
    };
  }

  snakeEngorgementAt(time) {
    if (this.snakeBubblesConnection === null) {
      return {
        connectorActive: false,
        connectorProgress: 0,
        snakeVisible: false,
        deathCommitted: false,
      };
    }
    return countdownSnakeToBubblesAt(time, this.snakeBubblesConnection);
  }

  snakeStateAt(tick) {
    const evolution = this.effectTicks("snake", tick);
    const growthEndTick = this.hasSnakeBubblesConnector
      ? Math.max(evolution.startTick, evolution.evolutionStartTick - 1)
      : evolution.endTick;
    const growthTick = Math.max(
      0,
      Math.min(tick, growthEndTick) - evolution.startTick,
    );
    const sourceCellIndex = countdownCellIndex(
      this.projectSeed,
      tick,
      this.layout,
      this.minimumCellDistance,
      this.countFromSeconds,
    );
    const lengthCells = countdownSnakeLengthAt(
      this.snakeSettings.lengthCells,
      growthTick,
      this.snakeSettings.growAfterEachTick && tick >= evolution.startTick,
      this.availableSnakeCellCount,
    );
    const frameSettings = { ...this.snakeSettings, lengthCells };
    // A one-second loop still needs a distinct snake destination even though
    // its only authored countdown tick loops back to itself.
    const destinationTick = this.countFromSeconds === 1
      ? 1
      : (tick + 1) % this.countFromSeconds;
    const targetCellIndex = countdownCellIndex(
      this.projectSeed,
      destinationTick,
      this.layout,
      this.minimumCellDistance,
      this.countFromSeconds === 1 ? null : this.countFromSeconds,
    );
    const seed = countdownAppearanceSeed(
      this.projectSeed,
      this.snakeSettings.seed,
      growthTick,
      this.snakeSettings.evolveSeed && evolution.evolutionEnabled,
    );
    const textSafeCellIndices = countdownSnakeTextSafeCells(
      this.layout,
      sourceCellIndex,
      this.textSafeZone,
    );
    const targetSafeCellIndices = countdownSnakeTextSafeCells(
      this.layout,
      targetCellIndex,
      this.textSafeZone,
    ).filter(index => index !== targetCellIndex);
    const blockedCellIndices = [
      ...new Set([...textSafeCellIndices, ...targetSafeCellIndices]),
    ];
    const pathBetweenCells = countdownSnakePath(
      this.layout,
      sourceCellIndex,
      targetCellIndex,
      seed,
      blockedCellIndices,
    );
    const path = pathBetweenCells.slice(1, -1);
    return {
      evolution,
      growthTick,
      frameSettings,
      plan: {
        seed,
        sourceCellIndex,
        targetCellIndex,
        sourceIndex: path[0],
        targetIndex: path.at(-1),
        path,
        textSafeCellIndices,
        blockedCellIndices,
      },
    };
  }

  prepareSnakeHandoff() {
    const snakeTicks = this.effectTicks("snake", 0);
    const startState = this.snakeStateAt(snakeTicks.startTick);
    this.clockSnakeHandoff = {
      tick: snakeTicks.startTick,
      plan: startState.plan,
    };
    const handoffTick = this.hasSnakeBubblesConnector
      ? Math.max(snakeTicks.startTick, snakeTicks.evolutionStartTick - 1)
      : snakeTicks.endTick;
    const state = this.snakeStateAt(handoffTick);
    const snakeWindowEndSeconds = (handoffTick + 1) * this.tickSeconds;
    const boundaryProgress = Math.max(0, Math.min(
      1,
      (snakeWindowEndSeconds - handoffTick * this.tickSeconds)
        / this.snakeSettings.duration.seconds,
    ));
    const frame = countdownSnakeFrame(
      state.plan,
      boundaryProgress,
      state.frameSettings,
    );
    this.snakeHandoff = {
      tick: handoffTick,
      boundaryProgress,
      plan: state.plan,
      frameSettings: state.frameSettings,
      frame,
    };
  }

  prepareSnakeEngorgementPlan() {
    if (
      !this.hasSnakeBubblesConnector
      || !this.snakeSettings.mergeIntoBubbles
      || !this.snakeSettings.engorgement.enabled
    ) {
      this.snakeEngorgementPlan = null;
      this.snakeEngorgementFrame = null;
      this.snakeDeathSnapshot = null;
      return;
    }
    const connection = this.snakeBubblesConnection;
    const beatCount = Math.ceil(connection.durationSeconds / this.tickSeconds);
    const safeCellsByBeat = Array.from({ length: beatCount + 1 }, (_, beatIndex) => {
      const boundaryTime = Math.min(
        connection.endSeconds,
        connection.startSeconds + beatIndex * this.tickSeconds,
      );
      const wrappedTime = boundaryTime % this.durationSeconds;
      const tick = Math.min(
        this.countFromSeconds - 1,
        Math.floor(wrappedTime / this.tickSeconds),
      );
      const cellIndex = countdownCellIndex(
        this.projectSeed,
        tick,
        this.layout,
        this.minimumCellDistance,
        this.countFromSeconds,
      );
      return countdownSnakeTextSafeCells(
        this.layout,
        cellIndex,
        this.textSafeZone,
      );
    });
    try {
      this.snakeEngorgementPlan = createCountdownSnakeEngorgementPlan({
        layout: this.layout,
        entryCells: this.snakeHandoff.frame.cells,
        safeCellsByBeat,
        seed: countdownAppearanceSeed(
          this.projectSeed,
          this.snakeSettings.seed,
          0,
          false,
        ),
        startSeconds: connection.startSeconds,
        endSeconds: connection.endSeconds,
        tickSeconds: this.tickSeconds,
        growthStartProgress:
          this.snakeSettings.engorgement.growthStartProgress,
        mealRevealBeforeEndBeats:
          this.snakeSettings.engorgement.mealRevealBeforeEndBeats,
      });
    } catch (error) {
      debug.config(
        "countdown-engorgement-plan state=failed columns=%d rows=%d error=%s",
        this.layout.columns,
        this.layout.rows,
        error?.message ?? "unknown",
      );
      throw error;
    }
    const finalFrame = countdownSnakeEngorgementFrame(
      this.snakeEngorgementPlan,
      1,
      this.snakeSettings,
    );
    const mealCell = {
      index: this.snakeEngorgementPlan.mealIndex,
      level: 0,
      food: true,
    };
    this.snakeDeathSnapshot = {
      consumedMealIndex: mealCell.index,
      cells: [...finalFrame.allBodyCells.map(cell => ({ ...cell })), mealCell],
    };
    debug.plan(
      "countdown-engorgement-plan state=created columns=%d rows=%d startLength=%d targetLength=%d capacityLength=%d meal=%d beats=%d routeSteps=%d growthStartProgress=%.3f growthStartStep=%d cruiseSteps=%d growthSteps=%d movementSteps=%d cycleCells=%d explored=%d collisions=%d wraps=%d",
      this.layout.columns,
      this.layout.rows,
      this.snakeEngorgementPlan.startLength,
      this.snakeEngorgementPlan.targetLength,
      this.snakeEngorgementPlan.capacityLength,
      this.snakeEngorgementPlan.mealIndex,
      this.snakeEngorgementPlan.beatCount,
      this.snakeEngorgementPlan.routeStepCount,
      this.snakeEngorgementPlan.growthStartProgress,
      this.snakeEngorgementPlan.growthStartStep,
      this.snakeEngorgementPlan.cruiseStepCount,
      this.snakeEngorgementPlan.movementStepCount
        - this.snakeEngorgementPlan.growthStartStep,
      this.snakeEngorgementPlan.movementStepCount,
      this.snakeEngorgementPlan.coverageCycle.length,
      this.snakeEngorgementPlan.exploredCount,
      this.snakeEngorgementPlan.collisionCount,
      this.snakeEngorgementPlan.wrapSteps.length,
    );
  }

  prepareSnakeRenderFrame(localTime) {
    const state = this.snakeEngorgementAt(localTime);
    this.snakeConnectorProgress = state.connectorProgress;
    if (state.connectorActive && this.snakeEngorgementPlan !== null) {
      this.snakeEngorgementFrame = countdownSnakeEngorgementFrame(
        this.snakeEngorgementPlan,
        state.connectorProgress,
        this.snakeSettings,
      );
      this.snakeRenderFrame = this.snakeEngorgementFrame;
      this.snakeFieldCommitState = "planning";
      return;
    }
    if (
      state.deathCommitted
      && this.appearanceStage.trackId === this.snakeBubblesConnection?.to
      && this.snakeDeathSnapshot !== null
    ) {
      this.snakeEngorgementFrame = countdownSnakeEngorgementFrame(
        this.snakeEngorgementPlan,
        1,
        this.snakeSettings,
      );
      this.snakeRenderFrame = { ...this.snakeEngorgementFrame, cells: [] };
      this.snakeFieldCommitState = "pending";
      return;
    }
    this.snakeEngorgementFrame = null;
    this.snakeRenderFrame = this.snakeFrame;
    this.snakeFieldCommitState = "idle";
  }

  prepareSnakePlan(tick, emitDebug = true) {
    const state = this.snakeStateAt(tick);
    this.snakeFrameSettings = state.frameSettings;
    this.snakeGrowthTick = state.growthTick;
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
        "countdown-effect mode=snake tick=%d evolution=%s evolutionTick=%d growthTick=%d engorgement=%s seed=%d length=%d maximum=%d cellFrom=%d cellTo=%d from=%d to=%d textSafeCells=%s path=%s",
        tick,
        state.evolution.evolutionEnabled ? "yes" : "no",
        state.evolution.evolutionTick,
        this.snakeGrowthTick,
        this.snakeEngorgementAt(tick * this.tickSeconds).connectorActive ? "yes" : "no",
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
    const evolution = this.effectTicks("clock", tick);
    const tickTime = tick * this.tickSeconds;
    const connectorActive = this.hasClockSnakeConnector
      && this.connectorActiveAt("clock-to-snake", tickTime);
    const connectorEvolutionComplete = connectorActive
      && tickTime >= this.clockSnakeConnection.evolution.endSeconds;
    const connectorEvolutionEnabled = connectorActive
      && (evolution.evolutionEnabled || connectorEvolutionComplete);
    const connectorEvolutionTick = connectorEvolutionComplete
      ? evolution.evolutionTickCount - 1
      : evolution.evolutionTick;
    const connectorEvolutionProgress = connectorEvolutionComplete
      ? 1
      : evolution.evolutionProgress;
    const seed = countdownAppearanceSeed(
      this.projectSeed,
      this.clockSettings.seed,
      connectorEvolutionTick,
      this.clockSettings.evolveSeed && connectorEvolutionEnabled,
    );
    const handoffCellIndex = this.clockSnakeHandoff?.plan.sourceIndex
      ?? countdownCellIndex(
        this.projectSeed,
        tick + 1,
        this.layout,
        this.minimumCellDistance,
      );
    const birthRippleTextCellIndex = this.clockBirthRippleWindow === null
      ? this.cellIndex
      : countdownCellIndex(
        this.projectSeed,
        Math.floor(this.clockBirthRippleWindow.startSeconds / this.tickSeconds),
        this.layout,
        this.minimumCellDistance,
        this.countFromSeconds,
      );
    this.clockPlan = countdownClockPlan({
      seed,
      tick,
      layout: this.layout,
      cellIndex: this.cellIndex,
      subdivisionLevel: this.clockSettings.subdivisionLevel,
      squareCount: this.clockSettings.squareCount,
      dotsPerSquare: this.clockSettings.dotsPerSquare,
      travelingSquareStaggerBeats:
        this.clockSettings.travelingSquareStaggerBeats,
      farSeparationProbability: this.clockSettings.farSeparation.enabled
        ? this.clockSettings.farSeparation.probability
        : 0,
      evolutionSquareSizes: this.clockSettings.evolutionSquareSizes,
      evolutionEnabled: connectorEvolutionEnabled,
      evolutionProgress: connectorEvolutionProgress,
      handoffCellIndex,
      birthRippleTextCellIndex,
      rangeInSubdivisions: this.clockSettings.rangeInSubdivisions,
      textSafeZone: this.textSafeZone,
      minimumSquareGapInSubdivisions:
        this.clockSettings.minimumSquareGapInSubdivisions,
    });
    if (
      emitDebug
      && this.clockSettings.enabled
      && this.appearanceStage.effect === "clock"
    ) {
      debug.plan(
        "countdown-effect mode=clock tick=%d evolution=%s evolutionTick=%d seed=%d cell=%d mode=%s size=%d handoff=%d squares=%d safeText=%s squareGap=%d reserveExpansion=%s farSeparated=%s separation=%.3f motion=%s staggerBeats=%s reservations=%s placements=%s dots=%s",
        tick,
        connectorEvolutionEnabled ? "yes" : "no",
        connectorEvolutionTick,
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
        this.clockPlan.farSeparated ? "yes" : "no",
        this.clockPlan.separationDistanceInSubdivisions,
        this.clockPlan.squares.map(square => square.motionRole ?? "origin").join(","),
        this.clockPlan.squares.map(square => (
          square.appearanceStaggerBeats ?? 0
        ).toFixed(3)).join(","),
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
    const evolution = this.effectTicks("bubbles", tick);
    const seed = countdownAppearanceSeed(
      this.projectSeed,
      this.appearanceSeed,
      evolution.evolutionTick,
      this.appearanceEvolveSeed && evolution.evolutionEnabled,
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
      this.minimumCellDistance,
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
    const effectTicks = this.effectTicks("bubbles", tick);
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
    const bubblesAfterMerge = this.hasSnakeBubblesConnector
      && this.snakeSettings.mergeIntoBubbles
      && this.appearanceStage.trackId === this.snakeBubblesConnection.to
      && this.synthState.localTime >= this.snakeBubblesConnection.endSeconds;
    if (!bubblesAfterMerge || this.snakeDeathSnapshot === null) {
      this.snakeBubblePlan = null;
      this.snakeBubbleFrame = null;
      this.frameTextSafeRectangle = null;
      this.frameRenderPlan = this.framePlan;
      return;
    }
    const sourceTick = this.snakeHandoff?.tick ?? this.tick;
    this.snakeBubblePlan = countdownSnakeBubblePlan({
      layout: this.layout,
      cells: this.snakeDeathSnapshot.cells,
      progress: 1,
      appearanceTick: sourceTick,
      subdivisionLevel: this.frameSettings.subdivisionLevel,
    });
    this.frameRenderPlan = countdownFramePlanWithSnakeTrail(
      this.framePlan,
      this.snakeBubblePlan,
    );
    this.snakeBubbleFrame = null;
    this.frameTextSafeRectangle = null;
    this.snakeFieldCommitState = "committed";
  }

  prepareFrameAvoidance(tick, beatElapsed) {
    const effectTicks = this.effectTicks("bubbles", tick);
    if (!effectTicks.owned) {
      this.frameAvoidanceBubbles = [];
      this.frameAvoidanceCircles = [];
      return;
    }
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
        this.minimumCellDistance,
        this.countFromSeconds,
      );
      const sourceEvolution = this.effectTicks("bubbles", sourceTick);
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
    this.synthState = countdownSynthAt(localTime, this.synthSettings);
    this.timelineDebug.update({
      elapsedSeconds: localTime,
      activeIds: [
        ...this.synthState.activeTracks.map(state => `track:${state.track.id}`),
        ...this.synthState.activeConnections.map(
          state => `connection:${state.connection.id}`,
        ),
      ],
    });
    const previousStage = this.appearanceStage;
    const nextStage = countdownSynthStageAt(localTime, this.synthSettings);
    const orderChanged = nextStage.effect !== previousStage.effect
      || nextStage.phase !== previousStage.phase;
    this.appearanceStage = nextStage;
    const nextTick = Math.min(
      this.countFromSeconds - 1,
      Math.floor(localTime / this.tickSeconds),
    );
    const bubblesEvolution = this.hasBubblesTrack
      ? this.effectTicks("bubbles", nextTick)
      : null;
    this.frameGrowthProgress = this.frameSettings === null
      ? 0
      : countdownFrameGrowthAt(
        bubblesEvolution.owned
          ? bubblesEvolution.evolutionProgress
          : 0,
        this.frameSettings,
      );
    this.frameAvoidanceRadiusInCells = this.frameSettings === null
      ? 0
      : countdownFrameAvoidanceRadiusAt(
        bubblesEvolution.evolutionProgress,
        this.frameSettings.avoidance,
      );
    const beatElapsed = localTime - nextTick * this.tickSeconds;
    const beatProgress = beatElapsed / this.tickSeconds;
    const previousNoiseWigglePhase = this.frameNoiseWigglePhase;
    this.frameNoiseWigglePhase = this.frameSettings === null
      ? "out"
      : (beatProgress < 0.5 ? "out" : "back");
    this.frameNoiseTemporalOffset = this.frameSettings === null
      ? 0
      : countdownFrameNoiseBeatOffsetAt(
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
        this.minimumCellDistance,
        this.countFromSeconds,
      );
      debug.cells(
        "countdown tick=%d label=%s cell=%d",
        this.tick,
        this.label,
        this.cellIndex,
      );
      if (this.hasSnakeTrack) this.prepareSnakePlan(nextTick);
      if (this.hasClockTrack) this.prepareClockPlan(nextTick);
      if (this.hasBubblesTrack) {
        this.prepareFramePlan(
          nextTick,
          true,
          orderChanged && this.appearanceStage.effect === "bubbles",
        );
      }
    } else if (orderChanged) {
      if (this.appearanceStage.effect === "clock") {
        this.prepareClockPlan(nextTick);
      } else if (this.appearanceStage.effect === "snake") {
        this.prepareSnakePlan(nextTick);
      } else if (this.appearanceStage.effect === "bubbles") {
        this.prepareFramePlan(nextTick, true, true);
      }
    }
    const previousSnakeHead = this.snakeRenderFrame?.headIndex
      ?? this.snakeFrame?.headStep
      ?? -1;
    const previousSnakeRouteStep = this.snakeEngorgementFrame?.routeStep ?? -1;
    const previousSnakeRenderedCellCount = this.snakeRenderFrame?.cells.length ?? -1;
    let nextSnakeFrame = null;
    let nextSnakeRenderFrame = null;
    let snakeChanged = false;
    if (this.hasSnakeTrack) {
      nextSnakeFrame = countdownSnakeFrame(
        this.snakePlan,
        beatElapsed / this.snakeSettings.duration.seconds,
        this.snakeFrameSettings,
      );
      this.snakeFrame = nextSnakeFrame;
      this.prepareSnakeRenderFrame(localTime);
      nextSnakeRenderFrame = this.snakeRenderFrame;
      snakeChanged = (this.snakeEngorgementFrame?.routeStep ?? -1)
          !== previousSnakeRouteStep
        || (nextSnakeRenderFrame.headIndex ?? nextSnakeFrame.headStep)
          !== previousSnakeHead
        || nextSnakeRenderFrame.cells.length !== previousSnakeRenderedCellCount;
    }
    const previousSnakeBubbleCount = this.snakeBubblePlan?.squares.length ?? 0;
    const previousClockVisible = this.clockFrame?.renderSignature ?? "";
    let nextClockFrame = null;
    let clockChanged = false;
    if (this.hasClockTrack) {
      nextClockFrame = countdownClockFrame(
        this.clockPlan,
        beatElapsed / this.clockSettings.duration.seconds,
        this.clockSettings,
        this.clockBirthRippleProgressAt(localTime),
      );
      this.clockFrame = nextClockFrame;
      clockChanged = nextClockFrame.renderSignature !== previousClockVisible;
    }
    const clockDebugChanged = nextClockFrame?.birthRipple === null
      && clockChanged;
    const previousAvoidancePhases = this.frameAvoidanceBubbles
      .map(bubble => `${bubble.sourceTick}:${bubble.phase}`)
      .join(",");
    if (this.hasBubblesTrack) this.prepareFrameAvoidance(nextTick, beatElapsed);
    this.emitBubblesDebugTransition();
    const avoidancePhases = this.frameAvoidanceBubbles
      .map(bubble => `${bubble.sourceTick}:${bubble.phase}`)
      .join(",");
    const avoidanceChanged = avoidancePhases !== previousAvoidancePhases;
    if (this.hasBubblesTrack) {
      this.sampleFrameVisibility(time);
      this.prepareSnakeBubbleRenderPlan();
    }
    const snakeBubbleChanged = (this.snakeBubblePlan?.squares.length ?? 0)
      !== previousSnakeBubbleCount;
    let nextFrameFrame = null;
    if (this.hasBubblesTrack) {
      nextFrameFrame = countdownFrameAt(
        this.frameRenderPlan,
        beatElapsed / this.tickSeconds,
        this.frameSettings,
        this.frameAvoidanceCircles,
        this.frameVisibilityPlane,
        [],
      );
      this.frameFrame = nextFrameFrame;
    }
    this.emitEngorgementTransitions(localTime);
    this.emitBirthRippleTransitions(localTime);
    this.rebuildCountdownRenderPlan(force);
    if (
      !force
      && !tickChanged
      && !orderChanged
      && !revealChanged
      && !snakeChanged
      && !snakeBubbleChanged
      && !clockDebugChanged
      && !avoidanceChanged
      && !noiseWiggleChanged
    ) return;

    this.revealStep = nextRevealStep;
    if (force || orderChanged) {
      debug.timeline(
        "countdown-order stage=%s index=%d/%d next=%s phase=%s evolution=%s stageProgress=%.3f evolutionProgress=%.3f",
        this.appearanceStage.effect,
        this.appearanceStage.index,
        this.synthSettings.tracks.length,
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
      this.hasSnakeTrack
      && this.appearanceStage.effect === "snake"
      && this.snakeSettings.enabled
      && (force || orderChanged || tickChanged || snakeChanged)
    ) {
      debug.transition(
        "countdown-snake stage=%s tick=%d engorgement=%s head=%d/%d cell=%d levels=%s progress=%.3f",
        this.appearanceStage.effect,
        this.tick,
        this.snakeEngorgementFrame !== null ? "yes" : "no",
        nextSnakeFrame.headStep,
        this.snakePlan.path.length - 1,
        nextSnakeRenderFrame.headIndex
          ?? nextSnakeRenderFrame.cells.at(-1)?.index
          ?? -1,
        nextSnakeRenderFrame.cells.map(cell => cell.level).join(","),
        this.snakeEngorgementFrame?.progress ?? nextSnakeFrame.progress,
      );
    }
    if (
      this.hasClockTrack
      && this.appearanceStage.effect === "clock"
      && this.clockSettings.enabled
      && (force || orderChanged || tickChanged || clockDebugChanged)
    ) {
      if (nextClockFrame.birthRipple !== null) {
        debug.transition(
          "countdown-clock tick=%d mode=birth-ripple radius=%.3f/%.3f cells=%s levels=%s echo=%s echoCell=%s handoff=%d progress=%.3f",
          this.tick,
          nextClockFrame.birthRipple.primary.radiusInCells,
          nextClockFrame.birthRipple.primary.maximumRadiusInCells,
          nextClockFrame.birthRipple.cells.map(cell => cell.index).join(","),
          nextClockFrame.birthRipple.cells.map(cell => cell.level).join(","),
          nextClockFrame.birthRipple.secondary.active ? "yes" : "no",
          nextClockFrame.birthRipple.secondary.originCellIndex ?? "none",
          this.clockPlan.handoffCellIndex,
          nextClockFrame.birthRipple.linearProgress,
        );
      } else {
        debug.transition(
          "countdown-clock tick=%d mode=%s size=%d visible=%d sourceVisible=%d/%d visibleBySquare=%s dotSizes=%s waterfallProbability=%s handoff=%d progress=%.3f",
          this.tick,
          nextClockFrame.evolutionMode,
          nextClockFrame.squareSize,
          nextClockFrame.visibleCount,
          nextClockFrame.sourceVisibleCount,
          nextClockFrame.totalDotCount,
          nextClockFrame.visibleCountsBySquare.join(","),
          nextClockFrame.dots.map(dot => dot.sizeInSubdivisions ?? 1).join(","),
          nextClockFrame.squares.map(square => (
            square.waterfallProbability
          ).toFixed(3)).join(","),
          this.clockPlan.handoffCellIndex,
          nextClockFrame.progress,
        );
      }
    }
    if (
      this.hasBubblesTrack
      && this.frameSettings.enabled
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

  countdownEffectLayers(track) {
    const enabled = track.use === "clock"
      ? this.clockSettings.enabled
      : (track.use === "snake" ? this.snakeSettings.enabled : this.frameSettings.enabled);
    if (!enabled) return [];
    const layers = [{
      id: `${track.id}:main`,
      band: track.use === "clock" && !this.clockSettings.behindText
        ? "above-timer"
        : "behind-timer",
      zIndex: track.zIndex,
      trackIndex: track.index,
      ownerType: "track",
      ownerId: track.id,
      trackId: track.id,
      drawKey: track.use,
    }];
    if (
      track.use === "snake"
      && this.clockFrame?.birthRipple !== null
      && this.clockFrame?.birthRipple !== undefined
    ) {
      layers.unshift({
        id: `${track.id}:birth-ripple`,
        band: "behind-timer",
        zIndex: track.zIndex - 1,
        trackIndex: track.index,
        ownerType: "track",
        ownerId: track.id,
        trackId: track.id,
        drawKey: "birth-ripple",
      });
    }
    return layers;
  }

  countdownEffectSignal(track, time, state, seed) {
    const common = {
      id: track.id,
      use: track.use,
      seed,
      time,
      progress: state.progress,
      evolutionProgress: state.evolutionProgress,
      ports: Object.keys(track.descriptor.ports),
    };
    if (track.use === "clock") {
      return {
        ...common,
        anchors: this.clockPlan === null ? [] : [{
          cellIndex: this.clockPlan.handoffCellIndex,
          role: "snake-origin",
        }],
        dots: this.clockFrame?.dots.map(dot => ({ ...dot })) ?? [],
        masks: this.clockPlan === null ? [] : [{ ...this.clockPlan.textSafeZone }],
      };
    }
    if (track.use === "snake") {
      return {
        ...common,
        anchors: this.snakePlan === null ? [] : [
          { cellIndex: this.snakePlan.sourceIndex, role: "source" },
          { cellIndex: this.snakePlan.targetIndex, role: "target" },
        ],
        cells: this.snakeRenderFrame?.cells.map(cell => ({ ...cell })) ?? [],
        tiles: this.snakeBubblePlan?.squares.map(square => ({
          tileIndex: square.tileIndex,
          sourceCellIndex: square.sourceCellIndex,
          sourceLevel: square.sourceLevel,
        })) ?? [],
        masks: [],
      };
    }
    return {
      ...common,
      dots: this.frameFrame?.dots.map(dot => ({ ...dot })) ?? [],
      tiles: this.frameRenderPlan?.squares.map(square => ({
        tileIndex: square.tileIndex,
        appearanceTick: square.appearanceTick,
      })) ?? [],
      masks: this.frameAvoidanceCircles.map(circle => ({ ...circle })),
    };
  }

  rebuildCountdownRenderPlan(force = false) {
    const nextTrackIds = new Set(
      this.synthState.activeTracks.map(state => state.track.id),
    );
    const nextConnectionIds = new Set(
      this.synthState.activeConnections.map(state => state.connection.id),
    );
    for (const id of this.previousActiveTrackIds) {
      if (!nextTrackIds.has(id)) debug.timeline("countdown-track id=%s state=exit", id);
    }
    for (const id of this.previousActiveConnectionIds) {
      if (!nextConnectionIds.has(id)) {
        debug.transition("countdown-connector id=%s state=exit", id);
      }
    }
    for (const id of nextTrackIds) {
      if (!this.previousActiveTrackIds.has(id)) {
        debug.timeline("countdown-track id=%s state=enter", id);
      }
    }
    for (const state of this.synthState.activeConnections) {
      if (!this.previousActiveConnectionIds.has(state.connection.id)) {
        debug.transition(
          "countdown-connector id=%s use=%s state=enter",
          state.connection.id,
          state.connection.use,
        );
      }
    }

    const trackPlans = this.synthState.activeTracks.map(state => {
      const instance = this.effectInstances.get(state.track.id);
      return { state, instance, plan: instance.planAt(this.synthState.localTime, state) };
    });
    const connectorLayers = [];
    for (const state of this.synthState.activeConnections) {
      const instance = this.connectorInstances.get(state.connection.id);
      const plan = instance.planAt(this.synthState.localTime, state);
      connectorLayers.push(...plan.layers);
    }
    this.renderLayers = sortCountdownRenderLayers([
      ...trackPlans.flatMap(({ plan }) => plan.layers),
      ...connectorLayers,
    ]);
    this.synthSignals = Object.fromEntries(trackPlans.map(({ state, plan }) => [
      state.track.id,
      plan.signal,
    ]));
    const signature = this.renderLayers.map(layer => (
      `${layer.band}:${layer.zIndex}:${layer.ownerType}:${layer.ownerId}:${layer.id}`
    )).join(",");
    if (force || signature !== this.renderLayerSignature) {
      debug.plan(
        "countdown-synth plan=rebuilt tracks=%s connectors=%s layers=%s",
        [...nextTrackIds].join(",") || "none",
        [...nextConnectionIds].join(",") || "none",
        signature || "timer-only",
      );
      this.renderLayerSignature = signature;
    }
    this.previousActiveTrackIds = nextTrackIds;
    this.previousActiveConnectionIds = nextConnectionIds;
  }

  drawCountdownEffectLayer(track, layer, context) {
    this.drawCountdownLayerByKey(layer.drawKey, context);
  }

  drawCountdownConnectorLayer(connection, layer, context) {
    this.drawCountdownLayerByKey(layer.drawKey, context);
  }

  drawCountdownLayerByKey(drawKey, context) {
    if (
      (drawKey === "clock-to-snake" || drawKey === "birth-ripple")
      && this.clockFrame.birthRipple !== null
    ) {
      drawCountdownSnake(
        context,
        this.layout,
        { cells: this.clockFrame.birthRipple.cells },
        this.snakeSettings,
        this.snakePalette,
      );
      return;
    }
    if (drawKey === "clock-to-snake" && (
      this.clockFrame.evolutionMode === "snake-origin"
      && this.clockFrame.birthRipple === null
      && this.clockFrame.visibleCount === this.clockFrame.totalDotCount
    )) {
      drawCountdownSnake(
        context,
        this.layout,
        { cells: [{ index: this.clockPlan.handoffCellIndex, level: 0 }] },
        this.snakeSettings,
        this.snakePalette,
      );
      return;
    }
    if (drawKey === "clock" || drawKey === "clock-to-snake") {
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
      return;
    }
    if (drawKey === "snake") {
      drawCountdownSnake(
        context,
        this.layout,
        this.snakeRenderFrame,
        this.snakeSettings,
        this.snakePalette,
        this.snakeFlicker,
        this.elapsed,
      );
      return;
    }
    const drawFrame = drawKey === "bubbles-handoff"
      ? this.snakeBubbleFrame
      : this.frameFrame;
    if (drawFrame === null) return;
    drawCountdownFrame(
      context,
      this.layout,
      drawFrame,
      this.frameSettings,
      countdownFrameDotColors(
        drawFrame,
        this.framePalette,
        this.frameFlicker,
        this.elapsed,
      ),
      drawKey === "bubbles-handoff" ? 0 : this.frameGrowthProgress,
    );
  }

  drawCountdownRenderLayer(layer, context) {
    const instances = layer.ownerType === "track"
      ? this.effectInstances
      : this.connectorInstances;
    instances.get(layer.ownerId)?.drawLayer(layer, context);
  }

  emitBubblesDebugTransition() {
    const active = this.frameSettings?.debug.visualizeBubbles === true
      && this.frameAvoidanceCircles.some(circle => (
        circle.radius > (circle.refillRadius ?? 0)
      ));
    if (active !== this.bubblesDebugActive) {
      debug.transition(
        "countdown-bubbles-debug state=%s bubbles=%d circles=%d opacity=%.3f",
        active ? "start" : "end",
        this.frameAvoidanceBubbles.length,
        this.frameAvoidanceCircles.length,
        this.frameSettings?.debug.opacity ?? 0,
      );
      this.bubblesDebugActive = active;
    }
  }

  emitEngorgementTransitions(localTime) {
    if (this.snakeEngorgementPlan === null) return;
    const state = this.snakeEngorgementAt(localTime);
    const frame = this.snakeEngorgementFrame;
    if (state.connectorActive && !this.engorgementDebugState.active) {
      debug.transition(
        "countdown-engorgement state=start progress=%.3f startLength=%d targetLength=%d capacityLength=%d head=%d meal=%d",
        state.connectorProgress,
        this.snakeEngorgementPlan.startLength,
        this.snakeEngorgementPlan.targetLength,
        this.snakeEngorgementPlan.capacityLength,
        frame?.headIndex ?? -1,
        this.snakeEngorgementPlan.mealIndex,
      );
    }
    const beatIndex = state.connectorActive
      ? Math.min(
        this.snakeEngorgementPlan.beatCount - 1,
        Math.floor(
          state.connectorProgress * this.snakeEngorgementPlan.beatCount,
        ),
      )
      : -1;
    if (state.connectorActive && beatIndex !== this.engorgementDebugState.beatIndex) {
      const beat = this.snakeEngorgementPlan.beats[beatIndex];
      debug.transition(
        "countdown-engorgement beat=%d target=%d length=%d unique=%d coverage=%.3f targetLength=%d routeStep=%d timerCells=%d distance=%d collisions=%d wraps=%d",
        beatIndex,
        beat.targetIndex,
        frame?.currentLength ?? -1,
        frame?.uniqueCellCount ?? -1,
        frame?.coverage ?? 0,
        beat.targetLength,
        frame?.routeStep ?? -1,
        beat.safeCellIndices.length,
        beat.endDistance,
        frame?.collisionCount ?? 0,
        frame?.wrapCount ?? 0,
      );
    }
    if (frame?.growthActive && !this.engorgementDebugState.growthActive) {
      debug.transition(
        "countdown-engorgement state=growth-start progress=%.3f routeStep=%d length=%d targetLength=%d head=%d",
        state.connectorProgress,
        frame.routeStep,
        frame.currentLength,
        frame.targetLength,
        frame.headIndex,
      );
    }
    if (frame?.foodVisible && !this.engorgementDebugState.mealVisible) {
      debug.transition(
        "countdown-engorgement state=meal-reveal progress=%.3f head=%d meal=%d pulseScale=%.3f unique=%d coverage=%.3f movementComplete=%s",
        state.connectorProgress,
        frame.headIndex,
        frame.mealIndex,
        frame.pulse.scale,
        frame.uniqueCellCount,
        frame.coverage,
        frame.movementComplete ? "yes" : "no",
      );
    }
    if (
      frame?.deathFlicker.active
      && !this.engorgementDebugState.deathFlickerActive
    ) {
      debug.transition(
        "countdown-engorgement state=death-flicker progress=%.3f mode=%s bodyCells=%d",
        state.connectorProgress,
        this.snakeFlicker.modeName,
        frame.allBodyCells.length,
      );
    }
    const dead = state.deathCommitted
      && this.appearanceStage.trackId === this.snakeBubblesConnection?.to;
    if (dead && !this.engorgementDebugState.dead) {
      debug.transition(
        "countdown-engorgement state=death progress=1.000 bodyCells=%d meal=%d",
        this.snakeDeathSnapshot?.cells.length ?? 0,
        this.snakeDeathSnapshot?.consumedMealIndex ?? -1,
      );
    }
    const committed = this.snakeFieldCommitState === "committed";
    if (committed && !this.engorgementDebugState.committed) {
      debug.transition(
        "countdown-engorgement state=noise-field-commit sourceCells=%d convertedTiles=%d meal=%d",
        this.snakeDeathSnapshot?.cells.length ?? 0,
        this.snakeBubblePlan?.squares.length ?? 0,
        this.snakeDeathSnapshot?.consumedMealIndex ?? -1,
      );
    }
    this.engorgementDebugState = {
      active: state.connectorActive,
      growthActive: frame?.growthActive === true,
      deathFlickerActive: frame?.deathFlicker.active === true,
      mealVisible: frame?.foodVisible === true,
      dead,
      committed,
      beatIndex,
    };
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
    for (const layer of this.renderLayers) {
      if (layer.band === "behind-timer") this.drawCountdownRenderLayer(layer, context);
    }
    let cursor = textLeft;
    for (let index = 0; index < glyphs.length; index += 1) {
      const width = widths[index];
      context.fillStyle = this.palette[this.paletteIndices[index]];
      context.fillText(glyphs[index], cursor + width * 0.5, y);
      cursor += width;
    }
    for (const layer of this.renderLayers) {
      if (layer.band === "above-timer") this.drawCountdownRenderLayer(layer, context);
    }
    if (this.frameSettings !== null) {
      drawCountdownBubblesDebug(
        context,
        this.layout,
        this.frameAvoidanceBubbles,
        this.frameSettings.debug,
        this.frameSettings.subdivisionLevel,
        this.framePalette.at(-1),
      );
    }
    if (frame?.showCellGrid === true) drawCellGridGuides(context, this.layout);
    this.timelineDebug.draw(context, this.layout, {
      exporting: frame?.exporting === true,
    });
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
        seed: this.appearanceSeed,
        evolveSeed: this.appearanceEvolveSeed,
        minimumCellDistance: this.minimumCellDistance,
        order: {
          stages: this.synthSettings.tracks.map(track => ({
            effect: track.use,
            evolutionStartsAt: (
              track.evolution.startSeconds - track.startSeconds
            ) / track.durationSeconds,
          })),
          stageDurationSeconds: null,
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
        synth: {
          activeTrackIds: this.synthState.activeTracks.map(state => state.track.id),
          activeConnectionIds: this.synthState.activeConnections.map(
            state => state.connection.id,
          ),
          tracks: this.synthSettings.tracks.map(track => ({
            id: track.id,
            use: track.use,
            startSeconds: track.startSeconds,
            durationSeconds: track.durationSeconds,
            evolution: { ...track.evolution },
            zIndex: track.zIndex,
            seed: this.effectInstances.get(track.id).inspect().seed,
            signal: this.synthSignals?.[track.id] ?? null,
          })),
          connections: this.synthSettings.connections.map(connection => ({
            id: connection.id,
            from: connection.from,
            to: connection.to,
            requestedUse: connection.requestedUse,
            use: connection.use,
            startSeconds: connection.startSeconds,
            durationSeconds: connection.durationSeconds,
            evolution: { ...connection.evolution },
          })),
          renderLayers: this.renderLayers.map(layer => ({ ...layer })),
        },
        timelineDebug: this.timelineDebug.inspect(),
        snake: this.snakeSettings === null ? null : {
          enabled: this.snakeSettings.enabled,
          paletteName: this.snakeSettings.palette,
          palette: [...this.snakePalette],
          durationSeconds: this.snakeSettings.duration.seconds,
          durationSource: this.snakeSettings.duration.source,
          timingCurve: [...this.snakeSettings.timingCurve],
          baseLengthCells: this.snakeSettings.lengthCells,
          lengthCells: this.snakeEngorgementFrame?.currentLength
            ?? this.snakeFrameSettings?.lengthCells
            ?? this.snakeSettings.lengthCells,
          maximumLengthCells: this.availableSnakeCellCount,
          growAfterEachTick: this.snakeSettings.growAfterEachTick,
          mergeIntoBubbles: this.snakeSettings.mergeIntoBubbles,
          growthTick: this.snakeGrowthTick,
          maximumSubdivisionLevel: this.snakeSettings.maximumSubdivisionLevel,
          engorgement: this.snakeEngorgementPlan === null ? null : {
            connectorProgress: this.snakeConnectorProgress,
            startLength: this.snakeEngorgementPlan.startLength,
            currentLength: this.snakeEngorgementFrame?.currentLength
              ?? this.snakeEngorgementPlan.startLength,
            targetLength: this.snakeEngorgementPlan.targetLength,
            plannedLength: this.snakeEngorgementPlan.plannedLength,
            capacityLength: this.snakeEngorgementPlan.capacityLength,
            reachableLength: this.snakeEngorgementPlan.reachableLength,
            headIndex: this.snakeEngorgementFrame?.headIndex
              ?? this.snakeHandoff?.frame.cells.at(-1)?.index
              ?? null,
            mealIndex: this.snakeEngorgementPlan.mealIndex,
            foodVisible: this.snakeEngorgementFrame?.foodVisible ?? false,
            pulse: this.snakeEngorgementFrame === null
              ? { active: false, progress: 0, scale: 1 }
              : { ...this.snakeEngorgementFrame.pulse },
            routeStep: this.snakeEngorgementFrame?.routeStep ?? 0,
            routeStepCount: this.snakeEngorgementPlan.routeStepCount,
            movementStepCount: this.snakeEngorgementPlan.movementStepCount,
            cruiseStepCount: this.snakeEngorgementPlan.cruiseStepCount,
            collisionCount: this.snakeEngorgementFrame?.collisionCount ?? 0,
            wrapCount: this.snakeEngorgementFrame?.wrapCount ?? 0,
            uniqueCellCount: this.snakeEngorgementFrame?.uniqueCellCount
              ?? this.snakeEngorgementPlan.startLength,
            coverage: this.snakeEngorgementFrame?.coverage
              ?? this.snakeEngorgementPlan.startLength
                / (this.layout.columns * this.layout.rows),
            coverageComplete:
              this.snakeEngorgementFrame?.coverageComplete ?? false,
            movementComplete:
              this.snakeEngorgementFrame?.movementComplete ?? false,
            growthMode: this.snakeSettings.engorgement.growthMode,
            growthStartProgress:
              this.snakeSettings.engorgement.growthStartProgress,
            growthActive:
              this.snakeEngorgementFrame?.growthActive ?? false,
            deathFlicker: this.snakeEngorgementFrame === null
              ? { active: false, progress: 0, mode: this.snakeFlicker.modeName }
              : {
                ...this.snakeEngorgementFrame.deathFlicker,
                mode: this.snakeFlicker.modeName,
              },
            mealRevealBeforeEndBeats:
              this.snakeSettings.engorgement.mealRevealBeforeEndBeats,
            mealPulseScale: this.snakeSettings.engorgement.mealPulseScale,
            deathFlickerSettings: {
              ...this.snakeSettings.engorgement.deathFlicker,
            },
            deathFlickerEffect: this.snakeFlicker.inspect(),
            beats: this.snakeEngorgementPlan.beats.map(beat => ({
              ...beat,
              safeCellIndices: [...beat.safeCellIndices],
            })),
          },
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
            blockedCellIndices: [...this.snakePlan.blockedCellIndices],
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
            headStep: this.snakeRenderFrame.headStep ?? null,
            routeStep: this.snakeRenderFrame.routeStep ?? null,
            headIndex: this.snakeRenderFrame.headIndex
              ?? this.snakeRenderFrame.cells.at(-1)?.index
              ?? null,
            cells: this.snakeRenderFrame.cells.map(cell => ({ ...cell })),
          },
        },
        clock: this.clockSettings === null ? null : {
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
          travelingSquareStaggerBeats:
            this.clockSettings.travelingSquareStaggerBeats,
          sizeWaterfall: { ...this.clockSettings.sizeWaterfall },
          farSeparation: { ...this.clockSettings.farSeparation },
          birthRipple: {
            ...this.clockSettings.birthRipple,
            radialTimingCurve: [
              ...this.clockSettings.birthRipple.radialTimingCurve,
            ],
            wakeFlicker: {
              ...this.clockSettings.birthRipple.wakeFlicker,
            },
            window: this.clockBirthRippleWindow === null
              ? null
              : { ...this.clockBirthRippleWindow },
          },
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
            birthRippleTextCellIndex:
              this.clockPlan.birthRippleTextCellIndex,
            gridColumns: this.clockPlan.gridColumns,
            gridRows: this.clockPlan.gridRows,
            handoffCellIndex: this.clockPlan.handoffCellIndex,
            evolutionMode: this.clockPlan.evolutionMode,
            evolutionProgress: this.clockPlan.evolutionProgress,
            squareSize: this.clockPlan.squareSize,
            maximumSquareSize: this.clockPlan.maximumSquareSize,
            reservationExpansion: this.clockPlan.reservationExpansion,
            farSeparated: this.clockPlan.farSeparated,
            separationDistanceInSubdivisions:
              this.clockPlan.separationDistanceInSubdivisions,
            snakeOriginBounds: this.clockPlan.snakeOriginBounds
              ? { ...this.clockPlan.snakeOriginBounds }
              : null,
            textSafeZone: { ...this.clockPlan.textSafeZone },
            birthRippleTextSafeZone: {
              ...this.clockPlan.birthRippleTextSafeZone,
            },
            minimumSquareGapInSubdivisions:
              this.clockPlan.minimumSquareGapInSubdivisions,
            squares: this.clockPlan.squares.map(square => ({
              squareIndex: square.squareIndex,
              motionRole: square.motionRole,
              farSeparated: square.farSeparated ?? false,
              appearanceStaggerBeats: square.appearanceStaggerBeats ?? 0,
              offsetX: square.offsetX,
              offsetY: square.offsetY,
              topLeftColumn: square.topLeftColumn,
              topLeftRow: square.topLeftRow,
              reservation: square.reservation
                ? { ...square.reservation }
                : null,
              originReservation: square.originReservation
                ? { ...square.originReservation }
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
            visibleCountsBySquare: [...this.clockFrame.visibleCountsBySquare],
            sourceVisibleCount: this.clockFrame.sourceVisibleCount,
            sourceVisibleCountsBySquare: [
              ...this.clockFrame.sourceVisibleCountsBySquare,
            ],
            totalDotCount: this.clockFrame.totalDotCount,
            evolutionMode: this.clockFrame.evolutionMode,
            evolutionProgress: this.clockFrame.evolutionProgress,
            squareSize: this.clockFrame.squareSize,
            birthRipple: this.clockFrame.birthRipple === null
              ? null
              : {
                linearProgress: this.clockFrame.birthRipple.linearProgress,
                progress: this.clockFrame.birthRipple.progress,
                handoffLinearProgress:
                  this.clockFrame.birthRipple.handoffLinearProgress,
                holdingOrigin: this.clockFrame.birthRipple.holdingOrigin,
                originCellIndex: this.clockFrame.birthRipple.originCellIndex,
                originColumn: this.clockFrame.birthRipple.originColumn,
                originRow: this.clockFrame.birthRipple.originRow,
                primary: {
                  radiusInCells:
                    this.clockFrame.birthRipple.primary.radiusInCells,
                  maximumRadiusInCells:
                    this.clockFrame.birthRipple.primary.maximumRadiusInCells,
                  edgeRadiusInCells:
                    this.clockFrame.birthRipple.primary.edgeRadiusInCells,
                  wakeDepthInCells:
                    this.clockFrame.birthRipple.primary.wakeDepthInCells,
                  activeCellCount:
                    this.clockFrame.birthRipple.primary.activeCellCount,
                  flicker: {
                    ...this.clockFrame.birthRipple.primary.flicker,
                    triggeredCellIndices: [
                      ...this.clockFrame.birthRipple.primary.flicker
                        .triggeredCellIndices,
                    ],
                  },
                  cells: this.clockFrame.birthRipple.primary.cells.map(
                    cell => ({ ...cell }),
                  ),
                },
                secondary: {
                  active: this.clockFrame.birthRipple.secondary.active,
                  progress: this.clockFrame.birthRipple.secondary.progress,
                  originCellIndex:
                    this.clockFrame.birthRipple.secondary.originCellIndex,
                  originColumn:
                    this.clockFrame.birthRipple.secondary.originColumn,
                  originRow: this.clockFrame.birthRipple.secondary.originRow,
                  activationRadiusInCells:
                    this.clockFrame.birthRipple.secondary.activationRadiusInCells,
                  sourceLevel:
                    this.clockFrame.birthRipple.secondary.sourceLevel,
                  radiusInCells:
                    this.clockFrame.birthRipple.secondary.radiusInCells,
                  maximumRadiusInCells:
                    this.clockFrame.birthRipple.secondary.maximumRadiusInCells,
                  edgeRadiusInCells:
                    this.clockFrame.birthRipple.secondary.edgeRadiusInCells,
                  activeCellCount:
                    this.clockFrame.birthRipple.secondary.activeCellCount,
                  cells: this.clockFrame.birthRipple.secondary.cells.map(
                    cell => ({ ...cell }),
                  ),
                },
                cells: this.clockFrame.birthRipple.cells.map(cell => ({
                  ...cell,
                  ripples: [...cell.ripples],
                })),
              },
            cells: this.clockFrame.cells.map(cell => ({
              ...cell,
              ripples: [...cell.ripples],
            })),
            dots: this.clockFrame.dots.map(dot => ({ ...dot })),
          },
        },
        frame: this.frameSettings === null ? null : {
          stageName: "bubbles",
          enabled: this.frameSettings.enabled,
          debug: {
            visualizeBubbles: this.frameSettings.debug.visualizeBubbles,
            opacity: this.frameSettings.debug.opacity,
            active: this.bubblesDebugActive,
            bubbleCount: this.frameAvoidanceBubbles.length,
            circleCount: this.frameAvoidanceCircles.length,
          },
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
            active: this.snakeEngorgementFrame !== null
              || this.snakeBubblePlan !== null,
            phase: this.snakeFieldCommitState === "committed"
              ? "dead"
              : (this.snakeEngorgementFrame !== null ? "engorging" : "inactive"),
            progress: this.snakeConnectorProgress,
            sourceTick: this.snakeBubblePlan?.tick ?? null,
            consumedMealIndex:
              this.snakeDeathSnapshot?.consumedMealIndex ?? null,
            sourceBodyCells: this.snakeFieldCommitState === "committed"
              ? this.snakeDeathSnapshot.cells.map(cell => ({ ...cell }))
              : [],
            convertedTileCount: this.snakeBubblePlan?.squares.length ?? 0,
            fieldCommitState: this.snakeFieldCommitState,
            trailSquareCount: this.snakeBubblePlan?.squares.length ?? 0,
            availableTrailSquareCount: this.snakeBubblePlan?.availableSquareCount ?? 0,
            overlapSquareCount: this.frameRenderPlan?.trailOverlapCount ?? 0,
            renderedSquareCount: this.frameRenderPlan?.squares.length ?? 0,
            exclusionCircleCount: 0,
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
    for (const instance of this.effectInstances.values()) instance.dispose();
    for (const instance of this.connectorInstances.values()) instance.dispose();
    this.disposed = true;
  }
}
