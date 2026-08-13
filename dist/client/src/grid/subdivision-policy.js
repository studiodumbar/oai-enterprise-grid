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

export class FourLevelSubdivisionPolicy {
  levelAt(brightness) {
    return fourLevelAt(brightness);
  }
}

export function createFourLevelSubdivisionPolicy() {
  return new FourLevelSubdivisionPolicy();
}

export default FourLevelSubdivisionPolicy;
