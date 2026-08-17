import { resolveSceneTransitionSettings } from "../scene-transitions/index.js";

const IDENTITY_PRESENTATION = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  opacity: 1,
  scale: 1,
});

export const DEFAULT_CIRCLE_ENDPOINT_SETTINGS = Object.freeze({
  startWithCircle: false,
  startWithCircleDurationSeconds: 1,
  endWithCircle: false,
  endWithCircleDurationSeconds: 1,
  circleSubdivision: 1,
});

export const MAX_CIRCLE_SUBDIVISION = 16;
export const ENDPOINT_SAMPLE_HOLD_SECONDS = 1 / 60;
export const AUTO_CIRCLE_ENDPOINT_DURATION = "auto";

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function isPowerOfTwo(value) {
  return value > 0 && (value & (value - 1)) === 0;
}

function requireDurationSetting(value, label) {
  if (value !== AUTO_CIRCLE_ENDPOINT_DURATION && (!Number.isFinite(value) || value <= 0)) {
    throw new RangeError(`${label} must be "auto" or a finite positive number.`);
  }
  return value;
}

function resolveDurationSetting(value, automaticValue, label) {
  if (value !== AUTO_CIRCLE_ENDPOINT_DURATION) return value;
  if (!Number.isFinite(automaticValue) || automaticValue <= 0) {
    throw new RangeError(`${label} could not resolve "auto" to a positive duration.`);
  }
  return automaticValue;
}

export function normalizeCircleEndpointSettings(settings = {}) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new TypeError("Composition settings must be an object.");
  }
  const normalized = {
    startWithCircle: settings.startWithCircle
      ?? DEFAULT_CIRCLE_ENDPOINT_SETTINGS.startWithCircle,
    startWithCircleDurationSeconds: settings.startWithCircleDurationSeconds
      ?? DEFAULT_CIRCLE_ENDPOINT_SETTINGS.startWithCircleDurationSeconds,
    endWithCircle: settings.endWithCircle
      ?? DEFAULT_CIRCLE_ENDPOINT_SETTINGS.endWithCircle,
    endWithCircleDurationSeconds: settings.endWithCircleDurationSeconds
      ?? DEFAULT_CIRCLE_ENDPOINT_SETTINGS.endWithCircleDurationSeconds,
    circleSubdivision: settings.circleSubdivision
      ?? DEFAULT_CIRCLE_ENDPOINT_SETTINGS.circleSubdivision,
  };
  if (typeof normalized.startWithCircle !== "boolean") {
    throw new TypeError("composition.startWithCircle must be true or false.");
  }
  if (typeof normalized.endWithCircle !== "boolean") {
    throw new TypeError("composition.endWithCircle must be true or false.");
  }
  requireDurationSetting(
    normalized.startWithCircleDurationSeconds,
    "composition.startWithCircleDurationSeconds",
  );
  requireDurationSetting(
    normalized.endWithCircleDurationSeconds,
    "composition.endWithCircleDurationSeconds",
  );
  if (
    !Number.isSafeInteger(normalized.circleSubdivision)
    || !isPowerOfTwo(normalized.circleSubdivision)
    || normalized.circleSubdivision > MAX_CIRCLE_SUBDIVISION
  ) {
    throw new RangeError(
      `composition.circleSubdivision must be one of 1, 2, 4, 8, or ${MAX_CIRCLE_SUBDIVISION}.`,
    );
  }
  return Object.freeze(normalized);
}

function resolvedEndpointDurations(normalized, automaticDurations = {}) {
  return {
    start: resolveDurationSetting(
      normalized.startWithCircleDurationSeconds,
      automaticDurations.start,
      "composition.startWithCircleDurationSeconds",
    ),
    end: resolveDurationSetting(
      normalized.endWithCircleDurationSeconds,
      automaticDurations.end,
      "composition.endWithCircleDurationSeconds",
    ),
  };
}

export function animationDurationWithCircleEndpoints(
  coreDuration,
  settings,
  automaticDurations,
) {
  if (!Number.isFinite(coreDuration) || coreDuration <= 0) return null;
  const normalized = normalizeCircleEndpointSettings(settings);
  const durations = resolvedEndpointDurations(normalized, automaticDurations);
  return coreDuration
    + (normalized.startWithCircle ? durations.start : 0)
    + (normalized.endWithCircle ? durations.end : 0);
}

/** Maps the outer composition clock onto a paused native-animation clock. */
export function circleEndpointTimelineAt(
  elapsed,
  coreDuration,
  settings,
  automaticDurations,
) {
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    throw new RangeError("Circle-endpoint elapsed time must be finite and non-negative.");
  }
  const normalized = normalizeCircleEndpointSettings(settings);
  const durations = resolvedEndpointDurations(normalized, automaticDurations);
  const startDuration = normalized.startWithCircle
    ? durations.start
    : 0;
  const finiteCore = Number.isFinite(coreDuration) && coreDuration > 0;
  const endDuration = normalized.endWithCircle && finiteCore
    ? durations.end
    : 0;

  if (!finiteCore) {
    if (startDuration > 0 && elapsed < startDuration) {
      return {
        phase: "start",
        progress: clamp01(elapsed / startDuration),
        durationSeconds: startDuration,
        cycleIndex: 0,
        coreTime: 0,
      };
    }
    return {
      phase: "core",
      progress: null,
      durationSeconds: null,
      cycleIndex: 0,
      coreTime: Math.max(0, elapsed - startDuration),
    };
  }

  const totalDuration = startDuration + coreDuration + endDuration;
  const cycleIndex = Math.floor(elapsed / totalDuration);
  const localElapsed = elapsed - cycleIndex * totalDuration;
  const coreSampleEnd = endDuration > 0
    ? Math.max(0, coreDuration - Math.min(ENDPOINT_SAMPLE_HOLD_SECONDS, coreDuration * 0.5))
    : coreDuration;
  if (localElapsed < startDuration) {
    return {
      phase: "start",
      progress: clamp01(localElapsed / startDuration),
      durationSeconds: startDuration,
      cycleIndex,
      coreTime: cycleIndex * coreDuration,
    };
  }
  const coreElapsed = localElapsed - startDuration;
  if (coreElapsed < coreDuration) {
    return {
      phase: "core",
      progress: null,
      durationSeconds: coreDuration,
      cycleIndex,
      coreTime: cycleIndex * coreDuration + Math.min(coreElapsed, coreSampleEnd),
    };
  }
  return {
    phase: "end",
    progress: clamp01((coreElapsed - coreDuration) / endDuration),
    durationSeconds: endDuration,
    cycleIndex,
    coreTime: cycleIndex * coreDuration + coreSampleEnd,
  };
}

export function circleEndpointSourceItems(layout, subdivision) {
  const width = Number(layout?.width);
  const height = Number(layout?.height);
  const cellSize = Number(layout?.cellSize);
  if (!(width > 0) || !(height > 0) || !(cellSize > 0)) {
    throw new TypeError("Circle endpoints require layout width, height, and cellSize.");
  }
  const slot = cellSize / subdivision;
  const left = width * 0.5 - cellSize * 0.5;
  const top = height * 0.5 - cellSize * 0.5;
  const items = [];
  for (let row = 0; row < subdivision; row += 1) {
    for (let column = 0; column < subdivision; column += 1) {
      items.push({
        id: `circle:${row}:${column}`,
        x: left + (column + 0.5) * slot,
        y: top + (row + 0.5) * slot,
        size: slot,
      });
    }
  }
  return items;
}

function createMode(modeRegistry, transitionSettings, label) {
  const resolved = resolveSceneTransitionSettings({}, transitionSettings ?? {});
  if (!modeRegistry?.has?.(resolved.mode) || typeof modeRegistry.create !== "function") {
    throw new Error(`${label} refers to unknown scene-transition mode "${resolved.mode}".`);
  }
  return modeRegistry.create(resolved.mode, resolved.modes[resolved.mode]);
}

/** Supplies arrangement transforms while each generator keeps its native renderer. */
export class NativeCircleEndpointTransition {
  constructor({ settings, intro, outro, modeRegistry }) {
    this.settings = normalizeCircleEndpointSettings(settings);
    this.startMode = this.settings.startWithCircle
      ? createMode(modeRegistry, intro, "Circle start")
      : null;
    this.endMode = this.settings.endWithCircle
      ? createMode(modeRegistry, outro?.fallbackToIntro ? intro : (outro ?? intro), "Circle end")
      : null;
    this.reset();
  }

  prepare(endpoint, items, layout) {
    if (!endpoint || (endpoint.phase !== "start" && endpoint.phase !== "end")) {
      this.reset();
      return false;
    }
    const mode = endpoint.phase === "start" ? this.startMode : this.endMode;
    if (!mode) return false;
    const itemSignature = items
      .map(item => [item.id, item.x, item.y, item.size].join("@"))
      .join("|");
    const key = [
      endpoint.phase,
      endpoint.cycleIndex,
      layout.width,
      layout.height,
      layout.cellSize,
      itemSignature,
    ].join(":");
    if (key !== this.cacheKey) {
      const sourceItems = circleEndpointSourceItems(
        layout,
        this.settings.circleSubdivision,
      );
      const transitionItems = [...items];
      this.presentationIdsByTarget = new Map(
        items.map(item => [item.id, [item.id]]),
      );
      // A sparse universe may expose fewer destination glyphs than the full
      // endpoint cell. Duplicate real destinations so every source glyph stays
      // visible and follows the same native transition. The duplicates overlap
      // their real destination exactly at the other end of the phase.
      if (items.length > 0) {
        for (let index = items.length; index < sourceItems.length; index += 1) {
          const target = items[(index - items.length) % items.length];
          const id = `circle-endpoint:${index}:${target.id}`;
          transitionItems.push({ ...target, id });
          this.presentationIdsByTarget.get(target.id).push(id);
        }
      }
      this.plan = mode.createPlan({
        items: transitionItems,
        fromItems: sourceItems,
        layout,
        key,
        durationSeconds: endpoint.durationSeconds,
      });
      this.cacheKey = key;
      this.mode = mode;
    }
    this.endpoint = endpoint;
    return true;
  }

  presentationFor(id) {
    if (!this.endpoint || !this.plan || !this.mode) return IDENTITY_PRESENTATION;
    const progress = this.endpoint.phase === "start"
      ? this.endpoint.progress
      : 1 - this.endpoint.progress;
    return this.mode.presentationAt(this.plan, id, progress);
  }

  presentationsFor(id) {
    if (!this.endpoint || !this.plan || !this.mode) return [IDENTITY_PRESENTATION];
    const presentationIds = this.presentationIdsByTarget?.get(id) ?? [id];
    return presentationIds.map(presentationId => {
      const progress = this.endpoint.phase === "start"
        ? this.endpoint.progress
        : 1 - this.endpoint.progress;
      return this.mode.presentationAt(this.plan, presentationId, progress);
    });
  }

  reset() {
    this.cacheKey = null;
    this.mode = null;
    this.plan = null;
    this.endpoint = null;
    this.presentationIdsByTarget = null;
  }
}
