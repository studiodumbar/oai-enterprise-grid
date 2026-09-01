import { debug } from "../debug/index.js";
import { CompositionTimelineDebug } from "../debug/composition-timeline.js";
import { resolveAutomaticDuration } from "../core/automatic-duration.js";
import {
  combineCountdownClockRoleFrames,
  countdownClockDotColors,
  countdownClockFrame,
  countdownClockFrameByRoles,
  countdownClockOffsetSchedule,
  countdownClockOffsetStateAt,
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
  countdownFrameAvoidedSquareIndices,
  countdownFrameAvoidanceEnvelopesAt,
  countdownFrameAvoidanceRadiusAt,
  countdownFrameDigitCircles,
  countdownFrameDotColors,
  countdownFrameGrowthAt,
  countdownFrameFieldBeatOffsetAt,
  countdownFrameFinalWipeAt,
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
  countdownSnakeColorVariation,
  countdownSnakeDisappearanceFrame,
  countdownSnakeDisappearanceVariation,
  countdownSnakeDiveFrame,
  countdownSnakeEngorgementFrame,
  countdownSnakeFrame,
  countdownSnakeLengthAt,
  countdownSnakePath,
  countdownSnakeSecondaryDirection,
  countdownSnakeTextSafeCells,
  countdownSnakeWrappedPath,
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
  return palette.map(color => (
    requireString(color, `Palette ${options.palette} color`)
  ));
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
    this.palette = [
      ...countdownPalette(options, palettes),
      requireString(options.timerFinalColor, "countdownFramed.timerFinalColor"),
    ];
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
      effects: {
        [legacyKey]: {
          palette: options.palette,
          ...effectSettings(use, legacyKey),
        },
      },
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
    this.snakeCollisionFlicker = this.snakeSettings === null
      ? null
      : createFlicker({
        palette: this.snakePalette,
        settings: options.flicker,
        noiseFunction,
        autoCycleSeconds: this.tickSeconds,
      }).useMode(this.snakeSettings.selfCollision.flickerMode);
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
    this.frameFieldModes = null;
    this.frameFieldSettings = null;
    this.frameFieldSampler = null;
    this.framePalette = null;
    this.frameFlicker = null;
    if (this.frameSettings !== null) {
      const authoredVisibilityMap = effectSettings(
        "bubbles",
        "frame",
      )?.visibilityMap;
      if (
        !authoredVisibilityMap
        || typeof authoredVisibilityMap !== "object"
        || Array.isArray(authoredVisibilityMap)
      ) {
        throw new TypeError(
          "countdownFramed.appearance.effects.frame.visibilityMap must be an object.",
        );
      }
      const authoredField = authoredVisibilityMap.field;
      if (!authoredField || typeof authoredField !== "object" || Array.isArray(authoredField)) {
        throw new TypeError(
          "countdownFramed.appearance.effects.frame.visibilityMap.field must be an object.",
        );
      }
      this.frameFieldModes = noiseFieldModes ?? createNoiseFieldRegistry();
      this.frameFieldSettings = resolveNoiseFieldSettings(
        settings?.noiseFields ?? {},
        {
          enabled: authoredVisibilityMap.enabled,
          layers: { visibility: authoredField },
        },
        { modeRegistry: this.frameFieldModes, timing: options.timing },
      );
      if (this.frameFieldSettings.layers.visibility.holdSeconds !== 0) {
        throw new RangeError(
          "Countdown framed frame visibility map requires holdSeconds to be zero.",
        );
      }
      this.frameFieldSampler = new NoiseFieldSampler({
        modeRegistry: this.frameFieldModes,
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
    this.clockOffsetSchedules = new Map();
    if (this.clockSettings !== null) {
      this.synthSettings.tracks.forEach((track, trackIndex) => {
        if (track.use !== "clock") return;
        const stableEndSeconds = this.clockBirthRippleWindow !== null
          && this.clockBirthRippleWindow.startSeconds > track.startSeconds
          && this.clockBirthRippleWindow.startSeconds < track.endSeconds
          ? this.clockBirthRippleWindow.startSeconds
          : track.endSeconds;
        const stableBeatCount = Math.floor(
          (stableEndSeconds - track.startSeconds) / this.tickSeconds + 1e-9,
        );
        if (stableBeatCount <= 0) return;
        this.clockOffsetSchedules.set(track.id, Object.freeze({
          trackId: track.id,
          trackIndex,
          startSeconds: track.startSeconds,
          endSeconds: track.startSeconds + stableBeatCount * this.tickSeconds,
          schedule: countdownClockOffsetSchedule(
            countdownSynthSeed(
              this.projectSeed,
              `${track.id}:clock-offset`,
              track.descriptor.seedSalt,
            ),
            stableBeatCount,
            this.clockSettings.travelingSquareBeatOffset,
          ),
        }));
      });
    }
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
        "countdown-effect mode=snake enabled=%s seed=%d evolve=%s distance=%d palette=%s variations=%s disappearances=%s selfCollision=%s collisionFlicker=%s secondaryMovement=%s movementProbability=%.3f directions=%s duration=%.3f cells=%d grow=%s mergeBubbles=%s engorgement=%s growthMode=%s growthStartProgress=%.3f mealRevealBeats=%.3f mealPulseScale=%.3f mealPulseCurve=%j deathFlicker=%s deathFlickerBeats=%.3f deathFlickerMode=%s curve=%j",
        this.snakeSettings.enabled ? "yes" : "no",
        this.snakeSettings.seed,
        this.snakeSettings.evolveSeed ? "yes" : "no",
        this.snakeSettings.minimumCellDistance,
        this.snakeSettings.palette,
        this.snakeSettings.colorVariations
          .map(variation => `${variation.use}:${variation.weight}`)
          .join(","),
        this.snakeSettings.disappearanceVariations
          .map(variation => `${variation.use}:${variation.weight}`)
          .join(","),
        this.snakeSettings.selfCollision.enabled ? "yes" : "no",
        this.snakeSettings.selfCollision.flickerMode,
        this.snakeSettings.secondaryMovement.enabled ? "yes" : "no",
        this.snakeSettings.secondaryMovement.probability,
        this.snakeSettings.secondaryMovement.directions.join(","),
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
        "countdown-effect mode=clock enabled=%s seed=%d evolveSeed=%s palette=%s duration=%.3f level=%d squares=%d dotsPerSquare=%d travelingStaggerBeats=%.3f travelingBeatOffset=%s beatOffsetProbability=%.3f beatOffsetPatterns=%s waterfall=%s waterfallBothCells=%s clockProbability=%.3f farSeparation=%s farSeparationProbability=%.3f farSeparationMinimumRadiusCells=%.3f birthRipple=%s rippleStartBeforeHandoffBeats=%.3f rippleDurationBeats=%.3f rippleWakeCells=%.3f rippleSecondaryRadiusCells=%.3f rippleCurve=%j rippleFlicker=%s rippleFlickerProbability=%.3f rippleFlickerDecayCells=%.3f rippleFlickerFlashesPerBeat=%d rippleFlickerMinimumOpacity=%.3f behindText=%s evolutionSizes=%j rangeX=%d rangeY=%d safeWidthCells=%.3f safeHeightCells=%.3f squareGap=%d curve=%j",
        this.clockSettings.enabled ? "yes" : "no",
        this.clockSettings.seed,
        this.clockSettings.evolveSeed ? "yes" : "no",
        this.clockSettings.palette,
        this.clockSettings.duration.seconds,
        this.clockSettings.subdivisionLevel,
        this.clockSettings.squareCount,
        this.clockSettings.dotsPerSquare,
        this.clockSettings.travelingSquareStaggerBeats,
        this.clockSettings.travelingSquareBeatOffset.enabled ? "yes" : "no",
        this.clockSettings.travelingSquareBeatOffset.probability,
        this.clockSettings.travelingSquareBeatOffset.patterns.map(pattern => (
          `${pattern.id}:${pattern.durationBeats}x${pattern.repeatCount}`
        )).join(","),
        this.clockSettings.sizeWaterfall.enabled ? "yes" : "no",
        this.clockSettings.sizeWaterfall.bothCells ? "yes" : "no",
        this.clockSettings.sizeWaterfall.clockProbability,
        this.clockSettings.farSeparation.enabled ? "yes" : "no",
        this.clockSettings.farSeparation.probability,
        this.clockSettings.farSeparation.minimumRadiusInCells,
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
      for (const scheduleInfo of this.clockOffsetSchedules.values()) {
        debug.config(
          "countdown-clock-offset-schedule track=%s stableBeats=%d blocks=%s",
          scheduleInfo.trackId,
          scheduleInfo.schedule.totalBeats,
          scheduleInfo.schedule.blocks.map(block => (
            `${block.patternId}@${block.startBeat}+${block.totalBeats}`
          )).join(","),
        );
      }
    } else {
      debug.config("countdown-effect mode=clock enabled=no reason=no-track");
    }
    if (this.frameSettings !== null) {
      debug.config(
        "countdown-effect mode=bubbles enabled=%s seed=%d evolveSeed=%s evolveSquares=%s palette=%s level=%d squares=%d dotsPerSquare=%d avoidanceRadiusStartCells=%.3f avoidanceRadiusEndCells=%.3f avoidanceBeats=%.3f refillStartBeforeTickEndBeats=%.3f refillStartAgeBeats=%.3f numberSpacing=%.3f grow=%s avoidanceCurve=%j refillCurve=%j avoidanceRadiusCurve=%j growthCurve=%j",
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
        this.frameSettings.avoidance.refill.startBeforeTickEndBeats,
        this.frameSettings.avoidance.refill.startAgeBeats,
        this.frameSettings.numberSpacingInSubdivisions,
        this.frameSettings.growTowardZero ? "yes" : "no",
        this.frameSettings.avoidance.timingCurve,
        this.frameSettings.avoidance.refill.timingCurve,
        this.frameSettings.avoidance.radiusGrowthTimingCurve,
        this.frameSettings.growthTimingCurve,
      );
      debug.config(
        "countdown-effect mode=bubbles-field-motion durationBeats=%.3f beatWiggleDistance=%.3f curve=%j",
        this.frameSettings.visibilityMap.beatWiggleDurationBeats,
        this.frameSettings.visibilityMap.beatWiggleDistance,
        this.frameSettings.visibilityMap.timingCurve,
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
      const visibilityField = this.frameFieldSettings.layers.visibility;
      debug.config(
        "countdown-effect mode=bubbles-visibility-map enabled=%s field=%s scale=%.3f threshold=%.3f softness=%.3f seed=%d displacementMinCells=%.3f displacementRatio=%.3f displacementMaxCells=%.3f finalWipeStart=%.3f finalWipeEnd=%.3f finalWipeCurve=%j",
        this.frameFieldSettings.enabled ? "yes" : "no",
        visibilityField.mode,
        visibilityField.scale,
        visibilityField.threshold,
        visibilityField.softness,
        visibilityField.seed,
        this.frameSettings.visibilityMap.displacement.minimumInCells,
        this.frameSettings.visibilityMap.displacement.radiusRatio,
        this.frameSettings.visibilityMap.displacement.maximumInCells,
        this.frameSettings.avoidance.finalWipe.startProgress,
        this.frameSettings.avoidance.finalWipe.endProgress,
        this.frameSettings.avoidance.finalWipe.timingCurve,
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
    this.snakeDisappearanceRenderFrame = null;
    this.snakeTextSafeCellIndex = null;
    this.snakeTextSafeHiddenCellCount = 0;
    this.snakeTextClearDebugSignature = "";
    this.snakeFrameSettings = null;
    this.snakeDisappearancePlan = null;
    this.snakeDisappearanceFrame = null;
    this.snakeDisappearanceSchedule = null;
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
    this.clockOffsetState = null;
    this.clockOffsetPlanCache = new Map();
    this.clockOffsetDebugSignature = "";
    this.clockBirthRippleRenderCells = [];
    this.clockBirthRipplePriority = null;
    this.clockBirthRipplePriorityDebugSignature = "";
    this.framePlan = null;
    this.frameRenderPlan = null;
    this.frameFrame = null;
    this.frameAvoidanceBubbles = [];
    this.frameAvoidanceCircles = [];
    this.frameTextSafeRectangle = null;
    this.frameTextSafeCellIndex = null;
    this.frameTextSafeCellCount = 0;
    this.frameTextClearDebugSignature = "";
    this.frameAvoidanceRadiusInCells = this.frameSettings?.avoidance.radiusInCells ?? 0;
    this.frameVisibilityMap = null;
    this.frameFieldTemporalOffset = 0;
    this.frameFieldWigglePhase = "out";
    this.frameFieldWiggleIndex = 0;
    this.frameFieldWiggleProgress = 0;
    this.frameFieldPlanSignature = null;
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
      waterfallStep: -1,
    };
    this.bubblesFieldDebugState = {
      phases: new Map(),
    };
    this.resize(runtime.viewport());
  }

  resize(viewport) {
    this.clockOffsetPlanCache?.clear();
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
      const disappearanceModes = Array(this.countFromSeconds);
      try {
        for (let sourceTick = 0; sourceTick < this.countFromSeconds; sourceTick += 1) {
          const state = this.snakeStateAt(sourceTick);
          maximumSafePathLength = Math.max(
            maximumSafePathLength,
            state.plan.path.length,
          );
          const renderTick = (sourceTick + 1) % this.countFromSeconds;
          disappearanceModes[renderTick] = countdownSnakeDisappearanceVariation(
            this.snakeSettings.disappearanceVariations,
            state.plan.seed,
            sourceTick,
          );
        }
        this.snakeDisappearanceSchedule = this.resolveSnakeDisappearanceSchedule(
          disappearanceModes,
        );
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
    if (this.snakeCollisionFlicker !== null) {
      this.snakeCollisionFlicker.resize({
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
        const beatProgress = (
          localTime - this.tick * this.tickSeconds
        ) / this.tickSeconds;
        const collisionFrames = this.snakeLifecycleFramesAt(
          beatProgress,
          beatProgress,
        );
        this.snakeFrame = collisionFrames.snakeFrame;
        this.snakeDisappearanceFrame = collisionFrames.disappearanceFrame;
        this.prepareSnakeRenderFrame(localTime);
      }
      if (this.hasClockTrack) {
        this.prepareClockPlan(this.tick, false);
        this.clockFrame = this.prepareClockFrame(
          localTime,
          localTime - this.tick * this.tickSeconds,
        );
        this.prepareClockBirthRippleRenderCells();
      }
      if (this.hasBubblesTrack) {
        this.prepareFramePlan(this.tick, false, true);
        this.prepareFrameAvoidance(
          this.tick,
          localTime - this.tick * this.tickSeconds,
        );
        this.sampleFrameVisibilityMap(this.elapsed);
        this.prepareSnakeBubbleRenderPlan();
        this.frameFrame = countdownFrameAt(
          this.frameRenderPlan,
          this.frameFrame?.linearProgress ?? 0,
          this.frameSettings,
          this.frameAvoidanceCircles,
          this.frameVisibilityMap,
          [],
          [this.frameTextSafeRectangle],
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

  prepareClockBirthRippleRenderCells() {
    const sourceCells = this.clockFrame?.birthRipple?.cells ?? [];
    if (sourceCells.length === 0) {
      this.clockBirthRippleRenderCells = [];
      this.clockBirthRipplePriority = null;
      if (this.clockBirthRipplePriorityDebugSignature !== "") {
        debug.transition("countdown-ripple-priority state=inactive");
        this.clockBirthRipplePriorityDebugSignature = "";
      }
      return;
    }

    const timerCellIndex = this.timerTextCellIndexAt(this.cellIndex, this.tick);
    const snakePriorityActive = this.appearanceStage.effect === "snake";
    const snakeCellIndices = new Set(snakePriorityActive ? [
      ...(this.snakeRenderFrame?.cells ?? []),
      ...(this.snakeDisappearanceRenderFrame?.cells ?? []),
    ].map(cell => cell.index) : []);
    let hiddenByTimerCount = 0;
    let hiddenBySnakeCount = 0;
    this.clockBirthRippleRenderCells = sourceCells.filter(cell => {
      if (cell.index === timerCellIndex) {
        hiddenByTimerCount += 1;
        return false;
      }
      if (snakeCellIndices.has(cell.index)) {
        hiddenBySnakeCount += 1;
        return false;
      }
      return true;
    });
    this.clockBirthRipplePriority = {
      timerCellIndex,
      snakePriorityActive,
      snakeCellCount: snakeCellIndices.size,
      sourceCellCount: sourceCells.length,
      hiddenByTimerCount,
      hiddenBySnakeCount,
      visibleCellCount: this.clockBirthRippleRenderCells.length,
    };
    const hiddenBy = [
      hiddenByTimerCount > 0 ? "timer" : null,
      hiddenBySnakeCount > 0 ? "snake" : null,
    ].filter(Boolean).join("+") || "none";
    const signature = [
      this.tick,
      timerCellIndex,
      snakePriorityActive,
      hiddenBy,
    ].join(":");
    if (signature === this.clockBirthRipplePriorityDebugSignature) return;
    debug.transition(
      "countdown-ripple-priority state=active tick=%d timerCell=%d snakePriority=%s sourceCells=%d hiddenByTimer=%d hiddenBySnake=%d visibleCells=%d",
      this.tick,
      timerCellIndex,
      snakePriorityActive ? "yes" : "no",
      sourceCells.length,
      hiddenByTimerCount,
      hiddenBySnakeCount,
      this.clockBirthRippleRenderCells.length,
    );
    this.clockBirthRipplePriorityDebugSignature = signature;
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

  snakeStateAt(tick, ownBodyCellIndices = [], forcedSecondaryDirection = null) {
    if (!Array.isArray(ownBodyCellIndices)) {
      throw new TypeError("Countdown snake own body cells must be an array.");
    }
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
    const colorVariation = countdownSnakeColorVariation(
      this.snakeSettings.colorVariations,
      seed,
      tick,
    );
    const selectedSecondaryDirection = countdownSnakeSecondaryDirection(
      this.snakeSettings.secondaryMovement,
      seed,
      tick,
    );
    if (
      forcedSecondaryDirection !== null
      && !this.snakeSettings.secondaryMovement.directions.includes(
        forcedSecondaryDirection,
      )
    ) {
      throw new RangeError("Countdown snake forced direction is unsupported.");
    }
    const secondaryDirection = forcedSecondaryDirection
      ?? selectedSecondaryDirection;
    const textSafeCellIndices = countdownSnakeTextSafeCells(
      this.layout,
      this.timerTextCellIndexAt(sourceCellIndex, tick),
    );
    const targetSafeCellIndices = countdownSnakeTextSafeCells(
      this.layout,
      this.timerTextCellIndexAt(targetCellIndex, destinationTick),
    ).filter(index => index !== targetCellIndex);
    const blockedCellIndices = [
      ...new Set([
        ...textSafeCellIndices,
        ...targetSafeCellIndices,
        ...ownBodyCellIndices.filter(index => (
          index !== sourceCellIndex && index !== targetCellIndex
        )),
      ]),
    ];
    let secondaryRoute = null;
    let secondaryRouteError = null;
    if (secondaryDirection !== "none") {
      const directionAttempts = [
        secondaryDirection,
        ...this.snakeSettings.secondaryMovement.directions.filter(
          direction => direction !== secondaryDirection,
        ),
      ];
      for (const direction of directionAttempts) {
        try {
          secondaryRoute = countdownSnakeWrappedPath(
            this.layout,
            sourceCellIndex,
            targetCellIndex,
            seed,
            blockedCellIndices,
            direction,
          );
          break;
        } catch (error) {
          if (!/cannot reach a .* wrap without crossing blocked cells/.test(
            error?.message ?? "",
          )) throw error;
          secondaryRouteError = error;
        }
      }
      if (secondaryRoute === null) throw secondaryRouteError;
    }
    const pathBetweenCells = secondaryRoute?.path ?? countdownSnakePath(
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
        colorVariation,
        secondaryMovement: {
          enabled: secondaryRoute !== null,
          preferredDirection: secondaryDirection,
          direction: secondaryRoute?.direction ?? "none",
          avoidance: secondaryRoute?.avoidance ?? "none",
          exitColumn: secondaryRoute?.exitColumn ?? null,
          wrapStep: secondaryRoute === null ? null : secondaryRoute.wrapStep - 1,
        },
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

  snakeStateAvoidingBodyAt(tick, ownBodyCellIndices) {
    const blocked = new Set(ownBodyCellIndices);
    let collisionState = null;
    const directionAttempts = [
      null,
      ...(this.snakeSettings.secondaryMovement.enabled
        ? this.snakeSettings.secondaryMovement.directions
        : []),
    ];
    for (const direction of directionAttempts) {
      let candidate;
      try {
        candidate = this.snakeStateAt(tick, ownBodyCellIndices, direction);
      } catch (error) {
        if (!/Countdown snake (?:path cannot avoid|cannot reach)/.test(
          error?.message ?? "",
        )) throw error;
        continue;
      }
      const crossesBody = candidate.plan.path.some(index => blocked.has(index));
      if (!crossesBody) return { state: candidate, fallback: false };
      collisionState ??= candidate;
    }
    return {
      state: collisionState ?? this.snakeStateAt(tick),
      fallback: true,
    };
  }

  prepareSnakeHandoff() {
    const snakeTicks = this.effectTicks("snake", 0);
    // The first visible snake route may be a scheduled dive/emerge route. The
    // clock handoff must target that rendered route, not its simpler base path.
    this.prepareSnakePlan(snakeTicks.startTick, false);
    this.clockSnakeHandoff = {
      tick: snakeTicks.startTick,
      plan: this.snakePlan,
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
        this.timerTextCellIndexAt(cellIndex, tick),
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
        colorVariation: this.snakeHandoff.plan.colorVariation,
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
    let renderFrame;
    if (state.connectorActive && this.snakeEngorgementPlan !== null) {
      this.snakeEngorgementFrame = countdownSnakeEngorgementFrame(
        this.snakeEngorgementPlan,
        state.connectorProgress,
        this.snakeSettings,
      );
      renderFrame = this.snakeEngorgementFrame;
      this.snakeFieldCommitState = "planning";
    } else if (
      state.deathCommitted
      && this.appearanceStage.trackId === this.snakeBubblesConnection?.to
      && this.snakeDeathSnapshot !== null
    ) {
      this.snakeEngorgementFrame = countdownSnakeEngorgementFrame(
        this.snakeEngorgementPlan,
        1,
        this.snakeSettings,
      );
      renderFrame = { ...this.snakeEngorgementFrame, cells: [] };
      this.snakeFieldCommitState = "pending";
    } else {
      this.snakeEngorgementFrame = null;
      renderFrame = this.snakeFrame;
      this.snakeFieldCommitState = "idle";
    }
    const timerCellIndex = this.timerTextCellIndexAt(this.cellIndex, this.tick);
    const clearTimerCell = frame => {
      if (frame === null) return { frame: null, hiddenCellCount: 0 };
      const cells = frame.cells.filter(cell => cell.index !== timerCellIndex);
      return {
        frame: cells.length === frame.cells.length ? frame : { ...frame, cells },
        hiddenCellCount: frame.cells.length - cells.length,
      };
    };
    const main = clearTimerCell(renderFrame);
    const disappearance = clearTimerCell(this.snakeDisappearanceFrame);
    this.snakeRenderFrame = main.frame;
    this.snakeDisappearanceRenderFrame = disappearance.frame;
    this.snakeTextSafeCellIndex = timerCellIndex;
    this.snakeTextSafeHiddenCellCount = main.hiddenCellCount
      + disappearance.hiddenCellCount;
  }

  snakeLifecycleFramesAt(snakeLinearProgress, beatProgress) {
    const phase = this.snakeDisappearancePlan.phase;
    if (phase === "move") {
      const snakeFrame = countdownSnakeFrame(
        this.snakePlan,
        snakeLinearProgress,
        this.snakeFrameSettings,
      );
      const disappearanceFrame = countdownSnakeDisappearanceFrame(
        this.snakeDisappearancePlan.completedFrame,
        "instant",
        beatProgress,
      );
      return this.snakeFramesWithSelfCollision(snakeFrame, disappearanceFrame);
    }

    const progress = Math.max(0, Math.min(1, beatProgress));
    const lifecycleProgress = phase === "dive"
      ? progress * 0.5
      : 0.5 + progress * 0.5;
    const tailProgress = phase === "dive" ? 0 : progress;
    const tailFrame = countdownSnakeDisappearanceFrame(
      this.snakeDisappearancePlan.completedFrame,
      "tail-dive",
      tailProgress,
    );
    const retreatProgress = phase === "dive" ? 0 : progress * progress;
    const peakLength = this.snakePlan.peakLengthCells;
    const normalLength = this.snakePlan.normalLengthCells;
    const routeLength = Math.max(
      normalLength,
      Math.round(peakLength + (normalLength - peakLength) * retreatProgress),
    );
    const routeFrame = countdownSnakeFrame(
      this.snakePlan,
      progress,
      { ...this.snakeFrameSettings, lengthCells: routeLength },
    );
    const snakeFrame = countdownSnakeDiveFrame(
      tailFrame,
      routeFrame,
      lifecycleProgress,
      this.snakeSettings.maximumSubdivisionLevel,
    );
    const disappearanceFrame = {
      ...tailFrame,
      cells: [],
    };
    return this.snakeFramesWithSelfCollision(snakeFrame, disappearanceFrame);
  }

  snakeFramesWithSelfCollision(snakeFrame, disappearanceFrame) {
    const disappearingCells = new Set(
      disappearanceFrame.cells.map(cell => cell.index),
    );
    const collisionCellIndices = [...new Set([
      ...(snakeFrame.selfCollision?.cellIndices ?? []),
      ...(disappearanceFrame.selfCollision?.cellIndices ?? []),
      ...snakeFrame.cells
        .map(cell => cell.index)
        .filter(index => disappearingCells.has(index)),
    ])];
    const selfCollision = {
      active: this.snakeSettings.selfCollision.enabled
        && collisionCellIndices.length > 0,
      cellIndices: collisionCellIndices,
      flickerMode: this.snakeSettings.selfCollision.flickerMode,
    };
    return {
      snakeFrame: { ...snakeFrame, selfCollision },
      disappearanceFrame: { ...disappearanceFrame, selfCollision },
    };
  }

  resolveSnakeDisappearanceSchedule(modes) {
    const count = modes.length;
    const diveAt = Array(count).fill(false);
    let startTick = modes.findIndex(mode => mode === "instant");
    if (startTick < 0) startTick = 0;
    const diveTicks = [];
    for (let offset = 0; offset < count; offset += 1) {
      const tick = (startTick + offset) % count;
      const dive = modes[tick] === "tail-dive" && diveTicks.every(otherTick => {
        const distance = Math.abs(tick - otherTick);
        return Math.min(distance, count - distance) >= 3;
      });
      diveAt[tick] = dive;
      if (dive) diveTicks.push(tick);
    }
    return modes.map((selectedMode, tick) => {
      const previousTick = (tick + count - 1) % count;
      return {
        selectedMode,
        phase: diveAt[tick]
          ? "dive"
          : (diveAt[previousTick] ? "emerge" : "move"),
      };
    });
  }

  prepareSnakeDisappearancePlan(tick, emitDebug = true) {
    const lifecycle = this.snakeDisappearanceSchedule[tick];
    const diveTick = lifecycle.phase === "emerge"
      ? (tick + this.countFromSeconds - 1) % this.countFromSeconds
      : tick;
    const sourceTick = (
      diveTick + this.countFromSeconds - 1
    ) % this.countFromSeconds;
    const sourceState = this.snakeStateAt(sourceTick);
    const completedFrame = countdownSnakeFrame(
      sourceState.plan,
      1,
      sourceState.frameSettings,
    );
    const mode = lifecycle.phase === "move" ? "instant" : "tail-dive";
    this.snakeDisappearancePlan = {
      tick,
      diveTick,
      sourceTick,
      selectedMode: lifecycle.selectedMode,
      phase: lifecycle.phase,
      mode,
      completedFrame,
    };
    this.snakeDisappearanceFrame = countdownSnakeDisappearanceFrame(
      completedFrame,
      mode,
      0,
    );
    if (emitDebug && this.snakeSettings.enabled) {
      debug.plan(
        "countdown-snake-disappearance tick=%d sourceTick=%d selected=%s phase=%s mode=%s cells=%d",
        tick,
        sourceTick,
        lifecycle.selectedMode,
        lifecycle.phase,
        mode,
        completedFrame.cells.length,
      );
    }
  }

  prepareSnakePlan(tick, emitDebug = true) {
    this.prepareSnakeDisappearancePlan(tick, emitDebug);
    const continuousDive = this.snakeDisappearancePlan.phase !== "move";
    const routeTick = continuousDive
      ? this.snakeDisappearancePlan.diveTick
      : tick;
    const completedBodyCellIndices = continuousDive
      ? this.snakeDisappearancePlan.completedFrame.cells.map(cell => cell.index)
      : [];
    let bodyAvoidanceFallback = false;
    let state = this.snakeStateAt(routeTick);
    if (continuousDive) {
      const avoided = this.snakeStateAvoidingBodyAt(
        routeTick,
        completedBodyCellIndices,
      );
      state = avoided.state;
      bodyAvoidanceFallback = avoided.fallback;
    }
    state.plan.routeTick = routeTick;
    if (continuousDive) {
      const nextRouteTick = (routeTick + 1) % this.countFromSeconds;
      const nextAvoided = this.snakeStateAvoidingBodyAt(nextRouteTick, [
        ...completedBodyCellIndices,
        state.plan.sourceCellIndex,
        ...state.plan.path,
        state.plan.targetCellIndex,
      ]);
      const nextState = nextAvoided.state;
      bodyAvoidanceFallback ||= nextAvoided.fallback;
      const firstRoute = state.plan;
      const secondRoute = nextState.plan;
      const portalStep = firstRoute.path.length + 1;
      const path = [
        firstRoute.sourceCellIndex,
        ...firstRoute.path,
        firstRoute.targetCellIndex,
        ...secondRoute.path,
        secondRoute.targetCellIndex,
      ];
      const firstMovement = firstRoute.secondaryMovement;
      const secondMovement = secondRoute.secondaryMovement;
      const activeMovement = firstMovement.enabled ? firstMovement : secondMovement;
      const wrapStep = firstMovement.enabled
        ? firstMovement.wrapStep + 1
        : (secondMovement.enabled
          ? portalStep + secondMovement.wrapStep + 1
          : null);
      state = {
        ...state,
        growthTick: nextState.growthTick,
        frameSettings: {
          ...nextState.frameSettings,
          timingCurve: [0, 0, 1, 1],
        },
        plan: {
          ...firstRoute,
          routeTick,
          routeTicks: [routeTick, nextRouteTick],
          colorVariation: firstRoute.colorVariation,
          secondaryMovement: {
            ...activeMovement,
            enabled: firstMovement.enabled || secondMovement.enabled,
            wrapStep,
          },
          sourceIndex: path[0],
          targetCellIndex: secondRoute.targetCellIndex,
          targetIndex: path.at(-1),
          hiddenCellIndices: [
            firstRoute.sourceCellIndex,
            firstRoute.targetCellIndex,
            secondRoute.targetCellIndex,
          ],
          textSafeCellIndices: [
            ...new Set([
              ...firstRoute.textSafeCellIndices,
              ...secondRoute.textSafeCellIndices,
            ]),
          ],
          blockedCellIndices: [
            ...new Set([
              ...firstRoute.blockedCellIndices,
              ...secondRoute.blockedCellIndices,
            ]),
          ],
          path,
          portalStep,
          headStartStep: this.snakeDisappearancePlan.phase === "dive"
            ? 0
            : portalStep,
          headEndStep: this.snakeDisappearancePlan.phase === "dive"
            ? portalStep
            : path.length - 1,
          normalLengthCells: nextState.frameSettings.lengthCells,
          peakLengthCells: Math.min(
            this.availableSnakeCellCount,
            this.snakeDisappearancePlan.completedFrame.cells.length + path.length,
          ),
        },
      };
    } else {
      state.plan.hiddenCellIndices = [];
      state.plan.routeTicks = [routeTick];
    }
    const visitedCells = new Set();
    const collisionRiskCellIndices = [];
    for (const index of state.plan.path) {
      if (visitedCells.has(index)) collisionRiskCellIndices.push(index);
      visitedCells.add(index);
    }
    state.plan.selfAvoidance = {
      policy: bodyAvoidanceFallback || collisionRiskCellIndices.length > 0
        ? "collision-fallback"
        : "avoided",
      collisionRiskCellIndices: [...new Set(collisionRiskCellIndices)],
    };
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
        "countdown-effect mode=snake tick=%d routeTick=%d routeTicks=%s evolution=%s evolutionTick=%d growthTick=%d engorgement=%s seed=%d variation=%s lifecycle=%s headSegment=%s selfAvoidance=%s collisionRisk=%s secondaryMovement=%s preferredDirection=%s direction=%s avoidance=%s exitColumn=%s wrapStep=%s length=%d maximum=%d cellFrom=%d cellTo=%d from=%d to=%d textSafeCells=%s path=%s",
        tick,
        routeTick,
        state.plan.routeTicks.join(","),
        state.evolution.evolutionEnabled ? "yes" : "no",
        state.evolution.evolutionTick,
        this.snakeGrowthTick,
        this.snakeEngorgementAt(tick * this.tickSeconds).connectorActive ? "yes" : "no",
        state.plan.seed,
        state.plan.colorVariation,
        this.snakeDisappearancePlan.phase,
        state.plan.headStartStep === undefined
          ? "full"
          : `${state.plan.headStartStep}-${state.plan.headEndStep}`,
        state.plan.selfAvoidance.policy,
        state.plan.selfAvoidance.collisionRiskCellIndices.join(",") || "none",
        state.plan.secondaryMovement.enabled ? "yes" : "no",
        state.plan.secondaryMovement.preferredDirection,
        state.plan.secondaryMovement.direction,
        state.plan.secondaryMovement.avoidance,
        state.plan.secondaryMovement.exitColumn ?? "none",
        state.plan.secondaryMovement.wrapStep ?? "none",
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

  clockPlanAt(tick, {
    planTick = tick,
    travelingBeatOffsetActive = false,
    travelingBeatDurationBeats = 1,
    forceFarSeparated = false,
  } = {}) {
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
    const textCellIndex = countdownCellIndex(
      this.projectSeed,
      tick,
      this.layout,
      this.minimumCellDistance,
      this.countFromSeconds,
    );
    const birthRippleTextCellIndex = this.clockBirthRippleWindow === null
      ? textCellIndex
      : countdownCellIndex(
        this.projectSeed,
        Math.floor(this.clockBirthRippleWindow.startSeconds / this.tickSeconds),
        this.layout,
        this.minimumCellDistance,
        this.countFromSeconds,
      );
    return {
      ...countdownClockPlan({
      seed,
      tick: planTick,
      layout: this.layout,
      cellIndex: textCellIndex,
      subdivisionLevel: this.clockSettings.subdivisionLevel,
      squareCount: this.clockSettings.squareCount,
      dotsPerSquare: this.clockSettings.dotsPerSquare,
      travelingSquareStaggerBeats:
        this.clockSettings.travelingSquareStaggerBeats,
      travelingBeatOffsetActive,
      travelingBeatDurationBeats,
      forceFarSeparated,
      farSeparationProbability: this.clockSettings.farSeparation.enabled
        ? this.clockSettings.farSeparation.probability
        : 0,
      farSeparationMinimumRadiusInCells:
        this.clockSettings.farSeparation.minimumRadiusInCells,
      evolutionSquareSizes: this.clockSettings.evolutionSquareSizes,
      evolutionEnabled: connectorEvolutionEnabled,
      evolutionProgress: connectorEvolutionProgress,
      handoffCellIndex,
      birthRippleTextCellIndex,
      rangeInSubdivisions: this.clockSettings.rangeInSubdivisions,
      textSafeZone: this.textSafeZone,
      minimumSquareGapInSubdivisions:
        this.clockSettings.minimumSquareGapInSubdivisions,
      }),
      connectorEvolutionEnabled,
      connectorEvolutionTick,
      timelineTick: tick,
    };
  }

  prepareClockPlan(tick, emitDebug = true) {
    this.clockPlan = this.clockPlanAt(tick);
    if (
      emitDebug
      && this.clockSettings.enabled
      && this.appearanceStage.effect === "clock"
    ) {
      debug.plan(
        "countdown-effect mode=clock tick=%d evolution=%s evolutionTick=%d seed=%d cell=%d mode=%s size=%d handoff=%d squares=%d safeText=%s squareGap=%d reserveExpansion=%s farSeparated=%s separation=%.3f motion=%s rotation=%s staggerBeats=%s reservations=%s placements=%s dots=%s",
        tick,
        this.clockPlan.connectorEvolutionEnabled ? "yes" : "no",
        this.clockPlan.connectorEvolutionTick,
        this.clockPlan.seed,
        this.clockPlan.textCellIndex,
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
          square.rotationDirection ?? "none"
        )).join(","),
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

  clockOffsetScheduleStateAt(localTime) {
    const activeClockTrack = this.synthState.activeTracks.find(
      state => state.track.use === "clock",
    );
    if (activeClockTrack === undefined) return null;
    const scheduleInfo = this.clockOffsetSchedules.get(activeClockTrack.track.id);
    if (
      scheduleInfo === undefined
      || localTime < scheduleInfo.startSeconds
      || localTime >= scheduleInfo.endSeconds
    ) return null;
    const beatTime = (localTime - scheduleInfo.startSeconds) / this.tickSeconds;
    const state = countdownClockOffsetStateAt(scheduleInfo.schedule, beatTime);
    return state === null ? null : { scheduleInfo, state };
  }

  clockOffsetPlanAt(scheduleInfo, state) {
    const key = `${scheduleInfo.trackId}:${state.instanceOrdinal}`;
    const cached = this.clockOffsetPlanCache.get(key);
    if (cached !== undefined) return cached;
    const sourceSeconds = scheduleInfo.startSeconds
      + state.instanceStartBeat * this.tickSeconds;
    const timelineTick = Math.min(
      this.countFromSeconds - 1,
      Math.floor(sourceSeconds / this.tickSeconds + 1e-9),
    );
    const planTick = (scheduleInfo.trackIndex + 1) * 100000
      + state.instanceOrdinal;
    const plan = this.clockPlanAt(timelineTick, {
      planTick,
      travelingBeatOffsetActive: true,
      travelingBeatDurationBeats: state.durationBeats,
      forceFarSeparated: true,
    });
    this.clockOffsetPlanCache.set(key, plan);
    return plan;
  }

  emitClockOffsetTransition(scheduleState) {
    const signature = scheduleState === null
      ? "inactive"
      : [
        scheduleState.scheduleInfo.trackId,
        scheduleState.state.blockIndex,
        scheduleState.state.instanceOrdinal,
      ].join(":");
    if (signature === this.clockOffsetDebugSignature) return;
    this.clockOffsetDebugSignature = signature;
    if (scheduleState === null) {
      debug.transition("countdown-clock-offset state=inactive");
      return;
    }
    const { scheduleInfo, state } = scheduleState;
    debug.transition(
      "countdown-clock-offset state=%s track=%s pattern=%s block=%d instance=%d/%d startBeat=%.3f durationBeats=%.3f resyncBeat=%.3f remainingBeats=%.3f",
      state.active ? "active" : "synced",
      scheduleInfo.trackId,
      state.patternId,
      state.blockIndex,
      state.instanceIndex + 1,
      state.repeatCount,
      state.instanceStartBeat,
      state.durationBeats,
      state.blockEndBeat,
      state.remainingBeats,
    );
  }

  prepareClockFrame(localTime, beatElapsed) {
    const primaryFrame = countdownClockFrame(
      this.clockPlan,
      beatElapsed / this.clockSettings.duration.seconds,
      this.clockSettings,
      this.clockBirthRippleProgressAt(localTime),
    );
    const scheduleState = this.clockOffsetScheduleStateAt(localTime);
    this.clockOffsetState = scheduleState?.state ?? null;
    this.emitClockOffsetTransition(scheduleState);
    if (
      scheduleState === null
      || !scheduleState.state.active
      || primaryFrame.birthRipple !== null
    ) {
      return primaryFrame;
    }
    const offsetPlan = this.clockOffsetPlanAt(
      scheduleState.scheduleInfo,
      scheduleState.state,
    );
    const offsetFrame = countdownClockFrame(
      offsetPlan,
      scheduleState.state.instanceAgeBeats,
      this.clockSettings,
    );
    return combineCountdownClockRoleFrames(
      countdownClockFrameByRoles(primaryFrame, ["anchored"]),
      [countdownClockFrameByRoles(offsetFrame, ["traveling"])],
    );
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
    const cellIndex = countdownCellIndex(
      this.projectSeed,
      tick,
      this.layout,
      this.minimumCellDistance,
      this.countFromSeconds,
    );
    const textSafeRectangle = this.frameTextSafeRectangleAt(cellIndex, tick);
    const retainedSquares = retainedPlan?.squares ?? [];
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
      centered: tick === this.countFromSeconds - 1,
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
    this.frameTextSafeCellIndex = this.timerTextCellIndexAt(
      this.cellIndex,
      this.tick,
    );
    this.frameTextSafeRectangle = this.frameTextSafeRectangleAt(
      this.cellIndex,
      this.tick,
    );
    const subdivisions = 1 << this.frameSettings.subdivisionLevel;
    this.frameTextSafeCellCount = (
      (this.frameTextSafeRectangle.right - this.frameTextSafeRectangle.left)
        / subdivisions
    ) * (
      (this.frameTextSafeRectangle.bottom - this.frameTextSafeRectangle.top)
        / subdivisions
    );
    const bubblesAfterMerge = this.hasSnakeBubblesConnector
      && this.snakeSettings.mergeIntoBubbles
      && this.appearanceStage.trackId === this.snakeBubblesConnection.to
      && this.synthState.localTime >= this.snakeBubblesConnection.endSeconds;
    if (!bubblesAfterMerge || this.snakeDeathSnapshot === null) {
      this.snakeBubblePlan = null;
      this.snakeBubbleFrame = null;
      this.frameRenderPlan = this.framePlan;
      return;
    }
    const sourceTick = this.snakeHandoff?.tick ?? this.tick;
    const waterfallStep = Math.max(0, Math.floor(
      (this.synthState.localTime - this.snakeBubblesConnection.endSeconds)
        / this.tickSeconds
      + 1e-9,
    ));
    this.snakeBubblePlan = countdownSnakeBubblePlan({
      layout: this.layout,
      cells: this.snakeDeathSnapshot.cells,
      progress: 1,
      appearanceTick: sourceTick,
      subdivisionLevel: this.frameSettings.subdivisionLevel,
      waterfallStep,
    });
    this.frameRenderPlan = countdownFramePlanWithSnakeTrail(
      this.framePlan,
      this.snakeBubblePlan,
    );
    this.snakeBubbleFrame = null;
    this.snakeFieldCommitState = "committed";
  }

  frameTextSafeRectangleAt(cellIndex, tick) {
    const subdivisions = 1 << this.frameSettings.subdivisionLevel;
    const timerCellIndex = this.timerTextCellIndexAt(cellIndex, tick);
    const column = timerCellIndex % this.layout.columns;
    const row = Math.floor(timerCellIndex / this.layout.columns);
    return {
      left: column * subdivisions,
      top: row * subdivisions,
      right: (column + 1) * subdivisions,
      bottom: (row + 1) * subdivisions,
    };
  }

  timerTextCellIndexAt(cellIndex, tick) {
    if (tick !== this.countFromSeconds - 1) return cellIndex;
    return Math.floor(this.layout.rows / 2) * this.layout.columns
      + Math.floor(this.layout.columns / 2);
  }

  emitFrameTextClearTransition() {
    const active = this.appearanceStage.effect === "bubbles"
      && this.frameFrame !== null;
    const signature = active
      ? [
        this.tick,
        this.frameTextSafeCellIndex,
        this.snakeBubblePlan?.waterfallStep ?? -1,
        this.frameTextSafeCellCount,
        this.frameFrame.rectangleAvoidedSnakeSquareCount,
        this.frameFrame.rectangleAvoidedGeneratedSquareCount,
        this.frameFrame.rectangleHiddenDotCount,
      ].join(":")
      : "";
    if (signature === this.frameTextClearDebugSignature) return;
    if (active) {
      debug.transition(
        "countdown-bubbles-text-clear state=active mode=render-only tick=%d cell=%d cells=%d inheritedSquares=%d generatedSquares=%d hiddenDots=%d centered=%s",
        this.tick,
        this.frameTextSafeCellIndex,
        this.frameTextSafeCellCount,
        this.frameFrame.rectangleAvoidedSnakeSquareCount,
        this.frameFrame.rectangleAvoidedGeneratedSquareCount,
        this.frameFrame.rectangleHiddenDotCount,
        this.tick === this.countFromSeconds - 1 ? "yes" : "no",
      );
    } else if (this.frameTextClearDebugSignature !== "") {
      debug.transition("countdown-bubbles-text-clear state=inactive");
    }
    this.frameTextClearDebugSignature = signature;
  }

  emitSnakeTextClearTransition() {
    const active = this.appearanceStage.effect === "snake"
      && this.snakeRenderFrame !== null;
    const owner = this.synthState.activeConnections.some(
      state => state.connection.use === "snake-to-bubbles",
    ) ? "connector" : "track";
    const signature = active
      ? [
        this.tick,
        this.snakeTextSafeCellIndex,
        this.snakeTextSafeHiddenCellCount,
        owner,
      ].join(":")
      : "";
    if (signature === this.snakeTextClearDebugSignature) return;
    if (active) {
      debug.transition(
        "countdown-snake-text-clear state=active tick=%d cell=%d hiddenCells=%d owner=%s",
        this.tick,
        this.snakeTextSafeCellIndex,
        this.snakeTextSafeHiddenCellCount,
        owner,
      );
    } else if (this.snakeTextClearDebugSignature !== "") {
      debug.transition("countdown-snake-text-clear state=inactive");
    }
    this.snakeTextClearDebugSignature = signature;
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
    const ownedBeatCount = effectTicks.endTick - effectTicks.startTick + 1;
    const trackProgress = Math.max(0, Math.min(1, (
      tick - effectTicks.startTick + beatFraction
    ) / ownedBeatCount));
    const bubbles = [];
    const lifetime = this.frameSettings.avoidance.durationBeats;
    const historyLength = Math.ceil(lifetime);
    for (let tickOffset = 0; tickOffset < historyLength; tickOffset += 1) {
      const ageBeats = tickOffset + beatFraction;
      if (ageBeats >= lifetime) continue;
      const sourceTick = tick - tickOffset;
      if (sourceTick < effectTicks.startTick) continue;
      const sourceProgress = (
        sourceTick - effectTicks.startTick
      ) / ownedBeatCount;
      if (
        this.frameSettings.avoidance.finalWipe.enabled
        && sourceProgress >= this.frameSettings.avoidance.finalWipe.startProgress
      ) continue;
      const sourceCellIndex = countdownCellIndex(
        this.projectSeed,
        sourceTick,
        this.layout,
        this.minimumCellDistance,
        this.countFromSeconds,
      );
      const radiusInCells = countdownFrameAvoidanceRadiusAt(
        sourceProgress,
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
        centered: sourceTick === this.countFromSeconds - 1,
      }).map(circle => ({ ...circle, sourceTick }));
      bubbles.push({
        kind: "ink-spot",
        sourceTick,
        sourceCellIndex,
        ageBeats,
        radiusInCells,
        ...envelopes,
        circles,
      });
    }
    const finalWipe = countdownFrameFinalWipeAt({
      layout: this.layout,
      progress: trackProgress,
      subdivisionLevel: this.frameSettings.subdivisionLevel,
      finalWipe: this.frameSettings.avoidance.finalWipe,
      timingCurve: this.frameSettings.avoidance.finalWipe.timingCurve,
      displacementMaximumInCells:
        this.frameSettings.visibilityMap.displacement.maximumInCells,
    });
    if (finalWipe !== null) {
      bubbles.push({
        kind: "final-wipe",
        sourceTick: effectTicks.endTick,
        sourceCellIndex: null,
        ageBeats: (
          trackProgress - this.frameSettings.avoidance.finalWipe.startProgress
        ) * ownedBeatCount,
        radiusInCells: finalWipe.radiusInCells,
        phase: finalWipe.phase,
        emptyEnvelope: finalWipe.easedProgress,
        refillEnvelope: 0,
        progress: finalWipe.progress,
        circles: [{ ...finalWipe.circle, sourceTick: effectTicks.endTick }],
      });
    }
    this.frameAvoidanceBubbles = bubbles;
    this.frameAvoidanceCircles = bubbles.flatMap(bubble => bubble.circles);
  }

  sampleFrameVisibilityMap(time) {
    if (!this.framePlan || !this.frameFieldSettings.enabled) {
      this.frameVisibilityMap = null;
      return;
    }
    const localTime = time % this.durationSeconds;
    const plane = this.frameFieldSampler.samplePlane({
      name: "visibility",
      width: this.framePlan.gridColumns,
      height: this.framePlan.gridRows,
      progress: localTime / this.durationSeconds,
      timeSeconds: localTime,
      temporalOffset: this.frameFieldTemporalOffset,
      projectSeed: this.projectSeed,
      settings: this.frameFieldSettings,
    });
    this.frameVisibilityMap = {
      enabled: true,
      ...plane,
      subdivisions: 1 << this.frameSettings.subdivisionLevel,
      layer: this.frameFieldSettings.layers.visibility,
      displacement: this.frameSettings.visibilityMap.displacement,
    };
    const signature = [
      plane.width,
      plane.height,
      this.projectSeed,
      this.frameFieldSettings.layers.visibility.mode,
    ].join(":");
    if (signature !== this.frameFieldPlanSignature) {
      let minimum = 255;
      let maximum = 0;
      for (const value of plane.data) {
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
      }
      debug.plan(
        "countdown-bubbles-field state=created field=%s columns=%d rows=%d seed=%d minimum=%d maximum=%d displacementMinCells=%.3f displacementRatio=%.3f displacementMaxCells=%.3f",
        this.frameFieldSettings.layers.visibility.mode,
        plane.width,
        plane.height,
        this.frameFieldSettings.layers.visibility.seed,
        minimum,
        maximum,
        this.frameSettings.visibilityMap.displacement.minimumInCells,
        this.frameSettings.visibilityMap.displacement.radiusRatio,
        this.frameSettings.visibilityMap.displacement.maximumInCells,
      );
      this.frameFieldPlanSignature = signature;
    }
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
    const bubblesTrackState = this.synthState.activeTracks.find(
      state => state.track.use === "bubbles",
    ) ?? null;
    const fieldWiggleElapsedBeats = bubblesTrackState === null
      ? 0
      : bubblesTrackState.localSeconds / this.tickSeconds;
    const fieldWiggleDurationBeats = this.frameSettings?.visibilityMap
      .beatWiggleDurationBeats ?? 1;
    const nextFieldWiggleIndex = Math.floor(
      fieldWiggleElapsedBeats / fieldWiggleDurationBeats,
    );
    const fieldWiggleProgress = (
      fieldWiggleElapsedBeats
      - nextFieldWiggleIndex * fieldWiggleDurationBeats
    ) / fieldWiggleDurationBeats;
    const previousFieldWigglePhase = this.frameFieldWigglePhase;
    this.frameFieldWigglePhase = this.frameSettings === null
      ? "out"
      : (fieldWiggleProgress < 0.5 ? "out" : "back");
    this.frameFieldWiggleIndex = nextFieldWiggleIndex;
    this.frameFieldWiggleProgress = fieldWiggleProgress;
    this.frameFieldTemporalOffset = this.frameSettings === null
      ? 0
      : countdownFrameFieldBeatOffsetAt(
        fieldWiggleProgress,
        this.frameSettings.visibilityMap,
      );
    const fieldWiggleChanged = this.frameFieldWigglePhase
      !== previousFieldWigglePhase;
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
        "countdown tick=%d label=%s cell=%d centered=%s",
        this.tick,
        this.label,
        this.cellIndex,
        this.tick === this.countFromSeconds - 1 ? "yes" : "no",
      );
      if (this.tick === this.countFromSeconds - 1) {
        debug.transition(
          "countdown-final-tick state=centered label=%s x=%.3f y=%.3f",
          this.label,
          this.layout.offsetX + this.layout.patternWidth / 2,
          this.layout.offsetY + this.layout.patternHeight / 2,
        );
      }
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
    const previousDisappearanceCellCount =
      this.snakeDisappearanceFrame?.cells.length ?? -1;
    const previousSelfCollisionActive = (
      this.snakeFrame?.selfCollision?.active === true
      || this.snakeDisappearanceFrame?.selfCollision?.active === true
    );
    let nextSnakeFrame = null;
    let nextSnakeRenderFrame = null;
    let snakeChanged = false;
    if (this.hasSnakeTrack) {
      const collisionFrames = this.snakeLifecycleFramesAt(
        beatElapsed / this.snakeSettings.duration.seconds,
        beatProgress,
      );
      nextSnakeFrame = collisionFrames.snakeFrame;
      this.snakeFrame = nextSnakeFrame;
      this.snakeDisappearanceFrame = collisionFrames.disappearanceFrame;
      this.prepareSnakeRenderFrame(localTime);
      nextSnakeRenderFrame = this.snakeRenderFrame;
      snakeChanged = (this.snakeEngorgementFrame?.routeStep ?? -1)
          !== previousSnakeRouteStep
        || (nextSnakeRenderFrame.headIndex ?? nextSnakeFrame.headStep)
          !== previousSnakeHead
        || nextSnakeRenderFrame.cells.length !== previousSnakeRenderedCellCount
        || this.snakeDisappearanceFrame.cells.length
          !== previousDisappearanceCellCount;
    }
    this.emitSnakeTextClearTransition();
    const previousSnakeBubbleCount = this.snakeBubblePlan?.squares.length ?? 0;
    const previousSnakeBubbleWaterfallStep =
      this.snakeBubblePlan?.waterfallStep ?? -1;
    const previousClockVisible = this.clockFrame?.renderSignature ?? "";
    let nextClockFrame = null;
    let clockChanged = false;
    if (this.hasClockTrack) {
      nextClockFrame = this.prepareClockFrame(localTime, beatElapsed);
      this.clockFrame = nextClockFrame;
      this.prepareClockBirthRippleRenderCells();
      clockChanged = nextClockFrame.renderSignature !== previousClockVisible;
    }
    const clockDebugChanged = nextClockFrame?.birthRipple === null
      && clockChanged;
    const previousAvoidancePhases = this.frameAvoidanceBubbles
      .map(bubble => `${bubble.kind}:${bubble.sourceTick}:${bubble.phase}`)
      .join(",");
    if (this.hasBubblesTrack) this.prepareFrameAvoidance(nextTick, beatElapsed);
    this.emitBubblesDebugTransition();
    this.emitBubblesFieldTransitions();
    const avoidancePhases = this.frameAvoidanceBubbles
      .map(bubble => `${bubble.kind}:${bubble.sourceTick}:${bubble.phase}`)
      .join(",");
    const avoidanceChanged = avoidancePhases !== previousAvoidancePhases;
    if (this.hasBubblesTrack) {
      this.sampleFrameVisibilityMap(time);
      this.prepareSnakeBubbleRenderPlan();
    }
    const snakeBubbleChanged = (this.snakeBubblePlan?.squares.length ?? 0)
      !== previousSnakeBubbleCount
      || (this.snakeBubblePlan?.waterfallStep ?? -1)
        !== (previousSnakeBubbleWaterfallStep ?? -1);
    let nextFrameFrame = null;
    if (this.hasBubblesTrack) {
      nextFrameFrame = countdownFrameAt(
        this.frameRenderPlan,
        beatElapsed / this.tickSeconds,
        this.frameSettings,
        this.frameAvoidanceCircles,
        this.frameVisibilityMap,
        [],
        [this.frameTextSafeRectangle],
      );
      this.frameFrame = nextFrameFrame;
    }
    this.emitFrameTextClearTransition();
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
      && !fieldWiggleChanged
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
        "countdown-snake stage=%s tick=%d lifecycle=%s engorgement=%s direction=%s wrapped=%s wrapStep=%s head=%d/%d cell=%d levels=%s progress=%.3f",
        this.appearanceStage.effect,
        this.tick,
        this.snakeDisappearancePlan.phase,
        this.snakeEngorgementFrame !== null ? "yes" : "no",
        nextSnakeFrame.secondaryMovement.direction,
        nextSnakeFrame.secondaryMovement.wrapped ? "yes" : "no",
        nextSnakeFrame.secondaryMovement.wrapStep ?? "none",
        nextSnakeFrame.headStep,
        this.snakePlan.path.length - 1,
        nextSnakeRenderFrame.headIndex
          ?? nextSnakeRenderFrame.cells.at(-1)?.index
          ?? -1,
        nextSnakeRenderFrame.cells.map(cell => cell.level).join(","),
        this.snakeEngorgementFrame?.progress ?? nextSnakeFrame.progress,
      );
    }
    const selfCollisionActive = (
      nextSnakeFrame?.selfCollision?.active === true
      || this.snakeDisappearanceFrame?.selfCollision?.active === true
    );
    if (
      this.hasSnakeTrack
      && this.appearanceStage.effect === "snake"
      && selfCollisionActive !== previousSelfCollisionActive
    ) {
      debug.transition(
        "countdown-snake-collision tick=%d state=%s cells=%s flicker=%s",
        this.tick,
        selfCollisionActive ? "start" : "end",
        nextSnakeFrame.selfCollision.cellIndices.join(",") || "none",
        this.snakeSettings.selfCollision.flickerMode,
      );
    }
    if (
      this.hasSnakeTrack
      && this.appearanceStage.effect === "snake"
      && this.snakeSettings.enabled
      && this.snakeDisappearanceFrame.cells.length
        !== previousDisappearanceCellCount
    ) {
      debug.transition(
        "countdown-snake-disappearance tick=%d sourceTick=%d selected=%s phase=%s mode=%s remaining=%d/%d progress=%.3f",
        this.tick,
        this.snakeDisappearancePlan.sourceTick,
        this.snakeDisappearancePlan.selectedMode,
        this.snakeDisappearancePlan.phase,
        this.snakeDisappearanceFrame.mode,
        this.snakeDisappearanceFrame.cells.length,
        this.snakeDisappearanceFrame.totalCellCount,
        this.snakeDisappearanceFrame.progress,
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
          "countdown-clock tick=%d mode=%s size=%d visible=%d sourceVisible=%d/%d activeSquares=%d offsetSquares=%d sourceTicks=%s visibleBySquare=%s dotSizes=%s waterfallProbability=%s beatDurationBeats=%s handoff=%d progress=%.3f",
          this.tick,
          nextClockFrame.evolutionMode,
          nextClockFrame.squareSize,
          nextClockFrame.visibleCount,
          nextClockFrame.sourceVisibleCount,
          nextClockFrame.totalDotCount,
          nextClockFrame.squares.filter(square => square.active).length,
          nextClockFrame.offsetSquareCount ?? 0,
          nextClockFrame.squares.map(square => square.sourceTick).join(","),
          nextClockFrame.visibleCountsBySquare.join(","),
          nextClockFrame.dots.map(dot => dot.sizeInSubdivisions ?? 1).join(","),
          nextClockFrame.squares.map(square => (
            square.waterfallProbability
          ).toFixed(3)).join(","),
          nextClockFrame.squares.map(square => (
            square.beatDurationBeats
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
        || fieldWiggleChanged
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
        "countdown-bubbles tick=%d visible=%d/%d snakeHidden=%d fieldHidden=%d avoided=%d bubbles=%d wipe=%s emptyRadius=%.3f refillRadius=%.3f pushRadiusCells=%.3f fieldWiggle=%s fieldWiggleIndex=%d fieldWiggleProgress=%.3f fieldOffset=%.3f progress=%.3f",
        this.tick,
        nextFrameFrame.visibleCount,
        this.frameRenderPlan.dots.length,
        nextFrameFrame.snakeHiddenCount,
        nextFrameFrame.fieldHiddenCount,
        nextFrameFrame.avoidedSquareCount,
        this.frameAvoidanceBubbles.length,
        avoidancePhases || "none",
        maximumEmptyRadius,
        maximumRefillRadius,
        this.frameAvoidanceRadiusInCells,
        this.frameFieldWigglePhase,
        this.frameFieldWiggleIndex,
        this.frameFieldWiggleProgress,
        this.frameFieldTemporalOffset,
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
        { cells: this.clockBirthRippleRenderCells },
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
      const selfCollisionActive = (
        this.snakeFrame?.selfCollision?.active === true
        || this.snakeDisappearanceFrame?.selfCollision?.active === true
      );
      const activeSnakeFlicker = selfCollisionActive
        ? this.snakeCollisionFlicker
        : this.snakeFlicker;
      if (this.snakeDisappearanceRenderFrame?.cells.length > 0) {
        drawCountdownSnake(
          context,
          this.layout,
          this.snakeDisappearanceRenderFrame,
          this.snakeSettings,
          this.snakePalette,
          activeSnakeFlicker,
          this.elapsed,
        );
      }
      drawCountdownSnake(
        context,
        this.layout,
        this.snakeRenderFrame,
        this.snakeSettings,
        this.snakePalette,
        activeSnakeFlicker,
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

  emitBubblesFieldTransitions() {
    const nextPhases = new Map();
    for (const bubble of this.frameAvoidanceBubbles) {
      const key = `${bubble.kind}:${bubble.sourceTick}`;
      nextPhases.set(key, bubble.phase);
      if (this.bubblesFieldDebugState.phases.get(key) === bubble.phase) continue;
      debug.transition(
        "countdown-bubbles-ink state=%s kind=%s sourceTick=%d radiusCells=%.3f empty=%.3f refill=%.3f circles=%d",
        bubble.phase,
        bubble.kind,
        bubble.sourceTick,
        bubble.radiusInCells,
        bubble.emptyEnvelope,
        bubble.refillEnvelope,
        bubble.circles.length,
      );
    }
    for (const [key] of this.bubblesFieldDebugState.phases) {
      if (nextPhases.has(key)) continue;
      const separator = key.lastIndexOf(":");
      debug.transition(
        "countdown-bubbles-ink state=complete kind=%s sourceTick=%d",
        key.slice(0, separator),
        Number(key.slice(separator + 1)),
      );
    }
    this.bubblesFieldDebugState.phases = nextPhases;
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
        this.snakeBubblePlan?.occupiedTileCount ?? 0,
        this.snakeDeathSnapshot?.consumedMealIndex ?? -1,
      );
    }
    const waterfallStep = this.snakeBubblePlan?.waterfallStep ?? -1;
    if (committed && waterfallStep !== this.engorgementDebugState.waterfallStep) {
      const levels = [0, 1, 2, 3].map(level => this.snakeBubblePlan.squares.filter(
        square => square.currentLevel === level,
      ).length);
      debug.transition(
        "countdown-bubbles-inheritance step=%d inheritedCells=%d releasedCells=%d levels=%s glyphGroups=%d dots=%d",
        waterfallStep,
        this.snakeBubblePlan.inheritedCellCount,
        this.snakeBubblePlan.releasedCellCount,
        levels.join(","),
        this.snakeBubblePlan.squares.length,
        this.snakeBubblePlan.dots.length,
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
      waterfallStep,
    };
  }

  draw(frame, planEntry, context) {
    if (!this.active) return;
    const column = this.cellIndex % this.layout.columns;
    const row = Math.floor(this.cellIndex / this.layout.columns);
    const centered = this.tick === this.countFromSeconds - 1;
    const x = centered
      ? this.layout.offsetX + this.layout.patternWidth / 2
      : this.layout.offsetX + (column + 0.5) * this.layout.cellSize;
    const y = centered
      ? this.layout.offsetY + this.layout.patternHeight / 2
      : this.layout.offsetY + (row + 0.5) * this.layout.cellSize;
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
      const debugBubbles = (
        this.frameSettings.debug.visualizeBubbles
        && this.frameRenderPlan !== null
      )
        ? this.frameAvoidanceBubbles.map(bubble => ({
          ...bubble,
          avoidedSquareIndices: countdownFrameAvoidedSquareIndices(
            this.frameRenderPlan,
            bubble.circles,
            this.frameVisibilityMap,
          ),
        }))
        : this.frameAvoidanceBubbles;
      drawCountdownBubblesDebug(
        context,
        this.layout,
        debugBubbles,
        this.frameSettings.debug,
        this.frameSettings.subdivisionLevel,
        this.framePalette.at(-1),
        this.frameRenderPlan,
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

  countdownFieldPreviewSnapshot({ previewWidth, previewHeight } = {}) {
    if (!this.framePlan || !this.frameFieldSettings.enabled) return null;
    const dense = Number.isFinite(previewWidth) && Number.isFinite(previewHeight);
    const width = dense
      ? Math.max(2, Math.trunc(previewWidth))
      : this.framePlan.gridColumns;
    const height = dense
      ? Math.max(2, Math.trunc(previewHeight))
      : this.framePlan.gridRows;
    const localTime = this.elapsed % this.durationSeconds;
    const displacement = dense
      ? this.frameFieldSampler.samplePlane({
        name: "visibility",
        width,
        height,
        progress: localTime / this.durationSeconds,
        timeSeconds: localTime,
        temporalOffset: this.frameFieldTemporalOffset,
        projectSeed: this.projectSeed,
        settings: this.frameFieldSettings,
      }).data
      : this.frameVisibilityMap?.data.slice();
    if (!displacement) return null;
    const threshold = this.frameFieldSettings.layers.visibility.threshold * 255;
    const opacity = Uint8Array.from(
      displacement,
      value => value >= threshold ? 255 : 0,
    );
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
          id: "ink-opacity",
          label: "ink field opacity",
          data: opacity,
          width,
          height,
        },
        {
          id: "ink-displacement",
          label: "ink shard displacement",
          data: displacement,
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
    const fieldData = this.frameVisibilityMap?.data ?? null;
    const fieldSummary = fieldData === null ? null : {
      minimum: fieldData.reduce((minimum, value) => Math.min(minimum, value), 255),
      maximum: fieldData.reduce((maximum, value) => Math.max(maximum, value), 0),
      mean: fieldData.reduce((sum, value) => sum + value, 0) / fieldData.length,
    };
    return {
      generatorInstanceId: this.generatorInstanceId,
      generatorType: "countdown-framed",
      settingsKey: this.settingsKey,
      active: this.active,
      elapsed: this.elapsed,
      tick: this.tick,
      remainingSeconds: this.remainingSeconds,
      label: this.label,
      textCentered: this.tick === this.countFromSeconds - 1,
      textCenter: this.tick === this.countFromSeconds - 1
        ? {
          x: this.layout.offsetX + this.layout.patternWidth / 2,
          y: this.layout.offsetY + this.layout.patternHeight / 2,
        }
        : {
          x: this.layout.offsetX
            + (this.cellIndex % this.layout.columns + 0.5) * this.layout.cellSize,
          y: this.layout.offsetY
            + (Math.floor(this.cellIndex / this.layout.columns) + 0.5)
              * this.layout.cellSize,
        },
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
          colorVariations: this.snakeSettings.colorVariations.map(
            variation => ({ ...variation }),
          ),
          disappearanceVariations:
            this.snakeSettings.disappearanceVariations.map(
              variation => ({ ...variation }),
            ),
          selfCollision: {
            ...this.snakeSettings.selfCollision,
            flickerEffect: this.snakeCollisionFlicker.inspect(),
          },
          secondaryMovement: {
            enabled: this.snakeSettings.secondaryMovement.enabled,
            probability: this.snakeSettings.secondaryMovement.probability,
            directions: [...this.snakeSettings.secondaryMovement.directions],
          },
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
          textSafeCellIndex: this.snakeTextSafeCellIndex,
          textSafeHiddenCellCount: this.snakeTextSafeHiddenCellCount,
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
          disappearance: this.snakeDisappearancePlan === null ? null : {
            tick: this.snakeDisappearancePlan.tick,
            diveTick: this.snakeDisappearancePlan.diveTick,
            sourceTick: this.snakeDisappearancePlan.sourceTick,
            selectedMode: this.snakeDisappearancePlan.selectedMode,
            phase: this.snakeDisappearancePlan.phase,
            mode: this.snakeDisappearancePlan.mode,
            linearProgress: this.snakeDisappearanceFrame.linearProgress,
            progress: this.snakeDisappearanceFrame.progress,
            removedCellCount: this.snakeDisappearanceFrame.removedCellCount,
            totalCellCount: this.snakeDisappearanceFrame.totalCellCount,
            selfCollision: {
              ...this.snakeDisappearanceFrame.selfCollision,
              cellIndices: [
                ...(this.snakeDisappearanceFrame.selfCollision?.cellIndices ?? []),
              ],
            },
            cells: this.snakeDisappearanceFrame.cells.map(cell => ({ ...cell })),
          },
          plan: this.snakePlan === null ? null : {
            routeTick: this.snakePlan.routeTick,
            routeTicks: [...this.snakePlan.routeTicks],
            seed: this.snakePlan.seed,
            colorVariation: this.snakePlan.colorVariation,
            secondaryMovement: { ...this.snakePlan.secondaryMovement },
            selfAvoidance: {
              ...this.snakePlan.selfAvoidance,
              collisionRiskCellIndices: [
                ...this.snakePlan.selfAvoidance.collisionRiskCellIndices,
              ],
            },
            hiddenCellIndices: [...this.snakePlan.hiddenCellIndices],
            portalStep: this.snakePlan.portalStep ?? null,
            headStartStep: this.snakePlan.headStartStep ?? null,
            headEndStep: this.snakePlan.headEndStep ?? null,
            normalLengthCells: this.snakePlan.normalLengthCells ?? null,
            peakLengthCells: this.snakePlan.peakLengthCells ?? null,
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
            lifecycleProgress: this.snakeFrame.lifecycleProgress ?? null,
            headStep: this.snakeFrame.headStep,
            colorVariation: this.snakeFrame.colorVariation,
            secondaryMovement: { ...this.snakeFrame.secondaryMovement },
            selfCollision: {
              ...this.snakeFrame.selfCollision,
              cellIndices: [...this.snakeFrame.selfCollision.cellIndices],
            },
            cells: this.snakeFrame.cells.map(cell => ({ ...cell })),
          },
          renderFrame: this.snakeRenderFrame === null ? null : {
            linearProgress: this.snakeRenderFrame.linearProgress,
            progress: this.snakeRenderFrame.progress,
            colorVariation: this.snakeRenderFrame.colorVariation,
            selfCollision: this.snakeRenderFrame.selfCollision === undefined
              ? null
              : {
                ...this.snakeRenderFrame.selfCollision,
                cellIndices: [...this.snakeRenderFrame.selfCollision.cellIndices],
              },
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
          travelingSquareBeatOffset: {
            ...this.clockSettings.travelingSquareBeatOffset,
            patterns: this.clockSettings.travelingSquareBeatOffset.patterns.map(
              pattern => ({ ...pattern }),
            ),
          },
          offsetSchedules: [...this.clockOffsetSchedules.values()].map(info => ({
            trackId: info.trackId,
            startSeconds: info.startSeconds,
            endSeconds: info.endSeconds,
            totalBeats: info.schedule.totalBeats,
            blocks: info.schedule.blocks.map(block => ({
              ...block,
              instances: block.instances.map(instance => ({ ...instance })),
            })),
          })),
          offsetState: this.clockOffsetState === null
            ? null
            : { ...this.clockOffsetState },
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
              rotationDirection: square.rotationDirection ?? null,
              farSeparated: square.farSeparated ?? false,
              appearanceStaggerBeats: square.appearanceStaggerBeats ?? 0,
              beatOffsetActive: square.beatOffsetActive ?? false,
              beatDurationBeats: square.beatDurationBeats ?? 1,
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
            offsetSquareCount: this.clockFrame.offsetSquareCount ?? 0,
            squares: this.clockFrame.squares.map(square => ({ ...square })),
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
                render: this.clockBirthRipplePriority === null
                  ? null
                  : {
                    ...this.clockBirthRipplePriority,
                    cells: this.clockBirthRippleRenderCells.map(cell => ({
                      ...cell,
                      ripples: [...cell.ripples],
                    })),
                  },
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
            renderMode: "displaced-squares",
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
          renderedDotCount: this.frameRenderPlan?.dots.length
            ?? this.frameSettings.squareCount * this.frameSettings.dotsPerSquare,
          numberSpacingInSubdivisions: this.frameSettings.numberSpacingInSubdivisions,
          avoidance: {
            radiusInCells: this.frameSettings.avoidance.radiusInCells,
            radiusAtEndInCells: this.frameSettings.avoidance.radiusAtEndInCells,
            currentRadiusInCells: this.frameAvoidanceRadiusInCells,
            durationBeats: this.frameSettings.avoidance.durationBeats,
            timingCurve: [...this.frameSettings.avoidance.timingCurve],
            refill: {
              startBeforeTickEndBeats:
                this.frameSettings.avoidance.refill.startBeforeTickEndBeats,
              startAgeBeats: this.frameSettings.avoidance.refill.startAgeBeats,
              timingCurve: [...this.frameSettings.avoidance.refill.timingCurve],
            },
            radiusGrowthTimingCurve: [
              ...this.frameSettings.avoidance.radiusGrowthTimingCurve,
            ],
            finalWipe: {
              ...this.frameSettings.avoidance.finalWipe,
              timingCurve: [
                ...this.frameSettings.avoidance.finalWipe.timingCurve,
              ],
              phase: this.frameAvoidanceBubbles.find(
                bubble => bubble.kind === "final-wipe",
              )?.phase ?? "inactive",
            },
            bubbles: this.frameAvoidanceBubbles.map(bubble => ({
              kind: bubble.kind,
              sourceTick: bubble.sourceTick,
              sourceCellIndex: bubble.sourceCellIndex,
              ageBeats: bubble.ageBeats,
              radiusInCells: bubble.radiusInCells,
              phase: bubble.phase,
              emptyEnvelope: bubble.emptyEnvelope,
              refillEnvelope: bubble.refillEnvelope,
              progress: bubble.progress ?? null,
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
          visibilityMap: {
            enabled: this.frameFieldSettings.enabled,
            mode: this.frameFieldSettings.layers.visibility.mode,
            scale: this.frameFieldSettings.layers.visibility.scale,
            contrast: this.frameFieldSettings.layers.visibility.contrast,
            seed: this.frameFieldSettings.layers.visibility.seed,
            threshold: this.frameFieldSettings.layers.visibility.threshold,
            softness: this.frameFieldSettings.layers.visibility.softness,
            cyclesPerLoop: this.frameFieldSettings.layers.visibility.cyclesPerLoop,
            beatWiggleDurationBeats: this.frameSettings.visibilityMap
              .beatWiggleDurationBeats,
            beatWiggleDistance: this.frameSettings.visibilityMap
              .beatWiggleDistance,
            beatWiggleTimingCurve: [
              ...this.frameSettings.visibilityMap.timingCurve,
            ],
            beatWigglePhase: this.frameFieldWigglePhase,
            beatWiggleIndex: this.frameFieldWiggleIndex,
            beatWiggleProgress: this.frameFieldWiggleProgress,
            temporalOffset: this.frameFieldTemporalOffset,
            displacement: {
              ...this.frameSettings.visibilityMap.displacement,
              refillOffset: {
                ...this.frameSettings.visibilityMap.displacement.refillOffset,
              },
            },
            summary: fieldSummary,
            dimensions: this.frameVisibilityMap === null ? null : {
              width: this.frameVisibilityMap.width,
              height: this.frameVisibilityMap.height,
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
            convertedTileCount: this.snakeBubblePlan?.occupiedTileCount ?? 0,
            waterfallStep: this.snakeBubblePlan?.waterfallStep ?? null,
            inheritedCellCount: this.snakeBubblePlan?.inheritedCellCount ?? 0,
            releasedCellCount: this.snakeBubblePlan?.releasedCellCount ?? 0,
            fieldCommitState: this.snakeFieldCommitState,
            trailSquareCount: this.snakeBubblePlan?.squares.length ?? 0,
            availableTrailSquareCount: this.snakeBubblePlan?.availableSquareCount ?? 0,
            overlapSquareCount: this.frameRenderPlan?.trailOverlapCount ?? 0,
            renderedSquareCount: this.frameRenderPlan?.squares.length ?? 0,
            exclusionCircleCount: 0,
            textSafeRectangle: this.frameTextSafeRectangle === null
              ? null
              : { ...this.frameTextSafeRectangle },
            textSafeCellIndex: this.frameTextSafeCellIndex,
            textSafeCellCount: this.frameTextSafeCellCount,
            textSafeHiddenSquareCount:
              this.frameFrame?.rectangleAvoidedSquareCount ?? 0,
            textSafeHiddenInheritedSquareCount:
              this.frameFrame?.rectangleAvoidedSnakeSquareCount ?? 0,
            textSafeHiddenGeneratedSquareCount:
              this.frameFrame?.rectangleAvoidedGeneratedSquareCount ?? 0,
            visibleDotCount: this.frameFrame?.visibleCount ?? 0,
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
              currentLevel: square.currentLevel,
              occupiedTileIndices: [...(square.occupiedTileIndices ?? [])],
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
            textCentered: this.framePlan.textCentered,
            textCenter: { ...this.framePlan.textCenter },
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
            textSafeRectangle: { ...this.frameTextSafeRectangle },
            textSafeCellIndex: this.frameTextSafeCellIndex,
            textSafeCellCount: this.frameTextSafeCellCount,
            textSafeHiddenSquareCount:
              this.frameFrame.rectangleAvoidedSquareCount,
            textSafeHiddenInheritedSquareCount:
              this.frameFrame.rectangleAvoidedSnakeSquareCount,
            textSafeHiddenGeneratedSquareCount:
              this.frameFrame.rectangleAvoidedGeneratedSquareCount,
            textSafeHiddenDotCount: this.frameFrame.rectangleHiddenDotCount,
            eligibleVisibleCount: this.frameFrame.eligibleVisibleCount,
            snakeHiddenCount: this.frameFrame.snakeHiddenCount,
            fieldHiddenCount: this.frameFrame.fieldHiddenCount,
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
