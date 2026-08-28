export const FOUR_LEVEL_COUNT = 4;
export const MAX_SUBDIVISION_LEVEL = FOUR_LEVEL_COUNT - 1;

export function clampBrightness(brightness) {
  const value = Number(brightness);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function fourLevelAt(brightness) {
  const level = Math.floor(clampBrightness(brightness) * FOUR_LEVEL_COUNT);
  return Math.min(MAX_SUBDIVISION_LEVEL, level);
}

export function validateSubdivisionLevels(levels) {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new TypeError("subdivisionLevels must be a non-empty array.");
  }
  const unique = new Set(levels);
  if (
    unique.size !== levels.length
    || levels.some(level => (
      !Number.isSafeInteger(level)
      || level < 0
      || level > MAX_SUBDIVISION_LEVEL
    ))
  ) {
    throw new RangeError(
      "subdivisionLevels must contain unique integers from zero to three.",
    );
  }
  return [...levels].sort((first, second) => first - second);
}

export class FourLevelSubdivisionPolicy {
  levelAt(brightness) {
    return fourLevelAt(brightness);
  }
}

export class SelectedSubdivisionPolicy {
  constructor(levels) {
    this.levels = validateSubdivisionLevels(levels);
  }

  levelAt(brightness) {
    const index = Math.min(
      this.levels.length - 1,
      Math.floor(clampBrightness(brightness) * this.levels.length),
    );
    return this.levels[index];
  }
}

export function createFourLevelSubdivisionPolicy() {
  return new FourLevelSubdivisionPolicy();
}

export default FourLevelSubdivisionPolicy;
