import { resolveAutomaticDuration } from "../core/automatic-duration.js";
import {
  cubicBezierAt,
  normalizeBezierCurve,
} from "../core/cubic-bezier.js";
import { hashUnit } from "../generators/grid-scene-strategies.js";
import {
  counterClockwiseGridDots,
  clockwiseDotColors,
  clockwiseGridDots,
  clockwiseVisibleCountAt,
} from "./clockwise-square.js";

const CLOCK_COLUMN_SALT = 2203;
const CLOCK_ROW_SALT = 2207;
const CLOCK_CANDIDATE_SALT = 2213;
const CLOCK_PAIR_SALT = 2219;
const CLOCK_STAGGER_SALT = 2221;
const CLOCK_BEAT_OFFSET_ACTIVE_SALT = 2227;
const CLOCK_BEAT_OFFSET_CHOICE_SALT = 2231;
const CLOCK_BEAT_OFFSET_PLAN_SALT = 2273;
const CLOCK_WATERFALL_SALT = 2237;
const CLOCK_FAR_SEPARATION_SALT = 2239;
const CLOCK_FAR_POSITION_SALT = 2243;
const CLOCK_RIPPLE_FLICKER_SALT = 2251;
const CLOCK_RIPPLE_PRIMARY_GLYPH_SALT = 2267;
const CLOCK_RIPPLE_ECHO_GLYPH_SALT = 2269;

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return value;
}

function requireFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function resolveClockTravelingBeatOffset(value, label) {
  const authored = value ?? {
    enabled: false,
    probability: 0,
    patterns: [{ id: "synced", durationBeats: 1, repeatCount: 1 }],
  };
  const offset = requireObject(authored, label);
  if (typeof offset.enabled !== "boolean") {
    throw new TypeError(`${label}.enabled must be a boolean.`);
  }
  if (
    !Number.isFinite(offset.probability)
    || offset.probability < 0
    || offset.probability > 1
  ) {
    throw new RangeError(`${label}.probability must be from zero to one.`);
  }
  if (!Array.isArray(offset.patterns) || offset.patterns.length === 0) {
    throw new TypeError(`${label}.patterns must be a non-empty array.`);
  }
  const seenIds = new Set();
  const patterns = offset.patterns.map((authoredPattern, index) => {
    const pattern = requireObject(authoredPattern, `${label}.patterns[${index}]`);
    const id = requireString(pattern.id, `${label}.patterns[${index}].id`);
    if (seenIds.has(id)) {
      throw new RangeError(`${label}.patterns contains duplicate id "${id}".`);
    }
    seenIds.add(id);
    const durationBeats = requireFinitePositive(
      pattern.durationBeats,
      `${label}.patterns[${index}].durationBeats`,
    );
    const repeatCount = requirePositiveInteger(
      pattern.repeatCount,
      `${label}.patterns[${index}].repeatCount`,
    );
    const totalBeats = durationBeats * repeatCount;
    const resyncBeats = Math.round(totalBeats);
    if (Math.abs(totalBeats - resyncBeats) > 1e-9) {
      throw new RangeError(
        `${label}.patterns[${index}] must resync on a whole main beat; `
        + `${durationBeats} × ${repeatCount} = ${totalBeats}.`,
      );
    }
    return Object.freeze({ id, durationBeats, repeatCount, totalBeats: resyncBeats });
  });
  return {
    enabled: offset.enabled,
    probability: offset.probability,
    patterns,
  };
}

export function countdownClockOffsetSchedule(seed, totalBeats, settings) {
  const scheduleSeed = requireNonNegativeInteger(
    seed,
    "Countdown clock offset schedule seed",
  ) >>> 0;
  const beatCount = requirePositiveInteger(
    totalBeats,
    "Countdown clock offset schedule beat count",
  );
  const offset = resolveClockTravelingBeatOffset(
    settings,
    "Countdown clock offset schedule settings",
  );
  const blocks = [];
  let cursor = 0;
  let blockIndex = 0;
  let instanceOrdinal = 0;
  while (cursor < beatCount) {
    const remainingBeats = beatCount - cursor;
    const fittingPatterns = offset.patterns.filter(
      pattern => pattern.totalBeats <= remainingBeats,
    );
    const active = offset.enabled
      && fittingPatterns.length > 0
      && hashUnit(
        scheduleSeed ^ CLOCK_BEAT_OFFSET_PLAN_SALT,
        cursor,
        CLOCK_BEAT_OFFSET_ACTIVE_SALT,
      ) < offset.probability;
    const choiceIndex = fittingPatterns.length === 0
      ? 0
      : Math.min(
        fittingPatterns.length - 1,
        Math.floor(hashUnit(
          scheduleSeed ^ CLOCK_BEAT_OFFSET_PLAN_SALT,
          cursor,
          CLOCK_BEAT_OFFSET_CHOICE_SALT,
        ) * fittingPatterns.length),
      );
    const pattern = active
      ? fittingPatterns[choiceIndex]
      : { id: "synced", durationBeats: 1, repeatCount: 1, totalBeats: 1 };
    const instances = Array.from({ length: pattern.repeatCount }, (_, index) => {
      const startBeat = cursor + index * pattern.durationBeats;
      return Object.freeze({
        ordinal: instanceOrdinal + index,
        index,
        startBeat,
        endBeat: startBeat + pattern.durationBeats,
      });
    });
    blocks.push(Object.freeze({
      index: blockIndex,
      active,
      patternId: pattern.id,
      startBeat: cursor,
      endBeat: cursor + pattern.totalBeats,
      durationBeats: pattern.durationBeats,
      repeatCount: pattern.repeatCount,
      totalBeats: pattern.totalBeats,
      instances: Object.freeze(instances),
    }));
    cursor += pattern.totalBeats;
    instanceOrdinal += pattern.repeatCount;
    blockIndex += 1;
  }
  return Object.freeze({
    seed: scheduleSeed,
    totalBeats: beatCount,
    blocks: Object.freeze(blocks),
  });
}

export function countdownClockOffsetStateAt(schedule, beatTime) {
  if (!schedule || !Array.isArray(schedule.blocks)) {
    throw new TypeError("Countdown clock offset state requires a schedule.");
  }
  if (!Number.isFinite(beatTime)) {
    throw new TypeError("Countdown clock offset beat time must be finite.");
  }
  if (beatTime < 0 || beatTime >= schedule.totalBeats) return null;
  const block = schedule.blocks.find(candidate => (
    beatTime >= candidate.startBeat && beatTime < candidate.endBeat
  ));
  if (block === undefined) return null;
  const elapsedBeats = beatTime - block.startBeat;
  const instanceIndex = Math.min(
    block.instances.length - 1,
    Math.floor((elapsedBeats + 1e-9) / block.durationBeats),
  );
  const instance = block.instances[instanceIndex];
  return {
    active: block.active,
    blockIndex: block.index,
    patternId: block.patternId,
    blockStartBeat: block.startBeat,
    blockEndBeat: block.endBeat,
    durationBeats: block.durationBeats,
    repeatCount: block.repeatCount,
    instanceOrdinal: instance.ordinal,
    instanceIndex,
    instanceStartBeat: instance.startBeat,
    instanceEndBeat: instance.endBeat,
    instanceAgeBeats: beatTime - instance.startBeat,
    remainingBeats: schedule.totalBeats - block.startBeat,
  };
}

function rectanglesOverlap(first, second, gap = 0) {
  return first.left < second.right + gap
    && first.right + gap > second.left
    && first.top < second.bottom + gap
    && first.bottom + gap > second.top;
}

function clockRectangle(left, top, size) {
  return {
    left,
    top,
    right: left + size,
    bottom: top + size,
  };
}

function clockTextSafeZoneAt(
  cellIndex,
  columns,
  subdivisions,
  widthInCells,
  heightInCells,
) {
  const cellColumn = cellIndex % columns;
  const cellRow = Math.floor(cellIndex / columns);
  const centerColumn = cellColumn * subdivisions + subdivisions / 2;
  const centerRow = cellRow * subdivisions + subdivisions / 2;
  const width = widthInCells * subdivisions;
  const height = heightInCells * subdivisions;
  return {
    left: centerColumn - width / 2,
    top: centerRow - height / 2,
    right: centerColumn + width / 2,
    bottom: centerRow + height / 2,
    widthInCells,
    heightInCells,
  };
}

function squaredDistanceToClockCenter(rectangle, column, row) {
  const centerColumn = (rectangle.left + rectangle.right) / 2;
  const centerRow = (rectangle.top + rectangle.bottom) / 2;
  return (centerColumn - column) ** 2 + (centerRow - row) ** 2;
}

function travelingClockReservation({
  reservation,
  textCenterColumn,
  textCenterRow,
  gridColumns,
  gridRows,
  size,
  progress,
}) {
  const centerColumn = (reservation.left + reservation.right) / 2;
  const centerRow = (reservation.top + reservation.bottom) / 2;
  const directionColumn = centerColumn - textCenterColumn;
  const directionRow = centerRow - textCenterRow;
  const minimumCenter = size / 2;
  const maximumCenterColumn = gridColumns - minimumCenter;
  const maximumCenterRow = gridRows - minimumCenter;
  const edgeScales = [];
  if (directionColumn > 0) {
    edgeScales.push((maximumCenterColumn - textCenterColumn) / directionColumn);
  } else if (directionColumn < 0) {
    edgeScales.push((minimumCenter - textCenterColumn) / directionColumn);
  }
  if (directionRow > 0) {
    edgeScales.push((maximumCenterRow - textCenterRow) / directionRow);
  } else if (directionRow < 0) {
    edgeScales.push((minimumCenter - textCenterRow) / directionRow);
  }
  const edgeScale = Math.max(1, Math.min(
    ...edgeScales.filter(scale => Number.isFinite(scale) && scale >= 1),
  ));
  const destinationCenterColumn = textCenterColumn + directionColumn * edgeScale;
  const destinationCenterRow = textCenterRow + directionRow * edgeScale;
  const travelProgress = Math.max(0, Math.min(1, progress));
  const resolvedCenterColumn = centerColumn
    + (destinationCenterColumn - centerColumn) * travelProgress;
  const resolvedCenterRow = centerRow
    + (destinationCenterRow - centerRow) * travelProgress;
  return {
    ...clockRectangle(
      resolvedCenterColumn - minimumCenter,
      resolvedCenterRow - minimumCenter,
      size,
    ),
    centerColumn: resolvedCenterColumn,
    centerRow: resolvedCenterRow,
  };
}

function clockReservationTravelGain(reservation, geometry) {
  return squaredDistanceToClockCenter(
    travelingClockReservation({ ...geometry, reservation, progress: 1 }),
    geometry.textCenterColumn,
    geometry.textCenterRow,
  ) - squaredDistanceToClockCenter(
    reservation,
    geometry.textCenterColumn,
    geometry.textCenterRow,
  );
}

function selectMovableClockReservation({
  anchor,
  seed,
  tick,
  textSafeZone,
  minimumSquareGap,
  ...geometry
}) {
  let selected = null;
  for (let top = 0; top <= geometry.gridRows - geometry.size; top += 1) {
    for (let left = 0; left <= geometry.gridColumns - geometry.size; left += 1) {
      const candidate = {
        ...clockRectangle(left, top, geometry.size),
        centerColumn: left + geometry.size / 2,
        centerRow: top + geometry.size / 2,
      };
      if (
        rectanglesOverlap(candidate, textSafeZone)
        || rectanglesOverlap(candidate, anchor, minimumSquareGap)
        || clockReservationTravelGain(candidate, geometry) <= 1e-9
      ) {
        continue;
      }
      const distance = squaredDistanceToClockCenter(
        candidate,
        geometry.textCenterColumn,
        geometry.textCenterRow,
      );
      const candidateId = top * geometry.gridColumns + left;
      const rank = hashUnit(
        seed ^ Math.imul(tick + 1, CLOCK_COLUMN_SALT),
        candidateId,
        CLOCK_CANDIDATE_SALT,
      );
      if (
        selected === null
        || distance < selected.distance
        || (distance === selected.distance && rank < selected.rank)
      ) {
        selected = { ...candidate, distance, rank };
      }
    }
  }
  if (selected === null) return null;
  const { distance, rank, ...reservation } = selected;
  return reservation;
}

function selectFarClockReservation({
  other,
  seed,
  tick,
  textSafeZone,
  minimumSquareGap,
  minimumRadius,
  gridColumns,
  gridRows,
  size,
}) {
  let selected = null;
  for (let top = 0; top <= gridRows - size; top += 1) {
    for (let left = 0; left <= gridColumns - size; left += 1) {
      const candidate = {
        ...clockRectangle(left, top, size),
        centerColumn: left + size / 2,
        centerRow: top + size / 2,
      };
      if (
        rectanglesOverlap(candidate, textSafeZone)
        || rectanglesOverlap(candidate, other, minimumSquareGap)
      ) continue;
      const distance = (
        (candidate.centerColumn - other.centerColumn) ** 2
        + (candidate.centerRow - other.centerRow) ** 2
      );
      if (distance < minimumRadius ** 2) continue;
      const candidateId = top * gridColumns + left;
      const rank = hashUnit(
        seed ^ Math.imul(tick + 1, CLOCK_FAR_POSITION_SALT),
        candidateId,
        CLOCK_FAR_SEPARATION_SALT,
      );
      if (
        selected === null
        || rank < selected.rank
      ) {
        selected = { ...candidate, distance, rank };
      }
    }
  }
  if (selected === null) return null;
  const { distance, rank, ...reservation } = selected;
  return reservation;
}

function clockReservationCandidates({
  textCenterColumn,
  textCenterRow,
  gridColumns,
  gridRows,
  squareSize,
  rangeX,
  rangeY,
  expansion,
}) {
  const candidates = new Map();
  for (let offsetY = -rangeY - expansion; offsetY <= rangeY + expansion; offsetY += 1) {
    for (let offsetX = -rangeX - expansion; offsetX <= rangeX + expansion; offsetX += 1) {
      const left = Math.max(0, Math.min(
        gridColumns - squareSize,
        Math.round(textCenterColumn + offsetX - squareSize / 2),
      ));
      const top = Math.max(0, Math.min(
        gridRows - squareSize,
        Math.round(textCenterRow + offsetY - squareSize / 2),
      ));
      const key = `${left}:${top}`;
      if (!candidates.has(key)) {
        candidates.set(key, {
          ...clockRectangle(left, top, squareSize),
          centerColumn: left + squareSize / 2,
          centerRow: top + squareSize / 2,
        });
      }
    }
  }
  return [...candidates.values()];
}

function selectClockReservations({
  seed,
  tick,
  textCenterColumn,
  textCenterRow,
  textSafeZone,
  gridColumns,
  gridRows,
  squareSize,
  rangeX,
  rangeY,
  minimumSquareGap,
}) {
  let previousCandidateSignature = null;
  for (let expansion = 0; ; expansion += 1) {
    const allCandidates = clockReservationCandidates({
      textCenterColumn,
      textCenterRow,
      gridColumns,
      gridRows,
      squareSize,
      rangeX,
      rangeY,
      expansion,
    });
    const candidateSignature = allCandidates
      .map(candidate => `${candidate.left}:${candidate.top}`)
      .sort()
      .join(",");
    if (candidateSignature === previousCandidateSignature) break;
    previousCandidateSignature = candidateSignature;
    const candidates = allCandidates.filter(
      candidate => !rectanglesOverlap(candidate, textSafeZone),
    );

    let selected = null;
    const selectionSeed = seed ^ Math.imul(tick + 1, CLOCK_COLUMN_SALT);
    for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
      const first = candidates[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
        const second = candidates[secondIndex];
        if (rectanglesOverlap(first, second, minimumSquareGap)) continue;
        const firstId = first.top * gridColumns + first.left;
        const secondId = second.top * gridColumns + second.left;
        const rank = hashUnit(
          selectionSeed ^ Math.imul(firstId + 1, CLOCK_CANDIDATE_SALT),
          secondId,
          CLOCK_PAIR_SALT,
        );
        const anchorDistance = Math.min(
          squaredDistanceToClockCenter(first, textCenterColumn, textCenterRow),
          squaredDistanceToClockCenter(second, textCenterColumn, textCenterRow),
        );
        const distance = (
          (first.centerColumn - textCenterColumn) ** 2
          + (first.centerRow - textCenterRow) ** 2
          + (second.centerColumn - textCenterColumn) ** 2
          + (second.centerRow - textCenterRow) ** 2
        );
        if (
          selected === null
          || anchorDistance < selected.anchorDistance
          || (anchorDistance === selected.anchorDistance && rank < selected.rank)
          || (
            anchorDistance === selected.anchorDistance
            && rank === selected.rank
            && distance < selected.distance
          )
        ) {
          selected = { first, second, anchorDistance, rank, distance };
        }
      }
    }
    if (selected !== null) {
      const swap = hashUnit(selectionSeed, expansion, CLOCK_ROW_SALT) < 0.5;
      return {
        expansion,
        reservations: swap
          ? [selected.second, selected.first]
          : [selected.first, selected.second],
      };
    }
  }
  throw new RangeError(
    "Countdown clock safe zones cannot fit two maximum-size square reservations on this board.",
  );
}

export function resolveCountdownClockSettings(appearance, beatSeconds) {
  const authored = requireObject(appearance, "countdownFramed.appearance");
  const seed = requireNonNegativeInteger(
    authored.seed,
    "countdownFramed.appearance.seed",
  );
  if (typeof authored.evolveSeed !== "boolean") {
    throw new TypeError("countdownFramed.appearance.evolveSeed must be a boolean.");
  }
  const clock = requireObject(
    authored.effects?.clock,
    "countdownFramed.appearance.effects.clock",
  );
  if (typeof clock.enabled !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.clock.enabled must be a boolean.",
    );
  }
  const duration = resolveAutomaticDuration(clock.durationSeconds, {
    label: "countdownFramed.appearance.effects.clock.durationSeconds",
    candidates: [{ source: "composition-beat", seconds: beatSeconds }],
  });
  if (Math.abs(duration.seconds - beatSeconds) > 1e-9) {
    throw new RangeError(
      "countdownFramed.appearance.effects.clock.durationSeconds must equal one composition beat.",
    );
  }
  const subdivisionLevel = requireNonNegativeInteger(
    clock.subdivisionLevel,
    "countdownFramed.appearance.effects.clock.subdivisionLevel",
  );
  if (subdivisionLevel !== 3) {
    throw new RangeError(
      "countdownFramed.appearance.effects.clock.subdivisionLevel must be three (8x8).",
    );
  }
  const squareCount = requirePositiveInteger(
    clock.squareCount,
    "countdownFramed.appearance.effects.clock.squareCount",
  );
  if (squareCount !== 2) {
    throw new RangeError(
      "countdownFramed.appearance.effects.clock.squareCount must be two.",
    );
  }
  const dotsPerSquare = requirePositiveInteger(
    clock.dotsPerSquare,
    "countdownFramed.appearance.effects.clock.dotsPerSquare",
  );
  if (dotsPerSquare !== 4) {
    throw new RangeError(
      "countdownFramed.appearance.effects.clock.dotsPerSquare must be four.",
    );
  }
  const travelingSquareStaggerBeats = clock.travelingSquareStaggerBeats ?? 0;
  if (
    !Number.isFinite(travelingSquareStaggerBeats)
    || travelingSquareStaggerBeats < 0
    || travelingSquareStaggerBeats >= 1
  ) {
    throw new RangeError(
      "countdownFramed.appearance.effects.clock.travelingSquareStaggerBeats "
      + "must be from zero up to one.",
    );
  }
  const travelingSquareBeatOffset = resolveClockTravelingBeatOffset(
    clock.travelingSquareBeatOffset,
    "countdownFramed.appearance.effects.clock.travelingSquareBeatOffset",
  );
  const authoredSizeWaterfall = clock.sizeWaterfall ?? {
    enabled: false,
    bothCells: false,
    clockProbability: 0,
  };
  const sizeWaterfall = requireObject(
    authoredSizeWaterfall,
    "countdownFramed.appearance.effects.clock.sizeWaterfall",
  );
  if (typeof sizeWaterfall.enabled !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.clock.sizeWaterfall.enabled must be a boolean.",
    );
  }
  if (typeof sizeWaterfall.bothCells !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.clock.sizeWaterfall.bothCells must be a boolean.",
    );
  }
  if (
    !Number.isFinite(sizeWaterfall.clockProbability)
    || sizeWaterfall.clockProbability < 0
    || sizeWaterfall.clockProbability > 1
  ) {
    throw new RangeError(
      "countdownFramed.appearance.effects.clock.sizeWaterfall.clockProbability "
      + "must be from zero to one.",
    );
  }
  const authoredFarSeparation = clock.farSeparation ?? {
    enabled: false,
    probability: 0,
    minimumRadiusInCells: 3,
  };
  const farSeparation = requireObject(
    authoredFarSeparation,
    "countdownFramed.appearance.effects.clock.farSeparation",
  );
  if (typeof farSeparation.enabled !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.clock.farSeparation.enabled must be a boolean.",
    );
  }
  if (
    !Number.isFinite(farSeparation.probability)
    || farSeparation.probability < 0
    || farSeparation.probability > 1
  ) {
    throw new RangeError(
      "countdownFramed.appearance.effects.clock.farSeparation.probability "
      + "must be from zero to one.",
    );
  }
  const farSeparationMinimumRadiusInCells = requireFinitePositive(
    farSeparation.minimumRadiusInCells ?? 3,
    "countdownFramed.appearance.effects.clock.farSeparation."
      + "minimumRadiusInCells",
  );
  const authoredBirthRipple = clock.birthRipple ?? {
    enabled: false,
    startBeforeHandoffBeats: 1,
    durationBeats: 4,
    wakeDepthInCells: 1.35,
    secondaryRadiusInCells: 2.5,
    radialTimingCurve: [0.18, 0.42, 0.68, 0.86],
    wakeFlicker: {
      enabled: false,
      probability: 0,
      distanceDecayInCells: 5,
      flashesPerBeat: 6,
      minimumOpacity: 0.2,
    },
  };
  const birthRipple = requireObject(
    authoredBirthRipple,
    "countdownFramed.appearance.effects.clock.birthRipple",
  );
  if (typeof birthRipple.enabled !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.clock.birthRipple.enabled must be a boolean.",
    );
  }
  const durationBeats = requireFinitePositive(
    birthRipple.durationBeats,
    "countdownFramed.appearance.effects.clock.birthRipple.durationBeats",
  );
  const startBeforeHandoffBeats = requireFinitePositive(
    birthRipple.startBeforeHandoffBeats ?? 1,
    "countdownFramed.appearance.effects.clock.birthRipple."
      + "startBeforeHandoffBeats",
  );
  if (durationBeats < startBeforeHandoffBeats) {
    throw new RangeError(
      "countdownFramed.appearance.effects.clock.birthRipple.durationBeats "
      + "must be at least startBeforeHandoffBeats.",
    );
  }
  const wakeDepthInCells = requireFinitePositive(
    birthRipple.wakeDepthInCells,
    "countdownFramed.appearance.effects.clock.birthRipple.wakeDepthInCells",
  );
  const secondaryRadiusInCells = requireFinitePositive(
    birthRipple.secondaryRadiusInCells,
    "countdownFramed.appearance.effects.clock.birthRipple.secondaryRadiusInCells",
  );
  const authoredWakeFlicker = birthRipple.wakeFlicker ?? {
    enabled: false,
    probability: 0,
    distanceDecayInCells: 5,
    flashesPerBeat: 6,
    minimumOpacity: 0.2,
  };
  const wakeFlicker = requireObject(
    authoredWakeFlicker,
    "countdownFramed.appearance.effects.clock.birthRipple.wakeFlicker",
  );
  if (typeof wakeFlicker.enabled !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.clock.birthRipple.wakeFlicker.enabled "
      + "must be a boolean.",
    );
  }
  if (
    !Number.isFinite(wakeFlicker.probability)
    || wakeFlicker.probability < 0
    || wakeFlicker.probability > 1
  ) {
    throw new RangeError(
      "countdownFramed.appearance.effects.clock.birthRipple.wakeFlicker.probability "
      + "must be from zero to one.",
    );
  }
  const flickerDistanceDecayInCells = requireFinitePositive(
    wakeFlicker.distanceDecayInCells,
    "countdownFramed.appearance.effects.clock.birthRipple.wakeFlicker."
      + "distanceDecayInCells",
  );
  const flickerFlashesPerBeat = requirePositiveInteger(
    wakeFlicker.flashesPerBeat,
    "countdownFramed.appearance.effects.clock.birthRipple.wakeFlicker.flashesPerBeat",
  );
  if (
    !Number.isFinite(wakeFlicker.minimumOpacity)
    || wakeFlicker.minimumOpacity < 0
    || wakeFlicker.minimumOpacity > 1
  ) {
    throw new RangeError(
      "countdownFramed.appearance.effects.clock.birthRipple.wakeFlicker.minimumOpacity "
      + "must be from zero to one.",
    );
  }
  if (typeof clock.behindText !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.clock.behindText must be a boolean.",
    );
  }
  if (!Array.isArray(clock.evolutionSquareSizes) || clock.evolutionSquareSizes.length === 0) {
    throw new TypeError(
      "countdownFramed.appearance.effects.clock.evolutionSquareSizes must be an array.",
    );
  }
  const evolutionSquareSizes = clock.evolutionSquareSizes.map((size, index) => {
    const resolved = requirePositiveInteger(
      size,
      `countdownFramed.appearance.effects.clock.evolutionSquareSizes[${index}]`,
    );
    if (resolved < 3 || resolved > (1 << subdivisionLevel)) {
      throw new RangeError(
        "countdownFramed.appearance.effects.clock.evolutionSquareSizes "
        + "must stay between 3 and the subdivision count.",
      );
    }
    if (index > 0 && resolved <= clock.evolutionSquareSizes[index - 1]) {
      throw new RangeError(
        "countdownFramed.appearance.effects.clock.evolutionSquareSizes "
        + "must increase strictly.",
      );
    }
    return resolved;
  });
  const range = requireObject(
    clock.rangeInSubdivisions,
    "countdownFramed.appearance.effects.clock.rangeInSubdivisions",
  );
  const rangeX = requireNonNegativeInteger(
    range.x,
    "countdownFramed.appearance.effects.clock.rangeInSubdivisions.x",
  );
  const rangeY = requireNonNegativeInteger(
    range.y,
    "countdownFramed.appearance.effects.clock.rangeInSubdivisions.y",
  );
  const textSafeZone = requireObject(
    clock.textSafeZone,
    "countdownFramed.appearance.effects.clock.textSafeZone",
  );
  const textSafeZoneWidthInCells = requireFinitePositive(
    textSafeZone.widthInCells,
    "countdownFramed.appearance.effects.clock.textSafeZone.widthInCells",
  );
  const textSafeZoneHeightInCells = requireFinitePositive(
    textSafeZone.heightInCells,
    "countdownFramed.appearance.effects.clock.textSafeZone.heightInCells",
  );
  const minimumSquareGapInSubdivisions = requireNonNegativeInteger(
    clock.minimumSquareGapInSubdivisions,
    "countdownFramed.appearance.effects.clock.minimumSquareGapInSubdivisions",
  );
  if (!Number.isFinite(clock.dotMargin) || clock.dotMargin < 0 || clock.dotMargin >= 1) {
    throw new RangeError(
      "countdownFramed.appearance.effects.clock.dotMargin must be from zero up to one.",
    );
  }

  return Object.freeze({
    enabled: clock.enabled,
    seed: seed >>> 0,
    evolveSeed: authored.evolveSeed,
    palette: requireString(
      clock.palette,
      "countdownFramed.appearance.effects.clock.palette",
    ),
    duration,
    subdivisionLevel,
    squareCount,
    dotsPerSquare,
    travelingSquareStaggerBeats,
    travelingSquareBeatOffset: Object.freeze({
      enabled: travelingSquareBeatOffset.enabled,
      probability: travelingSquareBeatOffset.probability,
      patterns: Object.freeze(travelingSquareBeatOffset.patterns.map(
        pattern => Object.freeze({ ...pattern }),
      )),
    }),
    sizeWaterfall: Object.freeze({
      enabled: sizeWaterfall.enabled,
      bothCells: sizeWaterfall.bothCells,
      clockProbability: sizeWaterfall.clockProbability,
    }),
    farSeparation: Object.freeze({
      enabled: farSeparation.enabled,
      probability: farSeparation.probability,
      minimumRadiusInCells: farSeparationMinimumRadiusInCells,
    }),
    birthRipple: Object.freeze({
      enabled: birthRipple.enabled,
      startBeforeHandoffBeats,
      durationBeats,
      wakeDepthInCells,
      secondaryRadiusInCells,
      radialTimingCurve: Object.freeze(normalizeBezierCurve(
        birthRipple.radialTimingCurve,
        "countdownFramed.appearance.effects.clock.birthRipple.radialTimingCurve",
      )),
      wakeFlicker: Object.freeze({
        enabled: wakeFlicker.enabled,
        probability: wakeFlicker.probability,
        distanceDecayInCells: flickerDistanceDecayInCells,
        flashesPerBeat: flickerFlashesPerBeat,
        minimumOpacity: wakeFlicker.minimumOpacity,
      }),
    }),
    behindText: clock.behindText,
    evolutionSquareSizes: Object.freeze(evolutionSquareSizes),
    rangeInSubdivisions: Object.freeze({ x: rangeX, y: rangeY }),
    textSafeZone: Object.freeze({
      widthInCells: textSafeZoneWidthInCells,
      heightInCells: textSafeZoneHeightInCells,
    }),
    minimumSquareGapInSubdivisions,
    dotMargin: clock.dotMargin,
    timingCurve: Object.freeze(normalizeBezierCurve(
      clock.timingCurve,
      "countdownFramed.appearance.effects.clock.timingCurve",
    )),
  });
}

export function countdownClockEvolutionAt(
  enabled,
  progress,
  squareSizes,
) {
  if (typeof enabled !== "boolean") {
    throw new TypeError("Countdown clock evolution enabled must be a boolean.");
  }
  if (!Array.isArray(squareSizes) || squareSizes.length === 0) {
    throw new TypeError("Countdown clock evolution requires square sizes.");
  }
  const normalized = Math.max(0, Math.min(1, Number(progress) || 0));
  if (!enabled) {
    return { mode: "clock", progress: 0, squareSize: 2, squareCount: 2 };
  }
  if (normalized >= 1) {
    return {
      mode: "snake-origin",
      progress: 1,
      squareSize: 1,
      squareCount: 1,
    };
  }
  const sizeIndex = Math.min(
    squareSizes.length - 1,
    Math.max(0, Math.ceil(normalized * squareSizes.length - 1e-12)),
  );
  return {
    mode: "expanding",
    progress: normalized,
    squareSize: squareSizes[sizeIndex],
    squareCount: 2,
  };
}

/** Two seeded grids: one stays near the timer while its partner travels outward. */
export function countdownClockPlan({
  seed,
  tick,
  layout,
  cellIndex,
  subdivisionLevel = 3,
  squareCount = 2,
  dotsPerSquare = 4,
  travelingSquareStaggerBeats = 0,
  travelingBeatOffsetActive = false,
  travelingBeatDurationBeats = 1,
  forceFarSeparated = false,
  farSeparationProbability = 0,
  farSeparationMinimumRadiusInCells = 3,
  evolutionSquareSizes = [3, 4, 8],
  evolutionEnabled = false,
  evolutionProgress = 0,
  handoffCellIndex = cellIndex,
  birthRippleTextCellIndex = cellIndex,
  rangeInSubdivisions,
  textSafeZone = { widthInCells: 1.25, heightInCells: 0.75 },
  minimumSquareGapInSubdivisions = 1,
}) {
  const planSeed = requireNonNegativeInteger(seed, "Countdown clock seed") >>> 0;
  const appearanceTick = requireNonNegativeInteger(tick, "Countdown clock tick");
  const columns = requirePositiveInteger(layout?.columns, "Countdown clock columns");
  const rows = requirePositiveInteger(layout?.rows, "Countdown clock rows");
  const textCellIndex = requireNonNegativeInteger(
    cellIndex,
    "Countdown clock text cell",
  );
  if (textCellIndex >= columns * rows) {
    throw new RangeError("Countdown clock text cell must be inside the parent grid.");
  }
  const snakeOriginCellIndex = requireNonNegativeInteger(
    handoffCellIndex,
    "Countdown clock handoff cell",
  );
  if (snakeOriginCellIndex >= columns * rows) {
    throw new RangeError("Countdown clock handoff cell must be inside the parent grid.");
  }
  const rippleTextCellIndex = requireNonNegativeInteger(
    birthRippleTextCellIndex,
    "Countdown clock birth ripple text cell",
  );
  if (rippleTextCellIndex >= columns * rows) {
    throw new RangeError(
      "Countdown clock birth ripple text cell must be inside the parent grid.",
    );
  }
  const level = requireNonNegativeInteger(
    subdivisionLevel,
    "Countdown clock subdivision level",
  );
  if (level !== 3) {
    throw new RangeError("Countdown clock subdivision level must be three (8x8).");
  }
  const squaresRequested = requirePositiveInteger(
    squareCount,
    "Countdown clock square count",
  );
  if (squaresRequested !== 2) {
    throw new RangeError("Countdown clock square count must be two.");
  }
  const dotsRequested = requirePositiveInteger(
    dotsPerSquare,
    "Countdown clock dots per square",
  );
  if (dotsRequested !== 4) {
    throw new RangeError("Countdown clock dots per square must be four.");
  }
  if (
    !Number.isFinite(travelingSquareStaggerBeats)
    || travelingSquareStaggerBeats < 0
    || travelingSquareStaggerBeats >= 1
  ) {
    throw new RangeError(
      "Countdown clock traveling-square stagger must be from zero up to one beat.",
    );
  }
  if (typeof travelingBeatOffsetActive !== "boolean") {
    throw new TypeError("Countdown clock traveling beat-offset active must be a boolean.");
  }
  const resolvedTravelingBeatDuration = requireFinitePositive(
    travelingBeatDurationBeats,
    "Countdown clock traveling beat duration",
  );
  if (typeof forceFarSeparated !== "boolean") {
    throw new TypeError("Countdown clock force-far separation must be a boolean.");
  }
  if (
    !Number.isFinite(farSeparationProbability)
    || farSeparationProbability < 0
    || farSeparationProbability > 1
  ) {
    throw new RangeError(
      "Countdown clock far-separation probability must be from zero to one.",
    );
  }
  const farSeparationMinimumRadius = requireFinitePositive(
    farSeparationMinimumRadiusInCells,
    "Countdown clock far-separation minimum radius in cells",
  );
  const range = requireObject(rangeInSubdivisions, "Countdown clock range");
  const rangeX = requireNonNegativeInteger(range.x, "Countdown clock horizontal range");
  const rangeY = requireNonNegativeInteger(range.y, "Countdown clock vertical range");
  const safeZone = requireObject(textSafeZone, "Countdown clock text safe zone");
  const safeZoneWidthInCells = requireFinitePositive(
    safeZone.widthInCells,
    "Countdown clock text safe-zone width",
  );
  const safeZoneHeightInCells = requireFinitePositive(
    safeZone.heightInCells,
    "Countdown clock text safe-zone height",
  );
  const minimumSquareGap = requireNonNegativeInteger(
    minimumSquareGapInSubdivisions,
    "Countdown clock minimum square gap",
  );

  const subdivisions = 1 << level;
  const gridColumns = columns * subdivisions;
  const gridRows = rows * subdivisions;
  const maximumSquareSize = Math.max(
    2,
    ...evolutionSquareSizes.map((size, index) => requirePositiveInteger(
      size,
      `Countdown clock evolution square size ${index}`,
    )),
  );
  if (maximumSquareSize > gridColumns || maximumSquareSize > gridRows) {
    throw new RangeError(
      "Countdown clock maximum square size must fit inside the subdivision grid.",
    );
  }
  const resolvedTextSafeZone = clockTextSafeZoneAt(
    textCellIndex,
    columns,
    subdivisions,
    safeZoneWidthInCells,
    safeZoneHeightInCells,
  );
  const birthRippleTextSafeZone = clockTextSafeZoneAt(
    rippleTextCellIndex,
    columns,
    subdivisions,
    safeZoneWidthInCells,
    safeZoneHeightInCells,
  );
  const textCenterColumn = (resolvedTextSafeZone.left
    + resolvedTextSafeZone.right) / 2;
  const textCenterRow = (resolvedTextSafeZone.top
    + resolvedTextSafeZone.bottom) / 2;
  const evolution = countdownClockEvolutionAt(
    evolutionEnabled,
    evolutionProgress,
    evolutionSquareSizes,
  );
  const handoffCenterColumn = (snakeOriginCellIndex % columns) * subdivisions
    + subdivisions / 2;
  const handoffCenterRow = Math.floor(snakeOriginCellIndex / columns) * subdivisions
    + subdivisions / 2;
  if (evolution.mode === "snake-origin") {
    const snakeOriginBounds = clockRectangle(
      (snakeOriginCellIndex % columns) * subdivisions,
      Math.floor(snakeOriginCellIndex / columns) * subdivisions,
      subdivisions,
    );
    if (rectanglesOverlap(snakeOriginBounds, resolvedTextSafeZone)) {
      throw new RangeError(
        "Countdown clock snake origin overlaps the timer text safe zone.",
      );
    }
    const dots = [{
      column: handoffCenterColumn - 0.5,
      row: handoffCenterRow - 0.5,
      index: snakeOriginCellIndex * subdivisions * subdivisions,
      squareIndex: 0,
      clockwiseIndex: 0,
      palettePosition: 0,
      sizeInSubdivisions: subdivisions,
      appearanceTick,
      cellIndex: snakeOriginCellIndex,
    }];
    const squares = [{
      squareIndex: 0,
      topLeftColumn: handoffCenterColumn - 0.5,
      topLeftRow: handoffCenterRow - 0.5,
      dots,
    }];
    return {
      seed: planSeed,
      tick: appearanceTick,
      subdivisions,
      gridColumns,
      gridRows,
      textCellIndex,
      textSafeZone: resolvedTextSafeZone,
      birthRippleTextCellIndex: rippleTextCellIndex,
      birthRippleTextSafeZone,
      minimumSquareGapInSubdivisions: minimumSquareGap,
      maximumSquareSize,
      reservationExpansion: null,
      farSeparated: false,
      separationDistanceInSubdivisions: 0,
      snakeOriginBounds,
      handoffCellIndex: snakeOriginCellIndex,
      evolutionMode: evolution.mode,
      evolutionProgress: evolution.progress,
      squareSize: evolution.squareSize,
      squares,
      dots,
    };
  }

  const selection = selectClockReservations({
    seed: planSeed,
    tick: appearanceTick,
    textCenterColumn,
    textCenterRow,
    textSafeZone: resolvedTextSafeZone,
    gridColumns,
    gridRows,
    squareSize: evolution.squareSize,
    rangeX,
    rangeY,
    minimumSquareGap,
  });
  let resolvedReservations = selection.reservations;
  const reservationDistances = resolvedReservations.map(reservation => (
    squaredDistanceToClockCenter(
      reservation,
      textCenterColumn,
      textCenterRow,
    )
  ));
  const travelGeometry = {
    textCenterColumn,
    textCenterRow,
    gridColumns,
    gridRows,
    size: evolution.squareSize,
  };
  const travelGains = resolvedReservations.map(reservation => (
    clockReservationTravelGain(reservation, travelGeometry)
  ));
  const preferredAnchorIndex = reservationDistances[0] <= reservationDistances[1]
    ? 0
    : 1;
  let travelingSquareIndex = 1 - preferredAnchorIndex;
  if (
    evolution.mode === "expanding"
    && travelGains[travelingSquareIndex] <= 1e-9
  ) {
    const anchorIndex = preferredAnchorIndex;
    const anchor = resolvedReservations[anchorIndex];
    const traveling = selectMovableClockReservation({
      anchor,
      seed: planSeed,
      tick: appearanceTick,
      textSafeZone: resolvedTextSafeZone,
      minimumSquareGap,
      ...travelGeometry,
    });
    if (traveling !== null) {
      resolvedReservations = [anchor, traveling];
      travelingSquareIndex = 1;
    } else if (travelGains[anchorIndex] > 1e-9) {
      travelingSquareIndex = anchorIndex;
    }
  }
  const farSeparationSample = hashUnit(
    planSeed,
    appearanceTick,
    CLOCK_FAR_SEPARATION_SALT,
  );
  const farSeparated = forceFarSeparated || (
    farSeparationProbability > 0
    && farSeparationSample < farSeparationProbability
  );
  const anchoredSquareIndex = 1 - travelingSquareIndex;
  if (farSeparated) {
    const farReservation = selectFarClockReservation({
      other: resolvedReservations[anchoredSquareIndex],
      seed: planSeed,
      tick: appearanceTick,
      textSafeZone: resolvedTextSafeZone,
      minimumSquareGap,
      minimumRadius: farSeparationMinimumRadius * subdivisions,
      ...travelGeometry,
    });
    if (farReservation === null) {
      throw new RangeError(
        "Countdown clock cannot place its traveling square far from its anchored square.",
      );
    }
    resolvedReservations = resolvedReservations.map((reservation, squareIndex) => (
      squareIndex === travelingSquareIndex ? farReservation : reservation
    ));
  }
  const separationDistanceInSubdivisions = Math.hypot(
    resolvedReservations[0].centerColumn - resolvedReservations[1].centerColumn,
    resolvedReservations[0].centerRow - resolvedReservations[1].centerRow,
  );
  const staggerSample = hashUnit(
    planSeed,
    appearanceTick,
    CLOCK_STAGGER_SALT,
  ) * 2 - 1;
  const travelingStaggerBeats = travelingSquareStaggerBeats === 0
    ? 0
    : Math.sign(staggerSample || 1)
      * (0.5 + Math.abs(staggerSample) * 0.5)
      * travelingSquareStaggerBeats;
  const squares = resolvedReservations.map((reservation, squareIndex) => {
    const resolvedReservation = evolution.mode === "expanding"
      && squareIndex === travelingSquareIndex
      ? travelingClockReservation({
        reservation,
        textCenterColumn,
        textCenterRow,
        gridColumns,
        gridRows,
        size: evolution.squareSize,
        progress: evolution.progress,
      })
      : reservation;
    const topLeftColumn = resolvedReservation.left;
    const topLeftRow = resolvedReservation.top;
    const rotationDirection = evolution.mode === "expanding"
      && squareIndex === travelingSquareIndex
      ? "counter-clockwise"
      : "clockwise";
    const gridDotsForRotation = rotationDirection === "counter-clockwise"
      ? counterClockwiseGridDots
      : clockwiseGridDots;
    const clockDots = gridDotsForRotation(
      topLeftColumn,
      topLeftRow,
      evolution.squareSize,
      gridColumns,
      squareIndex,
    );
    return {
      squareIndex,
      motionRole: squareIndex === travelingSquareIndex ? "traveling" : "anchored",
      rotationDirection,
      farSeparated: farSeparated && squareIndex === travelingSquareIndex,
      appearanceStaggerBeats: squareIndex === travelingSquareIndex
        ? travelingStaggerBeats
        : 0,
      beatOffsetActive: squareIndex === travelingSquareIndex
        && travelingBeatOffsetActive,
      beatDurationBeats: squareIndex === travelingSquareIndex
        ? resolvedTravelingBeatDuration
        : 1,
      offsetX: resolvedReservation.centerColumn - textCenterColumn,
      offsetY: resolvedReservation.centerRow - textCenterRow,
      topLeftColumn,
      topLeftRow,
      reservation: {
        left: resolvedReservation.left,
        top: resolvedReservation.top,
        right: resolvedReservation.right,
        bottom: resolvedReservation.bottom,
      },
      originReservation: {
        left: reservation.left,
        top: reservation.top,
        right: reservation.right,
        bottom: reservation.bottom,
      },
      dots: clockDots.map(dot => ({ ...dot, appearanceTick })),
    };
  });
  const dots = squares.flatMap(square => square.dots);

  return {
    seed: planSeed,
    tick: appearanceTick,
    subdivisions,
    gridColumns,
    gridRows,
    textCellIndex,
    textSafeZone: resolvedTextSafeZone,
    birthRippleTextCellIndex: rippleTextCellIndex,
    birthRippleTextSafeZone,
    minimumSquareGapInSubdivisions: minimumSquareGap,
    maximumSquareSize,
    reservationExpansion: selection.expansion,
    farSeparated,
    separationDistanceInSubdivisions,
    snakeOriginBounds: null,
    handoffCellIndex: snakeOriginCellIndex,
    evolutionMode: evolution.mode,
    evolutionProgress: evolution.progress,
    squareSize: evolution.squareSize,
    squares,
    dots,
  };
}

export function validateCountdownClockLayout(layout, settings) {
  const columns = requirePositiveInteger(layout?.columns, "Countdown clock columns");
  const rows = requirePositiveInteger(layout?.rows, "Countdown clock rows");
  if (!settings?.enabled) {
    return { checkedCellCount: 0, maximumSquareSize: 0 };
  }
  const evolutionSamples = [
    null,
    ...settings.evolutionSquareSizes.map((_, index) => (
      index / settings.evolutionSquareSizes.length
    )),
  ];
  for (let cellIndex = 0; cellIndex < columns * rows; cellIndex += 1) {
    for (const evolutionProgress of evolutionSamples) {
      countdownClockPlan({
        seed: settings.seed,
        tick: cellIndex,
        layout,
        cellIndex,
        subdivisionLevel: settings.subdivisionLevel,
        squareCount: settings.squareCount,
        dotsPerSquare: settings.dotsPerSquare,
        travelingSquareStaggerBeats: settings.travelingSquareStaggerBeats,
        farSeparationProbability: settings.farSeparation.enabled
          ? settings.farSeparation.probability
          : 0,
        farSeparationMinimumRadiusInCells:
          settings.farSeparation.minimumRadiusInCells,
        evolutionSquareSizes: settings.evolutionSquareSizes,
        evolutionEnabled: evolutionProgress !== null,
        evolutionProgress: evolutionProgress ?? 0,
        handoffCellIndex: cellIndex,
        rangeInSubdivisions: settings.rangeInSubdivisions,
        textSafeZone: settings.textSafeZone,
        minimumSquareGapInSubdivisions:
          settings.minimumSquareGapInSubdivisions,
      });
    }
  }
  return {
    checkedCellCount: columns * rows,
    maximumSquareSize: Math.max(2, ...settings.evolutionSquareSizes),
  };
}

function countdownClockWaterfallProbability(squareProgress, plan, square, settings) {
  if (settings.sizeWaterfall?.enabled !== true) return 0;
  if (
    settings.sizeWaterfall.bothCells !== true
    && square.motionRole !== "traveling"
  ) return 0;
  const clockProbability = settings.sizeWaterfall.clockProbability;
  const targetProbability = plan.evolutionMode === "expanding"
    ? clockProbability
      + (1 - clockProbability) * plan.evolutionProgress
    : clockProbability;
  return Math.max(0, Math.min(1, squareProgress * targetProbability));
}

function countdownClockWaterfallDots(plan, square, sourceDots, probability) {
  if (probability <= 0 || sourceDots.length < 4) {
    return sourceDots.map(dot => ({ ...dot }));
  }
  const clusters = new Map(sourceDots.map(dot => [
    `${dot.column}:${dot.row}:1`,
    {
      left: dot.column,
      top: dot.row,
      size: 1,
      dot: { ...dot, sourceDotCount: 1, waterfallLevel: 0 },
    },
  ]));
  for (let size = 2; size <= plan.squareSize; size *= 2) {
    const childSize = size / 2;
    for (let offsetTop = 0; offsetTop + size <= plan.squareSize; offsetTop += size) {
      for (let offsetLeft = 0; offsetLeft + size <= plan.squareSize; offsetLeft += size) {
        const left = square.topLeftColumn + offsetLeft;
        const top = square.topLeftRow + offsetTop;
        if (left % size !== 0 || top % size !== 0) continue;
        const childKeys = [
          `${left}:${top}:${childSize}`,
          `${left + childSize}:${top}:${childSize}`,
          `${left}:${top + childSize}:${childSize}`,
          `${left + childSize}:${top + childSize}:${childSize}`,
        ];
        const children = childKeys.map(key => clusters.get(key));
        if (children.some(child => child === undefined)) continue;
        const blockIndex = top * plan.gridColumns + left;
        const threshold = hashUnit(
          plan.seed ^ Math.imul(plan.tick + 1, CLOCK_WATERFALL_SALT),
          blockIndex,
          square.squareIndex * 16 + size,
        );
        if (probability < threshold) continue;
        for (const key of childKeys) clusters.delete(key);
        const childDots = children.map(child => child.dot);
        clusters.set(`${left}:${top}:${size}`, {
          left,
          top,
          size,
          dot: {
            ...childDots[0],
            column: left + (size - 1) / 2,
            row: top + (size - 1) / 2,
            index: blockIndex,
            clockwiseIndex: Math.max(...childDots.map(dot => dot.clockwiseIndex)),
            palettePosition: childDots.reduce(
              (sum, dot) => sum + dot.palettePosition,
              0,
            ) / childDots.length,
            sizeInSubdivisions: size,
            sourceDotCount: childDots.reduce(
              (sum, dot) => sum + dot.sourceDotCount,
              0,
            ),
            waterfallLevel: Math.log2(size),
          },
        });
      }
    }
  }
  return [...clusters.values()]
    .sort((first, second) => (
      first.dot.clockwiseIndex - second.dot.clockwiseIndex
      || first.top - second.top
      || first.left - second.left
    ))
    .map(cluster => cluster.dot);
}

function clockRippleCellLevel(wakeAge, wakeDepth, startingLevel = 0) {
  if (wakeAge < 0 || wakeAge >= wakeDepth) return null;
  const levelCount = 4 - startingLevel;
  return Math.min(
    3,
    startingLevel + Math.floor(wakeAge / wakeDepth * levelCount),
  );
}

function clockRippleGlyphState({
  level,
  wakeAgeInCells,
  wakeDepthInCells,
  startingLevel,
  ripple,
  seed,
}) {
  const wakeProgress = Math.max(0, Math.min(
    1,
    wakeAgeInCells / wakeDepthInCells,
  ));
  const levelCount = 4 - startingLevel;
  const levelProgress = wakeProgress * levelCount - (level - startingLevel);
  return {
    wakeAgeInCells,
    wakeProgress,
    glyphShape: "circle",
    glyphFill: level === 3
      ? 1 - Math.max(0, Math.min(1, levelProgress))
      : 1,
    glyphSeed: (seed ^ (
      ripple === "text-echo"
        ? CLOCK_RIPPLE_ECHO_GLYPH_SALT
        : CLOCK_RIPPLE_PRIMARY_GLYPH_SALT
    )) >>> 0,
  };
}

function clockRippleCells({
  columns,
  rows,
  originCellIndex,
  radiusInCells,
  wakeDepthInCells,
  startingLevel = 0,
  ripple,
  seed = 0,
  holdOrigin = false,
  maximumActivationRadiusInCells = Number.POSITIVE_INFINITY,
}) {
  const originColumn = originCellIndex % columns;
  const originRow = Math.floor(originCellIndex / columns);
  const cells = [];
  for (let index = 0; index < columns * rows; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const distanceInCells = Math.hypot(
      column - originColumn,
      row - originRow,
    );
    if (holdOrigin && index === originCellIndex) {
      cells.push({
        index,
        level: 0,
        distanceInCells,
        ripple,
        held: true,
        ...clockRippleGlyphState({
          level: 0,
          wakeAgeInCells: 0,
          wakeDepthInCells,
          startingLevel,
          ripple,
          seed,
        }),
      });
      continue;
    }
    if (distanceInCells > maximumActivationRadiusInCells) continue;
    const wakeAgeInCells = radiusInCells - distanceInCells;
    const level = clockRippleCellLevel(
      wakeAgeInCells,
      wakeDepthInCells,
      startingLevel,
    );
    if (level === null) continue;
    cells.push({
      index,
      level,
      distanceInCells,
      ripple,
      held: false,
      ...clockRippleGlyphState({
        level,
        wakeAgeInCells,
        wakeDepthInCells,
        startingLevel,
        ripple,
        seed,
      }),
    });
  }
  return cells.sort((first, second) => (
    first.distanceInCells - second.distanceInCells
    || first.index - second.index
  ));
}

function clockRippleCellsWithWakeFlicker(
  cells,
  linearProgress,
  seed,
  durationBeats,
  settings,
) {
  const flicker = settings ?? { enabled: false };
  const step = flicker.enabled
    ? Math.floor(linearProgress * durationBeats * flicker.flashesPerBeat)
    : 0;
  return cells.map(cell => {
    const eligible = flicker.enabled && cell.level >= 1 && !cell.held;
    const distanceStrength = eligible
      ? Math.exp(-cell.distanceInCells / flicker.distanceDecayInCells)
      : 0;
    const probability = eligible
      ? flicker.probability * distanceStrength
      : 0;
    const triggered = eligible && hashUnit(
      seed ^ CLOCK_RIPPLE_FLICKER_SALT,
      cell.index,
      step,
    ) < probability;
    return {
      ...cell,
      flickerEligible: eligible,
      flickerTriggered: triggered,
      flickerProbability: probability,
      flickerStrength: distanceStrength,
      flickerStep: step,
      opacity: triggered
        ? 1 - (1 - flicker.minimumOpacity) * distanceStrength
        : 1,
    };
  });
}

function clockRippleTextSourceCell(plan, columns, rows, originCellIndex) {
  const subdivisions = plan.subdivisions;
  const textSafeZone = plan.birthRippleTextSafeZone ?? plan.textSafeZone;
  const candidates = [];
  for (let index = 0; index < columns * rows; index += 1) {
    if (index === originCellIndex) continue;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * subdivisions;
    const top = row * subdivisions;
    if (
      left >= textSafeZone.right
      || left + subdivisions <= textSafeZone.left
      || top >= textSafeZone.bottom
      || top + subdivisions <= textSafeZone.top
    ) continue;
    candidates.push({
      index,
      column,
      row,
      distanceInCells: Math.hypot(
        column - originCellIndex % columns,
        row - Math.floor(originCellIndex / columns),
      ),
    });
  }
  return candidates.sort((first, second) => (
    first.distanceInCells - second.distanceInCells
    || first.index - second.index
  ))[0] ?? null;
}

function mergeClockRippleCells(primaryCells, secondaryCells) {
  const merged = new Map();
  for (const cell of [...primaryCells, ...secondaryCells]) {
    const previous = merged.get(cell.index);
    if (previous === undefined) {
      merged.set(cell.index, { ...cell, ripples: [cell.ripple] });
      continue;
    }
    const replacesGlyphState = cell.level < previous.level
      || (
        cell.level === previous.level
        && cell.glyphFill > previous.glyphFill
      );
    previous.level = Math.min(previous.level, cell.level);
    if (replacesGlyphState) {
      previous.wakeAgeInCells = cell.wakeAgeInCells;
      previous.wakeProgress = cell.wakeProgress;
      previous.glyphShape = cell.glyphShape;
      previous.glyphFill = cell.glyphFill;
      previous.glyphSeed = cell.glyphSeed;
    }
    previous.held ||= cell.held;
    if (!previous.ripples.includes(cell.ripple)) previous.ripples.push(cell.ripple);
  }
  return [...merged.values()].sort((first, second) => first.index - second.index);
}

export function countdownClockBirthRippleAt(plan, linearProgress, settings) {
  if (!plan || !Number.isSafeInteger(plan.handoffCellIndex)) {
    throw new TypeError("Countdown clock birth ripple requires a handoff cell.");
  }
  const ripple = requireObject(
    settings?.birthRipple,
    "countdownFramed.appearance.effects.clock.birthRipple",
  );
  const subdivisions = requirePositiveInteger(
    plan.subdivisions,
    "Countdown clock birth ripple subdivisions",
  );
  const columns = requirePositiveInteger(
    plan.gridColumns / subdivisions,
    "Countdown clock birth ripple columns",
  );
  const rows = requirePositiveInteger(
    plan.gridRows / subdivisions,
    "Countdown clock birth ripple rows",
  );
  if (plan.handoffCellIndex < 0 || plan.handoffCellIndex >= columns * rows) {
    throw new RangeError("Countdown clock birth ripple handoff cell is outside the grid.");
  }
  const wakeDepthInCells = requireFinitePositive(
    ripple.wakeDepthInCells,
    "Countdown clock birth ripple wake depth",
  );
  const secondaryMaximumRadiusInCells = requireFinitePositive(
    ripple.secondaryRadiusInCells,
    "Countdown clock birth ripple secondary radius",
  );
  const resolvedLinearProgress = Math.max(0, Math.min(
    1,
    Number(linearProgress) || 0,
  ));
  const progress = cubicBezierAt(
    resolvedLinearProgress,
    ripple.radialTimingCurve,
  );
  const handoffLinearProgress = Math.min(
    1,
    ripple.startBeforeHandoffBeats / ripple.durationBeats,
  );
  const holdingOrigin = resolvedLinearProgress < handoffLinearProgress;
  const originCellIndex = plan.handoffCellIndex;
  const originColumn = originCellIndex % columns;
  const originRow = Math.floor(originCellIndex / columns);
  const edgeCellDistances = [
    [0, 0],
    [columns - 1, 0],
    [0, rows - 1],
    [columns - 1, rows - 1],
  ].map(([column, row]) => Math.hypot(
    column - originColumn,
    row - originRow,
  ));
  const edgeRadiusInCells = Math.max(...edgeCellDistances);
  const maximumRadiusInCells = edgeRadiusInCells + wakeDepthInCells;
  const radiusInCells = maximumRadiusInCells * progress
    + (resolvedLinearProgress >= 1 ? 1e-9 : 0);
  const primaryCells = clockRippleCellsWithWakeFlicker(
    clockRippleCells({
      columns,
      rows,
      originCellIndex,
      radiusInCells,
      wakeDepthInCells,
      ripple: "primary",
      seed: plan.seed ?? 0,
      holdOrigin: holdingOrigin,
      maximumActivationRadiusInCells: edgeRadiusInCells,
    }),
    resolvedLinearProgress,
    plan.seed ?? 0,
    ripple.durationBeats,
    ripple.wakeFlicker,
  );
  const textSource = clockRippleTextSourceCell(
    plan,
    columns,
    rows,
    originCellIndex,
  );
  const secondaryStarted = textSource !== null
    && radiusInCells >= textSource.distanceInCells;
  const secondaryProgress = !secondaryStarted
    ? 0
    : (radiusInCells - textSource.distanceInCells)
      / Math.max(1e-9, maximumRadiusInCells - textSource.distanceInCells);
  const secondaryTravelRadiusInCells = secondaryMaximumRadiusInCells
    + wakeDepthInCells;
  const secondaryRadiusInCells = secondaryTravelRadiusInCells
    * secondaryProgress;
  const sourceLevel = secondaryStarted
    ? clockRippleCellLevel(0, wakeDepthInCells) ?? 0
    : null;
  const secondaryCells = secondaryStarted
    ? clockRippleCells({
      columns,
      rows,
      originCellIndex: textSource.index,
      radiusInCells: secondaryRadiusInCells,
      wakeDepthInCells,
      startingLevel: sourceLevel,
      ripple: "text-echo",
      seed: plan.seed ?? 0,
      maximumActivationRadiusInCells: secondaryMaximumRadiusInCells,
    })
    : [];
  const secondaryActive = secondaryCells.length > 0;
  const cells = mergeClockRippleCells(primaryCells, secondaryCells);
  const flickerEligibleCells = primaryCells.filter(cell => cell.flickerEligible);
  const flickerTriggeredCells = primaryCells.filter(cell => cell.flickerTriggered);
  return {
    linearProgress: resolvedLinearProgress,
    progress,
    handoffLinearProgress,
    holdingOrigin,
    originCellIndex,
    originColumn,
    originRow,
    primary: {
      radiusInCells,
      maximumRadiusInCells,
      edgeRadiusInCells,
      wakeDepthInCells,
      activeCellCount: primaryCells.length,
      flicker: {
        enabled: ripple.wakeFlicker?.enabled === true,
        step: primaryCells[0]?.flickerStep ?? 0,
        eligibleCellCount: flickerEligibleCells.length,
        triggeredCellIndices: flickerTriggeredCells.map(cell => cell.index),
        maximumProbability: Math.max(
          0,
          ...flickerEligibleCells.map(cell => cell.flickerProbability),
        ),
      },
      cells: primaryCells,
    },
    secondary: {
      active: secondaryActive,
      progress: secondaryProgress,
      originCellIndex: textSource?.index ?? null,
      originColumn: textSource?.column ?? null,
      originRow: textSource?.row ?? null,
      activationRadiusInCells: textSource?.distanceInCells ?? null,
      sourceLevel,
      radiusInCells: secondaryRadiusInCells,
      maximumRadiusInCells: secondaryTravelRadiusInCells,
      edgeRadiusInCells: secondaryMaximumRadiusInCells,
      activeCellCount: secondaryCells.length,
      cells: secondaryCells,
    },
    cells,
  };
}

export function countdownClockFrame(
  plan,
  linearProgress,
  settings,
  birthRippleLinearProgress = null,
) {
  const dotsPerSquare = plan?.squareSize * plan?.squareSize;
  const totalDotCount = plan?.squares?.length * dotsPerSquare;
  if (!plan || !Array.isArray(plan.dots) || plan.dots.length !== totalDotCount) {
    throw new TypeError("Countdown clock plan requires its configured dots.");
  }
  if (settings.birthRipple?.enabled === true && birthRippleLinearProgress !== null) {
    const birthRipple = countdownClockBirthRippleAt(
      plan,
      birthRippleLinearProgress,
      settings,
    );
    const cells = birthRipple.cells.map(cell => ({ ...cell }));
    return {
      linearProgress: birthRipple.linearProgress,
      progress: birthRipple.progress,
      visiblePerSquare: 0,
      visibleCountsBySquare: [],
      sourceVisibleCountsBySquare: [],
      visibleCount: cells.length,
      sourceVisibleCount: cells.length,
      renderSignature: cells.map(cell => (
        `${cell.index}:${cell.level}:${cell.ripples.join("+")}`
      )).join(","),
      totalDotCount: cells.length,
      evolutionMode: plan.evolutionMode,
      evolutionProgress: plan.evolutionProgress,
      squareSize: plan.squareSize,
      handoffCellIndex: plan.handoffCellIndex,
      squares: [],
      birthRipple,
      cells,
      dots: [],
    };
  }
  const progress = clockwiseVisibleCountAt(
    linearProgress,
    dotsPerSquare,
    settings.timingCurve,
  );
  const squareFrames = plan.squares.map(square => {
    const ageBeats = Math.max(0, Number(linearProgress) || 0);
    const beatDurationBeats = square.beatDurationBeats ?? 1;
    const active = ageBeats < beatDurationBeats;
    const lifetimeLinearProgress = ageBeats / beatDurationBeats;
    const stagger = (square.appearanceStaggerBeats ?? 0) / beatDurationBeats;
    const staggeredLinearProgress = stagger >= 0
      ? (lifetimeLinearProgress - stagger) / (1 - stagger)
      : lifetimeLinearProgress / (1 + stagger);
    const squareProgress = clockwiseVisibleCountAt(
      staggeredLinearProgress,
      dotsPerSquare,
      settings.timingCurve,
    );
    const sourceDots = active ? square.dots.filter(
      dot => dot.clockwiseIndex < squareProgress.visibleCount,
    ) : [];
    const waterfallProbability = countdownClockWaterfallProbability(
      squareProgress.progress,
      plan,
      square,
      settings,
    );
    const dots = countdownClockWaterfallDots(
      plan,
      square,
      sourceDots,
      waterfallProbability,
    );
    return {
      square,
      active,
      sourceTick: plan.tick,
      ageBeats,
      beatDurationBeats,
      totalDotCount: dotsPerSquare,
      linearProgress: squareProgress.linearProgress,
      progress: squareProgress.progress,
      sourceVisibleCount: squareProgress.visibleCount,
      visibleCount: dots.length,
      waterfallProbability,
      maximumDotSize: Math.max(0, ...dots.map(dot => dot.sizeInSubdivisions ?? 1)),
      dots,
    };
  });
  const dots = squareFrames.flatMap(square => square.dots.map(dot => ({ ...dot })));
  return {
    linearProgress: progress.linearProgress,
    progress: progress.progress,
    visiblePerSquare: progress.visibleCount,
    visibleCountsBySquare: squareFrames.map(square => square.visibleCount),
    sourceVisibleCountsBySquare: squareFrames.map(square => square.sourceVisibleCount),
    visibleCount: squareFrames.reduce((sum, square) => sum + square.visibleCount, 0),
    sourceVisibleCount: squareFrames.reduce(
      (sum, square) => sum + square.sourceVisibleCount,
      0,
    ),
    renderSignature: dots.map(dot => (
      `${dot.appearanceTick}:${dot.squareIndex}:${dot.index}:`
      + `${dot.sizeInSubdivisions ?? 1}`
    )).join(","),
    totalDotCount,
    evolutionMode: plan.evolutionMode,
    evolutionProgress: plan.evolutionProgress,
    squareSize: plan.squareSize,
    handoffCellIndex: plan.handoffCellIndex,
    birthRipple: null,
    cells: [],
    squares: squareFrames.map(({ square, dots, ...squareFrame }) => ({
      squareIndex: square.squareIndex,
      motionRole: square.motionRole,
      appearanceStaggerBeats: square.appearanceStaggerBeats ?? 0,
      beatOffsetActive: square.beatOffsetActive ?? false,
      beatDurationBeats: square.beatDurationBeats ?? 1,
      topLeftColumn: square.topLeftColumn,
      topLeftRow: square.topLeftRow,
      ...squareFrame,
    })),
    dots,
  };
}

export function countdownClockFrameByRoles(frame, roles) {
  if (!frame || !Array.isArray(frame.squares) || !Array.isArray(frame.dots)) {
    throw new TypeError("Countdown clock role filter requires a clock frame.");
  }
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new TypeError("Countdown clock role filter requires roles.");
  }
  if (frame.birthRipple !== null) return frame;
  const roleSet = new Set(roles);
  const squares = frame.squares.filter(square => roleSet.has(square.motionRole)).map(
    square => ({ ...square }),
  );
  const squareKeys = new Set(squares.map(
    square => `${square.sourceTick}:${square.squareIndex}`,
  ));
  const dots = frame.dots.filter(dot => squareKeys.has(
    `${dot.appearanceTick}:${dot.squareIndex}`,
  )).map(dot => ({ ...dot }));
  return {
    ...frame,
    visibleCountsBySquare: squares.map(square => square.visibleCount),
    sourceVisibleCountsBySquare: squares.map(square => square.sourceVisibleCount),
    visibleCount: squares.reduce((sum, square) => sum + square.visibleCount, 0),
    sourceVisibleCount: squares.reduce(
      (sum, square) => sum + square.sourceVisibleCount,
      0,
    ),
    totalDotCount: squares.reduce(
      (sum, square) => sum + square.totalDotCount,
      0,
    ),
    renderSignature: dots.map(dot => (
      `${dot.appearanceTick}:${dot.squareIndex}:${dot.index}:`
      + `${dot.sizeInSubdivisions ?? 1}`
    )).join(","),
    offsetSquareCount: 0,
    squares,
    dots,
  };
}

export function combineCountdownClockRoleFrames(primaryFrame, offsetFrames = []) {
  if (!primaryFrame || !Array.isArray(primaryFrame.squares)) {
    throw new TypeError("Countdown clock frame combination requires a primary frame.");
  }
  if (!Array.isArray(offsetFrames)) {
    throw new TypeError("Countdown clock offset frames must be an array.");
  }
  if (primaryFrame.birthRipple !== null) return primaryFrame;

  const offsetSquares = [];
  const offsetDots = [];
  for (const frame of offsetFrames) {
    if (!frame || !Array.isArray(frame.squares) || !Array.isArray(frame.dots)) {
      throw new TypeError("Countdown clock offset frame is invalid.");
    }
    for (const square of frame.squares) {
      if (square.motionRole !== "traveling" || !square.active) continue;
      offsetSquares.push({ ...square });
      offsetDots.push(...frame.dots.filter(dot => (
        dot.appearanceTick === square.sourceTick
        && dot.squareIndex === square.squareIndex
      )).map(dot => ({ ...dot })));
    }
  }

  const squares = [
    ...offsetSquares,
    ...primaryFrame.squares.map(square => ({ ...square })),
  ];
  const dots = [
    ...offsetDots,
    ...primaryFrame.dots.map(dot => ({ ...dot })),
  ];
  return {
    ...primaryFrame,
    visibleCountsBySquare: squares.map(square => square.visibleCount),
    sourceVisibleCountsBySquare: squares.map(square => square.sourceVisibleCount),
    visibleCount: squares.reduce((sum, square) => sum + square.visibleCount, 0),
    sourceVisibleCount: squares.reduce(
      (sum, square) => sum + square.sourceVisibleCount,
      0,
    ),
    totalDotCount: squares.reduce(
      (sum, square) => sum + square.totalDotCount,
      0,
    ),
    renderSignature: dots.map(dot => (
      `${dot.appearanceTick}:${dot.squareIndex}:${dot.index}:`
      + `${dot.sizeInSubdivisions ?? 1}`
    )).join(","),
    offsetSquareCount: offsetSquares.length,
    squares,
    dots,
  };
}

export function countdownClockDotColors(frame, palette, flicker, time) {
  return clockwiseDotColors(frame, palette, flicker, time);
}

export function drawCountdownClock(
  context,
  layout,
  frame,
  settings,
  colors,
) {
  if (!settings.enabled || frame.dots.length === 0) return;
  const subdivisions = 1 << settings.subdivisionLevel;
  const slot = layout.cellSize / subdivisions;
  const radius = slot * 0.5 * (1 - settings.dotMargin);

  context.save();
  for (let index = 0; index < frame.dots.length; index += 1) {
    const dot = frame.dots[index];
    const x = layout.offsetX + (dot.column + 0.5) * slot;
    const y = layout.offsetY + (dot.row + 0.5) * slot;
    const dotRadius = radius * (dot.sizeInSubdivisions ?? 1);
    context.fillStyle = colors[index];
    context.beginPath();
    context.moveTo(x + dotRadius, y);
    context.arc(x, y, dotRadius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}
