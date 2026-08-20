export const AUTO_DURATION = "auto";

const CALCULATED_AUTO_PATTERN = /^calc\(\s*auto\s*\*\s*(\d*\.?\d+)\s*\)$/;

export function automaticDurationMultiplier(value) {
  if (value === AUTO_DURATION) return 1;
  if (typeof value !== "string") return null;
  const match = value.match(CALCULATED_AUTO_PATTERN);
  if (!match) return null;
  const multiplier = Number(match[1]);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null;
}

export function isAutomaticDurationSetting(value) {
  return automaticDurationMultiplier(value) !== null;
}

export function requireDurationSetting(value, label) {
  if (
    (!Number.isFinite(value) || value <= 0)
    && !isAutomaticDurationSetting(value)
  ) {
    throw new RangeError(
      `${label} must be a finite positive number, "auto", or `
      + '"calc(auto * n)" with a positive multiplier.',
    );
  }
  return value;
}

export function resolveAutomaticDuration(value, { label, candidates = [] } = {}) {
  requireDurationSetting(value, label ?? "Duration");
  if (Number.isFinite(value)) {
    return {
      authored: value,
      source: "explicit",
      baseSeconds: value,
      multiplier: 1,
      seconds: value,
    };
  }
  const multiplier = automaticDurationMultiplier(value);
  const selected = candidates.find(
    candidate => Number.isFinite(candidate?.seconds) && candidate.seconds > 0,
  );
  if (!selected) {
    throw new RangeError(
      `${label ?? "Duration"} is ${JSON.stringify(value)}, but no positive `
      + "automatic duration candidate was available.",
    );
  }
  return {
    authored: value,
    source: selected.source ?? "automatic",
    baseSeconds: selected.seconds,
    multiplier,
    seconds: selected.seconds * multiplier,
  };
}
