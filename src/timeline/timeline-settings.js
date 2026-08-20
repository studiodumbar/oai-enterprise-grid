import { resolveAutomaticDuration } from "../core/automatic-duration.js";

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

/**
 * The authored root of a composition's timing graph. It must stay absolute:
 * every automatic child ultimately depends on this body duration.
 */
export function resolveTimelineSettings(settings, label = "timing") {
  requireObject(settings, label);
  const bodyDurationSeconds = requireFinitePositive(
    settings.bodyDurationSeconds,
    `${label}.bodyDurationSeconds`,
  );
  const beatCount = settings.beatCount;
  if (!Number.isSafeInteger(beatCount) || beatCount <= 0) {
    throw new RangeError(`${label}.beatCount must be a positive integer.`);
  }
  const beatSeconds = requireFinitePositive(
    bodyDurationSeconds / beatCount,
    `${label}.beatSeconds`,
  );
  return Object.freeze({
    bodyDurationSeconds,
    beatCount,
    beatSeconds,
  });
}

/** Resolve one automatic duration against its single, named parent. */
export function resolveTimelineDuration(
  value,
  { automaticSeconds, label, source },
) {
  return resolveAutomaticDuration(value, {
    label,
    candidates: [{ source, seconds: automaticSeconds }],
  });
}

/** Reject a legacy clock alias that would create a second timing root. */
export function requireMatchingTimelineValue(
  value,
  expected,
  { label, source },
) {
  if (value !== undefined && value !== expected) {
    throw new RangeError(
      `${label} (${JSON.stringify(value)}) conflicts with ${source} `
      + `(${JSON.stringify(expected)}). Remove ${label} or make the values match.`,
    );
  }
  return expected;
}
