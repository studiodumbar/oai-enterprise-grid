export const DEFAULT_SIMULATION_FPS = 60;

export function frameCountFor(duration, fps) {
  const seconds = Number(duration);
  const rate = Math.round(Number(fps));
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new RangeError("Export duration must be a finite positive number.");
  }
  if (!Number.isInteger(rate) || rate <= 0) {
    throw new RangeError("Export FPS must be a positive integer.");
  }
  return Math.max(1, Math.round(seconds * rate));
}

export function frameTimeAt(index, fps) {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError("Frame index must be a non-negative integer.");
  }
  const rate = Math.round(Number(fps));
  if (!Number.isInteger(rate) || rate <= 0) {
    throw new RangeError("Export FPS must be a positive integer.");
  }
  return index / rate;
}

export function fixedStepsBetween(from, to, simulationFps = DEFAULT_SIMULATION_FPS) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    throw new RangeError("Simulation times must be finite and non-decreasing.");
  }
  const rate = Math.round(Number(simulationFps));
  if (!Number.isInteger(rate) || rate <= 0) {
    throw new RangeError("Simulation FPS must be a positive integer.");
  }
  const step = 1 / rate;
  const result = [];
  let cursor = from;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(from), Math.abs(to)) * 16;
  while (cursor + step < to - tolerance) {
    result.push(step);
    cursor += step;
  }
  const remaining = to - cursor;
  if (remaining > tolerance) result.push(remaining);
  return result;
}

export function fixedStepsForFrame(frameIndex, fps, simulationFps = DEFAULT_SIMULATION_FPS) {
  const start = frameTimeAt(frameIndex, fps);
  const end = frameTimeAt(frameIndex + 1, fps);
  return fixedStepsBetween(start, end, simulationFps);
}
