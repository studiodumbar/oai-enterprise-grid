import { resolveSceneTransitionSettings } from "../scene-transitions/index.js";
import { presentationsFrom } from "../transitions/presentations.js";
import { debug } from "../debug/index.js";
import {
  AUTO_DURATION,
  requireDurationSetting,
  resolveAutomaticDuration,
} from "../core/automatic-duration.js";

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
export const AUTO_CIRCLE_ENDPOINT_DURATION = AUTO_DURATION;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function isPowerOfTwo(value) {
  return value > 0 && (value & (value - 1)) === 0;
}

function resolveDurationSetting(value, automaticValue, label) {
  return resolveAutomaticDuration(value, {
    label,
    candidates: [{ source: "resolved-phase", seconds: automaticValue }],
  }).seconds;
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

function createMode(modeRegistry, transitionSettings, phase, label) {
  const resolved = resolveSceneTransitionSettings({}, transitionSettings ?? {});
  if (typeof modeRegistry?.createForPhase !== "function") {
    throw new TypeError(`${label} requires an arrangement mode registry.`);
  }
  return {
    name: resolved.mode,
    mode: modeRegistry.createForPhase(
      resolved.mode,
      phase,
      resolved.modes[resolved.mode],
      label,
    ),
  };
}

/** Supplies arrangement transforms while each generator keeps its native renderer. */
export class NativeCircleEndpointTransition {
  constructor({ settings, intro, outro, modeRegistry }) {
    this.settings = normalizeCircleEndpointSettings(settings);
    this.start = this.settings.startWithCircle
      ? createMode(modeRegistry, intro, "intro", "Circle start endpoint")
      : null;
    this.end = this.settings.endWithCircle
      ? createMode(
        modeRegistry,
        outro?.fallbackToIntro ? intro : (outro ?? intro),
        "outro",
        "Circle end endpoint",
      )
      : null;
    this.reset();
  }

  prepare(endpoint, items, layout) {
    if (!endpoint || (endpoint.phase !== "start" && endpoint.phase !== "end")) {
      this.reset();
      return false;
    }
    const entry = endpoint.phase === "start" ? this.start : this.end;
    if (!entry) return false;
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
      // `unpaired` counts targets with no circle source. What that costs is the
      // mode's business: a fade simply has no circle behind those glyphs, while
      // a motion mode has to invent a start position for each one.
      debug.transition(
        "endpoint=%s mode=%s cycle=%d targets=%d sources=%d padded=%d "
        + "subdivision=%d unpaired=%d",
        endpoint.phase,
        entry.name,
        endpoint.cycleIndex,
        transitionItems.length,
        sourceItems.length,
        transitionItems.length - items.length,
        this.settings.circleSubdivision,
        Math.max(0, transitionItems.length - sourceItems.length),
      );
      this.plan = entry.mode.createPlan({
        items: transitionItems,
        fromItems: sourceItems,
        layout,
        key,
        durationSeconds: endpoint.durationSeconds,
      });
      this.cacheKey = key;
      this.mode = entry.mode;
      this.modeName = entry.name;
    }
    this.endpoint = endpoint;
    return true;
  }

  progressFor() {
    return this.endpoint.phase === "start"
      ? this.endpoint.progress
      : 1 - this.endpoint.progress;
  }

  presentationFor(id) {
    if (!this.endpoint || !this.plan || !this.mode) return IDENTITY_PRESENTATION;
    return this.mode.presentationAt(this.plan, id, this.progressFor());
  }

  presentationsFor(id) {
    if (!this.endpoint || !this.plan || !this.mode) return [IDENTITY_PRESENTATION];
    const presentationIds = this.presentationIdsByTarget?.get(id) ?? [id];
    const progress = this.progressFor();
    return presentationIds.flatMap(presentationId => presentationsFrom(
      this.mode,
      this.plan,
      presentationId,
      progress,
    ));
  }

  reset() {
    this.cacheKey = null;
    this.mode = null;
    this.modeName = null;
    this.plan = null;
    this.endpoint = null;
    this.presentationIdsByTarget = null;
  }

  inspect() {
    return {
      startWithCircle: this.settings.startWithCircle,
      endWithCircle: this.settings.endWithCircle,
      startMode: this.start?.name ?? null,
      endMode: this.end?.name ?? null,
      circleSubdivision: this.settings.circleSubdivision,
      active: Boolean(this.endpoint && this.plan),
      phase: this.endpoint?.phase ?? null,
      progress: this.endpoint?.progress ?? null,
      cycleIndex: this.endpoint?.cycleIndex ?? null,
      targetCount: this.plan?.targets?.length ?? 0,
      sourceItemCount: this.plan?.sourceItemCount ?? 0,
      // Targets with no source glyph of their own. What that means on screen is
      // the mode's business — see the prepare() comment.
      unpairedTargets: Math.max(
        0,
        (this.plan?.targets?.length ?? 0) - (this.plan?.sourceItemCount ?? 0),
      ),
    };
  }
}
