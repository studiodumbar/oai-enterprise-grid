import { debug } from "../debug/index.js";
import { TIMELINE_EFFECTS } from "../core/timeline-effects.js";
import { resolveTimelineSettings } from "../timeline/timeline-settings.js";

export const INTERACTIVE_TAKE_MODES = Object.freeze([
  "frozen",
  "drawing",
  "drawn",
  "playing",
  "sealed",
]);

const PROJECT_STATE_VERSION = 6;
const SKIP_PROJECT_STATE_VERSION = 5;
const BOOM_PROJECT_STATE_VERSION = 4;
const PICASSO_PROJECT_STATE_VERSION = 3;
const MULTI_LAUNCH_PROJECT_STATE_VERSION = 2;
const SINGLE_LAUNCH_PROJECT_STATE_VERSION = 1;
const DEFAULT_MINIMUM_DRAG_PIXELS = 8;
const DEFAULT_FULL_STRENGTH_DRAG_FRACTION = 0.25;

export const INTERACTIVE_TAKE_INTERACTIONS = Object.freeze([
  "launcher",
  "picasso",
  "boom",
  "flow",
]);

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

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function mergeSettings(base, patch) {
  const merged = clone(base ?? {});
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && merged[key]
      && typeof merged[key] === "object"
      && !Array.isArray(merged[key])
    ) {
      merged[key] = mergeSettings(merged[key], value);
    } else {
      merged[key] = clone(value);
    }
  }
  return merged;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function modulo(value, length) {
  return ((value % length) + length) % length;
}

function normalizeDirection(x, y) {
  const length = Math.hypot(x, y);
  if (!(length > 0)) return { directionX: 0, directionY: 0 };
  return { directionX: x / length, directionY: y / length };
}

function normalizedPoint(payload, runtime) {
  const viewport = typeof runtime?.viewport === "function"
    ? runtime.viewport()
    : null;
  const width = Number(payload.width ?? viewport?.width);
  const height = Number(payload.height ?? viewport?.height);
  const x = Number(payload.x);
  const y = Number(payload.y);
  const normalizedX = Number(
    payload.normalizedX
    ?? payload.normalized?.x
    ?? (width > 0 ? x / width : Number.NaN),
  );
  const normalizedY = Number(
    payload.normalizedY
    ?? payload.normalized?.y
    ?? (height > 0 ? y / height : Number.NaN),
  );
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) return null;

  const logicalX = Number.isFinite(x)
    ? x
    : (width > 0 ? normalizedX * width : normalizedX);
  const logicalY = Number.isFinite(y)
    ? y
    : (height > 0 ? normalizedY * height : normalizedY);
  const displayX = Number(
    payload.cssX
    ?? payload.displayX
    ?? payload.clientX
    ?? logicalX,
  );
  const displayY = Number(
    payload.cssY
    ?? payload.displayY
    ?? payload.clientY
    ?? logicalY,
  );
  return {
    normalizedX: clamp01(normalizedX),
    normalizedY: clamp01(normalizedY),
    logicalX,
    logicalY,
    displayX,
    displayY,
    logicalRadiusScale: width > 0 && height > 0 ? Math.min(width, height) : 1,
  };
}

function normalizeBasePlanEntry(definition) {
  requireObject(definition, "Interactive-take definition");
  if (!Array.isArray(definition.steps) || definition.steps.length !== 1) {
    throw new TypeError("Interactive-take definition must contain exactly one generator step.");
  }
  const step = requireObject(definition.steps[0], "Interactive-take generator step");
  if (typeof step.use !== "string" || step.use.trim() === "") {
    throw new TypeError("Interactive-take generator step must have a non-empty use id.");
  }
  const { durationSeconds, ...planEntry } = step;
  if (durationSeconds !== undefined) {
    throw new Error(
      "Interactive-take generator step cannot declare durationSeconds; recorded beats own it.",
    );
  }
  return Object.freeze({ ...planEntry });
}

function validGesture(gesture) {
  if (!gesture || typeof gesture !== "object" || Array.isArray(gesture)) return false;
  const values = [
    gesture.originX,
    gesture.originY,
    gesture.directionX,
    gesture.directionY,
  ];
  if (!values.every(Number.isFinite)) return false;
  if (
    gesture.originX < 0
    || gesture.originX > 1
    || gesture.originY < 0
    || gesture.originY > 1
  ) return false;
  if (
    gesture.strength !== undefined
    && (
      !Number.isFinite(gesture.strength)
      || gesture.strength <= 0
      || gesture.strength > 1
    )
  ) return false;
  const hasEndX = Object.hasOwn(gesture, "endX");
  const hasEndY = Object.hasOwn(gesture, "endY");
  if (hasEndX !== hasEndY) return false;
  if (
    hasEndX
    && (
      !Number.isFinite(gesture.endX)
      || !Number.isFinite(gesture.endY)
      || gesture.endX < 0
      || gesture.endX > 1
      || gesture.endY < 0
      || gesture.endY > 1
    )
  ) return false;
  return Math.abs(Math.hypot(gesture.directionX, gesture.directionY) - 1) <= 1e-9;
}

function validGestures(gestures) {
  return Array.isArray(gestures)
    && gestures.length > 0
    && gestures.every(validGesture);
}

function validPathPoint(point) {
  return Boolean(
    point
    && typeof point === "object"
    && !Array.isArray(point)
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && point.x >= 0
    && point.x <= 1
    && point.y >= 0
    && point.y <= 1
    && Object.keys(point).length === 2
    && Object.hasOwn(point, "x")
    && Object.hasOwn(point, "y"),
  );
}

function validPath(path) {
  if (
    !path
    || typeof path !== "object"
    || Array.isArray(path)
    || Object.keys(path).length !== 1
    || !Object.hasOwn(path, "points")
    || !Array.isArray(path.points)
    || path.points.length < 2
    || !path.points.every(validPathPoint)
  ) return false;
  const first = path.points[0];
  return path.points.some(point => point.x !== first.x || point.y !== first.y);
}

function validBoom(boom) {
  return Boolean(
    boom
    && typeof boom === "object"
    && !Array.isArray(boom)
    && Object.keys(boom).length === 3
    && Object.hasOwn(boom, "centerX")
    && Object.hasOwn(boom, "centerY")
    && Object.hasOwn(boom, "radius")
    && Number.isFinite(boom.centerX)
    && Number.isFinite(boom.centerY)
    && Number.isFinite(boom.radius)
    && boom.centerX >= 0
    && boom.centerX <= 1
    && boom.centerY >= 0
    && boom.centerY <= 1
    && boom.radius > 0
  );
}

function validBoomIntensity(settings) {
  const intensity = settings?.interaction?.boom?.intensity;
  return intensity === undefined
    || (Number.isSafeInteger(intensity) && intensity > 0);
}

function validStep(step) {
  if (
    !step
    || typeof step !== "object"
    || Array.isArray(step)
    || typeof step.id !== "string"
    || step.id === ""
    || !step.settings
    || typeof step.settings !== "object"
    || Array.isArray(step.settings)
    || !validBoomIntensity(step.settings)
  ) return false;
  if (step.interaction === "launcher") {
    return validGestures(step.gestures)
      && !Object.hasOwn(step, "path")
      && !Object.hasOwn(step, "boom");
  }
  if (step.interaction === "picasso") {
    return validPath(step.path)
      && !Object.hasOwn(step, "gestures")
      && !Object.hasOwn(step, "boom");
  }
  if (step.interaction === "boom") {
    return validBoom(step.boom)
      && !Object.hasOwn(step, "gestures")
      && !Object.hasOwn(step, "path");
  }
  if (step.interaction === "flow") {
    return !Object.hasOwn(step, "gestures")
      && !Object.hasOwn(step, "path")
      && !Object.hasOwn(step, "boom");
  }
  return false;
}

function migrateLegacySnapshot(snapshot, defaultShowPath = true) {
  if (snapshot?.version === SKIP_PROJECT_STATE_VERSION) {
    const migrated = clone(snapshot);
    migrated.version = PROJECT_STATE_VERSION;
    migrated.steps = Array.isArray(migrated.steps)
      ? migrated.steps.map(step => ({
        ...step,
        interaction: step.interaction === "skip" ? "flow" : step.interaction,
      }))
      : migrated.steps;
    if (migrated.interactionMode === "skip") migrated.interactionMode = "flow";
    return migrated;
  }
  if (snapshot?.version === BOOM_PROJECT_STATE_VERSION) {
    return {
      ...clone(snapshot),
      version: PROJECT_STATE_VERSION,
    };
  }
  if (snapshot?.version === PICASSO_PROJECT_STATE_VERSION) {
    return {
      ...clone(snapshot),
      version: PROJECT_STATE_VERSION,
      draftBoom: null,
    };
  }
  if (
    snapshot?.version !== SINGLE_LAUNCH_PROJECT_STATE_VERSION
    && snapshot?.version !== MULTI_LAUNCH_PROJECT_STATE_VERSION
  ) return snapshot;
  const migrated = clone(snapshot);
  migrated.version = PROJECT_STATE_VERSION;
  migrated.steps = Array.isArray(snapshot.steps)
    ? snapshot.steps.map(step => {
      const { gesture, gestures, ...rest } = step;
      const launches = snapshot.version === SINGLE_LAUNCH_PROJECT_STATE_VERSION
        ? (validGesture(gesture) ? [clone(gesture)] : [])
        : clone(gestures);
      return {
        ...clone(rest),
        interaction: "launcher",
        gestures: launches,
      };
    })
    : snapshot.steps;
  migrated.draftGestures = snapshot.version === SINGLE_LAUNCH_PROJECT_STATE_VERSION
    ? (
      snapshot.mode === "drawn" && validGesture(snapshot.draftGesture)
        ? [clone(snapshot.draftGesture)]
        : []
    )
    : clone(snapshot.draftGestures ?? []);
  migrated.draftGesture = null;
  migrated.interactionMode = "launcher";
  migrated.draftPath = null;
  migrated.draftBoom = null;
  migrated.takeSettings = mergeSettings(
    { showPath: Boolean(defaultShowPath) },
    snapshot.takeSettings ?? {},
  );
  return migrated;
}

/**
 * Authors deterministic beats that launch, guide, burst, or let the flock flow.
 * The generator reads the immutable take snapshot carried by the render-plan
 * entry; the rule owns editing, beat ordering, and whether the shared endpoint
 * clock may loop.
 */
export class InteractiveTakeRule {
  constructor({ definition, options = {}, runtime = null }) {
    this.basePlanEntry = normalizeBasePlanEntry(definition);
    const timing = resolveTimelineSettings(
      definition.timing,
      `compositionDefinitions.${definition.id ?? "interactive-take"}.timing`,
    );
    if (timing.mode !== "fixed-beat") {
      throw new Error("Interactive-take timing must use mode \"fixed-beat\".");
    }
    this.runtime = runtime;
    const authoredInteractionMode = definition.interaction?.mode
      ?? options.interaction?.mode
      ?? "launcher";
    if (!INTERACTIVE_TAKE_INTERACTIONS.includes(authoredInteractionMode)) {
      throw new Error(
        `interactive-take interaction mode must be one of: ${INTERACTIVE_TAKE_INTERACTIONS.join(", ")}.`,
      );
    }
    this.initialInteractionMode = authoredInteractionMode;
    this.minimumDragPixels = requireFinitePositive(
      definition.interaction?.minimumDragPixels
      ?? definition.interaction?.minimumDragCssPixels
      ?? options.interaction?.minimumDragPixels
      ?? options.interaction?.minimumDragCssPixels
      ?? DEFAULT_MINIMUM_DRAG_PIXELS,
      "interactive-take minimumDragPixels",
    );
    this.fullStrengthDragFraction = requireFinitePositive(
      definition.interaction?.launcher?.fullStrengthDragFraction
      ?? options.interaction?.launcher?.fullStrengthDragFraction
      ?? DEFAULT_FULL_STRENGTH_DRAG_FRACTION,
      "interactive-take launcher.fullStrengthDragFraction",
    );
    if (this.fullStrengthDragFraction > 1) {
      throw new RangeError(
        "interactive-take launcher.fullStrengthDragFraction must be at most one.",
      );
    }
    const authoredTakeSettings = requireObject(
      definition.takeSettings ?? {},
      "interactive-take takeSettings",
    );
    this.initialTakeSettings = mergeSettings({
      beatSeconds: timing.beatSeconds,
      showBoids: Boolean(
        authoredTakeSettings.showBoids
        ?? options.visibleBoids?.show
        ?? options.visibleBoids?.enabled
        ?? false,
      ),
      showPath: authoredTakeSettings.showPath
        ?? options.interaction?.picasso?.showPath
        ?? true,
    }, authoredTakeSettings);
    requireFinitePositive(
      this.initialTakeSettings.beatSeconds,
      "interactive-take takeSettings.beatSeconds",
    );
    if (typeof this.initialTakeSettings.showBoids !== "boolean") {
      throw new TypeError("interactive-take takeSettings.showBoids must be true or false.");
    }
    if (typeof this.initialTakeSettings.showPath !== "boolean") {
      throw new TypeError("interactive-take takeSettings.showPath must be true or false.");
    }
    this.initialStagedSettings = clone(requireObject(
      definition.stagedSettings ?? {},
      "interactive-take stagedSettings",
    ));
    if (!validBoomIntensity(this.initialStagedSettings)) {
      throw new RangeError(
        "interactive-take interaction.boom.intensity must be a positive integer.",
      );
    }
    this.reset({ incrementRevision: false });
  }

  reset({ incrementRevision = true } = {}) {
    this.mode = "frozen";
    this.steps = [];
    this.selectedStepId = null;
    this.previewStepId = null;
    this.previewStepIndex = null;
    this.previewElapsed = 0;
    this.playbackTime = 0;
    this.interactionMode = this.initialInteractionMode;
    this.draftGestures = [];
    this.draftGesture = null;
    this.draftPath = null;
    this.draftBoom = null;
    this.drawing = null;
    this.takeSettings = clone(this.initialTakeSettings);
    this.stagedSettings = clone(this.initialStagedSettings);
    this.nextStepNumber = 1;
    this.revision = incrementRevision ? (this.revision ?? 0) + 1 : 0;
    if (incrementRevision) this.logTransition("new");
  }

  get beatSeconds() {
    return this.takeSettings.beatSeconds;
  }

  update(frame = {}) {
    const dt = frame.compositionDt ?? frame.dt ?? 0;
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError("Interactive-take frame dt must be finite and non-negative.");
    }

    if (this.mode === "playing" && dt > 0) {
      this.previewElapsed = Math.min(this.beatSeconds, this.previewElapsed + dt);
      this.playbackTime = this.previewStepIndex * this.beatSeconds + this.previewElapsed;
      if (this.previewElapsed >= this.beatSeconds - 1e-9) {
        this.previewElapsed = this.beatSeconds;
        this.playbackTime = (this.previewStepIndex + 1) * this.beatSeconds;
        this.mode = "frozen";
        this.logTransition("preview-complete");
      }
    } else if (this.mode === "sealed") {
      const duration = this.animationDuration();
      const coreTime = Number(frame.time);
      if (duration > 0 && Number.isFinite(coreTime)) {
        this.playbackTime = modulo(coreTime, duration);
        this.previewStepIndex = Math.min(
          this.steps.length - 1,
          Math.floor(this.playbackTime / this.beatSeconds),
        );
        this.previewStepId = this.steps[this.previewStepIndex]?.id ?? null;
      }
    }

    return [{
      ...this.basePlanEntry,
      take: this.planState(),
    }];
  }

  input(type, payload = {}) {
    if (type === "pointerdown") return this.pointerDown(payload);
    if (type === "pointermove") return this.pointerMove(payload);
    if (type === "pointerup") return this.pointerUp(payload);
    if (type === "pointercancel") return this.pointerCancel();
    if (type !== "take" || !payload || typeof payload !== "object") return false;

    switch (payload.action) {
      case "play": return this.play();
      case "enough": return this.enough();
      case "edit": return this.edit();
      case "new":
        this.reset();
        return {
          handled: true,
          timelineEffect: TIMELINE_EFFECTS.RETURN_TO_AUTHORING_CORE,
        };
      case "select": return this.select(payload.stepId ?? null);
      case "set-interaction": return this.setInteraction(payload.mode);
      case "reorder": return this.reorder(payload.stepId, payload.toIndex);
      case "duplicate": return this.duplicate(payload.stepId ?? this.selectedStepId);
      case "delete": return this.delete(payload.stepId ?? this.selectedStepId);
      case "stage-settings": return this.stageSettings(payload.settings, payload.scope);
      default: return false;
    }
  }

  pointerDown(payload) {
    if (
      (this.mode !== "frozen" && this.mode !== "drawn")
      || this.interactionMode === "flow"
      || (payload.button !== undefined && payload.button !== 0)
      || (this.interactionMode === "picasso" && this.draftPath !== null)
      || (this.interactionMode === "boom" && this.draftBoom !== null)
    ) {
      return false;
    }
    const point = normalizedPoint(payload, this.runtime);
    if (point === null) return false;
    this.drawing = { start: point, current: point, displayDistance: 0 };
    if (this.interactionMode === "picasso") {
      this.draftPath = {
        points: [{ x: point.normalizedX, y: point.normalizedY }],
      };
    } else if (this.interactionMode === "boom") {
      this.draftBoom = {
        centerX: point.normalizedX,
        centerY: point.normalizedY,
        radius: 0,
      };
    } else {
      this.draftGesture = {
        originX: point.normalizedX,
        originY: point.normalizedY,
        directionX: 0,
        directionY: 0,
      };
    }
    this.mode = "drawing";
    this.logTransition("pointerdown");
    return true;
  }

  pointerMove(payload) {
    if (this.mode !== "drawing" || this.drawing === null) return false;
    const point = normalizedPoint(payload, this.runtime);
    if (point === null) return false;
    if (this.interactionMode === "picasso") {
      this.drawing.displayDistance += Math.hypot(
        point.displayX - this.drawing.current.displayX,
        point.displayY - this.drawing.current.displayY,
      );
      this.drawing.current = point;
      const next = { x: point.normalizedX, y: point.normalizedY };
      const previous = this.draftPath?.points.at(-1);
      if (!previous || next.x !== previous.x || next.y !== previous.y) {
        this.draftPath?.points.push(next);
      }
      return true;
    }
    if (this.interactionMode === "boom") {
      this.drawing.current = point;
      this.draftBoom = {
        centerX: this.drawing.start.normalizedX,
        centerY: this.drawing.start.normalizedY,
        radius: Math.hypot(
          point.logicalX - this.drawing.start.logicalX,
          point.logicalY - this.drawing.start.logicalY,
        ) / this.drawing.start.logicalRadiusScale,
      };
      return true;
    }
    this.drawing.current = point;
    const direction = normalizeDirection(
      point.logicalX - this.drawing.start.logicalX,
      point.logicalY - this.drawing.start.logicalY,
    );
    const dragFraction = Math.hypot(
      point.logicalX - this.drawing.start.logicalX,
      point.logicalY - this.drawing.start.logicalY,
    ) / this.drawing.start.logicalRadiusScale;
    this.draftGesture = {
      originX: this.drawing.start.normalizedX,
      originY: this.drawing.start.normalizedY,
      ...direction,
      endX: point.normalizedX,
      endY: point.normalizedY,
      strength: clamp01(dragFraction / this.fullStrengthDragFraction),
    };
    return true;
  }

  pointerUp(payload) {
    if (this.mode !== "drawing" || this.drawing === null) return false;
    const point = normalizedPoint(payload, this.runtime);
    if (point !== null) this.pointerMove(payload);
    const end = point ?? this.drawing.current;
    const distance = this.interactionMode === "picasso"
      ? this.drawing.displayDistance
      : Math.hypot(
        end.displayX - this.drawing.start.displayX,
        end.displayY - this.drawing.start.displayY,
      );
    this.drawing = null;
    const validDraft = this.interactionMode === "picasso"
      ? validPath(this.draftPath)
      : this.interactionMode === "boom"
        ? validBoom(this.draftBoom)
        : validGesture(this.draftGesture);
    if (distance < this.minimumDragPixels || !validDraft) {
      this.draftGesture = null;
      this.draftPath = null;
      this.draftBoom = null;
      this.mode = this.hasReadyDraft() ? "drawn" : "frozen";
      if (this.interactionMode === "picasso") {
        debug.transition(
          "take action=path-cancel distance=%.3f minimum=%.3f steps=%d revision=%d",
          distance,
          this.minimumDragPixels,
          this.steps.length,
          this.revision,
        );
      } else if (this.interactionMode === "boom") {
        debug.transition(
          "take action=boom-cancel distance=%.3f minimum=%.3f steps=%d revision=%d",
          distance,
          this.minimumDragPixels,
          this.steps.length,
          this.revision,
        );
      } else {
        debug.transition(
          "take action=gesture-cancel distance=%.3f minimum=%.3f steps=%d revision=%d",
          distance,
          this.minimumDragPixels,
          this.steps.length,
          this.revision,
        );
      }
      return true;
    }
    if (this.interactionMode === "launcher") {
      debug.transition(
        "take action=launcher-add strength=%.3f distance=%.3f launches=%d steps=%d revision=%d",
        this.draftGesture.strength,
        distance,
        this.draftGestures.length + 1,
        this.steps.length,
        this.revision,
      );
      this.draftGestures.push(clone(this.draftGesture));
      this.draftGesture = null;
    }
    this.mode = "drawn";
    this.logTransition("pointerup");
    return true;
  }

  pointerCancel() {
    if (this.mode !== "drawing") return false;
    this.drawing = null;
    this.draftGesture = null;
    if (this.interactionMode === "picasso") this.draftPath = null;
    if (this.interactionMode === "boom") this.draftBoom = null;
    this.mode = this.hasReadyDraft() ? "drawn" : "frozen";
    this.logTransition("pointercancel");
    return true;
  }

  play() {
    if (this.mode !== "drawn" && this.mode !== "frozen") return false;
    const selectedIndex = this.stepIndex(this.selectedStepId);
    const previous = selectedIndex >= 0 ? this.steps[selectedIndex] : null;
    if (
      !this.hasReadyDraft()
      && (previous === null || previous.interaction !== this.interactionMode)
    ) return false;

    let index = selectedIndex;
    let step;
    if (selectedIndex >= 0) {
      step = this.committedStep(
        previous.id,
        mergeSettings(previous.settings, this.stagedSettings),
        previous,
      );
      this.steps[selectedIndex] = step;
    } else {
      step = this.committedStep(
        this.createStepId(),
        clone(this.stagedSettings),
      );
      this.steps.push(step);
      index = this.steps.length - 1;
    }

    this.selectedStepId = step.id;
    this.previewStepId = step.id;
    this.previewStepIndex = index;
    this.previewElapsed = 0;
    this.playbackTime = index * this.beatSeconds;
    this.draftGestures = [];
    this.draftGesture = null;
    this.draftPath = null;
    this.draftBoom = null;
    this.drawing = null;
    this.mode = "playing";
    this.revision += 1;
    this.logTransition("play");
    return true;
  }

  enough() {
    if (
      this.mode !== "frozen"
      || this.steps.length === 0
      || this.draftGestures.length > 0
      || this.draftGesture !== null
      || this.draftPath !== null
      || this.draftBoom !== null
    ) {
      return false;
    }
    this.mode = "sealed";
    this.previewElapsed = 0;
    this.playbackTime = 0;
    this.previewStepIndex = 0;
    this.previewStepId = this.steps[0].id;
    this.logTransition("enough");
    return {
      handled: true,
      timelineEffect: TIMELINE_EFFECTS.RESTART_AT_INTRO,
    };
  }

  edit() {
    if (this.mode !== "sealed") return false;
    this.mode = "frozen";
    this.playbackTime = this.steps.length * this.beatSeconds;
    this.previewElapsed = this.beatSeconds;
    this.previewStepIndex = this.steps.length - 1;
    this.previewStepId = this.steps.at(-1)?.id ?? null;
    this.logTransition("edit");
    return {
      handled: true,
      timelineEffect: TIMELINE_EFFECTS.RETURN_TO_AUTHORING_CORE,
    };
  }

  select(stepId) {
    if (this.mode !== "frozen") return false;
    if (stepId !== null && this.stepIndex(stepId) < 0) return false;
    this.selectedStepId = stepId;
    if (stepId !== null) {
      const step = this.steps[this.stepIndex(stepId)];
      this.stagedSettings = clone(step.settings);
      this.interactionMode = step.interaction;
    }
    this.logTransition("select");
    return true;
  }

  setInteraction(mode) {
    if (!INTERACTIVE_TAKE_INTERACTIONS.includes(mode)) return false;
    if (this.mode !== "frozen" && this.mode !== "drawn") return false;
    if (mode === this.interactionMode) return true;
    if (
      this.mode !== "frozen"
      || (this.interactionMode !== "flow" && this.hasReadyDraft())
    ) return false;
    this.interactionMode = mode;
    this.logTransition("set-interaction");
    return true;
  }

  reorder(stepId, toIndex) {
    if (this.mode !== "frozen") return false;
    const fromIndex = this.stepIndex(stepId);
    if (
      fromIndex < 0
      || !Number.isSafeInteger(toIndex)
      || toIndex < 0
      || toIndex >= this.steps.length
    ) return false;
    if (fromIndex === toIndex) return true;
    const [step] = this.steps.splice(fromIndex, 1);
    this.steps.splice(toIndex, 0, step);
    this.syncPreviewIndex();
    this.revision += 1;
    this.logTransition("reorder");
    return true;
  }

  duplicate(stepId) {
    if (this.mode !== "frozen") return false;
    const index = this.stepIndex(stepId);
    if (index < 0) return false;
    const duplicate = {
      ...clone(this.steps[index]),
      id: this.createStepId(),
    };
    this.steps.splice(index + 1, 0, duplicate);
    this.syncPreviewIndex();
    this.selectedStepId = duplicate.id;
    this.stagedSettings = clone(duplicate.settings);
    this.interactionMode = duplicate.interaction;
    this.revision += 1;
    this.logTransition("duplicate");
    return true;
  }

  delete(stepId) {
    if (this.mode !== "frozen") return false;
    const index = this.stepIndex(stepId);
    if (index < 0) return false;
    this.steps.splice(index, 1);
    const next = this.steps[Math.min(index, this.steps.length - 1)] ?? null;
    this.selectedStepId = next?.id ?? null;
    if (next) {
      this.stagedSettings = clone(next.settings);
      this.interactionMode = next.interaction;
    }
    this.previewStepId = null;
    this.previewStepIndex = null;
    this.playbackTime = Math.min(
      this.playbackTime,
      this.steps.length * this.beatSeconds,
    );
    this.revision += 1;
    this.logTransition("delete");
    return true;
  }

  stageSettings(settings, scope = "step") {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false;
    if (scope !== undefined && scope !== "step" && scope !== "take") return false;

    const stepSettings = clone(settings);
    if (!validBoomIntensity(stepSettings)) {
      throw new RangeError(
        "interactive-take interaction.boom.intensity must be a positive integer.",
      );
    }
    const immediate = {};
    for (const key of ["showBoids", "showPath", "beatSeconds"]) {
      if (!Object.hasOwn(stepSettings, key)) continue;
      immediate[key] = stepSettings[key];
      delete stepSettings[key];
    }
    if (
      (this.mode === "sealed" || this.mode === "playing")
      && (
        Object.keys(immediate).length === 0
        || Object.hasOwn(immediate, "beatSeconds")
        || Object.keys(stepSettings).length !== 0
      )
    ) return false;
    if (scope === "take") Object.assign(immediate, stepSettings);
    else this.stagedSettings = mergeSettings(this.stagedSettings, stepSettings);

    const previousBeatSeconds = this.beatSeconds;
    if (Object.hasOwn(immediate, "beatSeconds")) {
      requireFinitePositive(immediate.beatSeconds, "interactive-take beatSeconds");
    }
    for (const key of ["showBoids", "showPath"]) {
      if (Object.hasOwn(immediate, key) && typeof immediate[key] !== "boolean") {
        throw new TypeError(`interactive-take ${key} must be true or false.`);
      }
    }
    this.takeSettings = mergeSettings(this.takeSettings, immediate);
    if (this.beatSeconds !== previousBeatSeconds) {
      const heldBeats = previousBeatSeconds > 0
        ? this.playbackTime / previousBeatSeconds
        : 0;
      this.playbackTime = Math.min(this.steps.length, heldBeats) * this.beatSeconds;
      if (this.previewStepIndex !== null) {
        this.previewElapsed = Math.max(
          0,
          this.playbackTime - this.previewStepIndex * this.beatSeconds,
        );
      }
    }
    this.revision += 1;
    this.logTransition("stage-settings");
    return true;
  }

  hasReadyDraft() {
    return this.interactionMode === "flow"
      ? true
      : this.interactionMode === "picasso"
      ? validPath(this.draftPath)
      : this.interactionMode === "boom"
        ? validBoom(this.draftBoom)
        : this.draftGestures.length > 0;
  }

  committedStep(id, settings, previous = null) {
    if (this.interactionMode === "flow") {
      return { id, interaction: "flow", settings: {} };
    }
    if (this.interactionMode === "picasso") {
      return {
        id,
        interaction: "picasso",
        path: clone(this.draftPath ?? previous?.path),
        settings,
      };
    }
    if (this.interactionMode === "boom") {
      return {
        id,
        interaction: "boom",
        boom: clone(this.draftBoom ?? previous?.boom),
        settings,
      };
    }
    return {
      id,
      interaction: "launcher",
      gestures: clone(
        this.draftGestures.length > 0 ? this.draftGestures : previous?.gestures,
      ),
      settings,
    };
  }

  animationDuration() {
    if (this.mode !== "sealed" || this.steps.length === 0) return null;
    return this.steps.length * this.beatSeconds;
  }

  initialTimelineEffect() {
    return this.mode === "sealed"
      ? TIMELINE_EFFECTS.RESTART_AT_INTRO
      : TIMELINE_EFFECTS.RETURN_TO_AUTHORING_CORE;
  }

  timelineSettings() {
    return {
      beatSeconds: this.beatSeconds,
      intro: clone(this.takeSettings.intro ?? {}),
      outro: clone(this.takeSettings.outro ?? {}),
      circleEndpoints: clone(this.takeSettings.circleEndpoints ?? {}),
    };
  }

  seek(time) {
    if (!Number.isFinite(time) || time < 0) return false;
    if (this.mode !== "sealed") {
      return {
        timelineEffect: TIMELINE_EFFECTS.RETURN_TO_AUTHORING_CORE,
      };
    }
    const duration = this.animationDuration();
    this.playbackTime = modulo(time, duration);
    this.previewStepIndex = Math.min(
      this.steps.length - 1,
      Math.floor(this.playbackTime / this.beatSeconds),
    );
    this.previewStepId = this.steps[this.previewStepIndex].id;
    this.previewElapsed = this.playbackTime - this.previewStepIndex * this.beatSeconds;
    debug.timeline(
      "take-seek mode=%s time=%.3f step=%d duration=%.3f",
      this.mode,
      this.playbackTime,
      this.previewStepIndex,
      duration,
    );
    return true;
  }

  snapshotProjectState() {
    return {
      version: PROJECT_STATE_VERSION,
      mode: this.mode,
      steps: clone(this.steps),
      selectedStepId: this.selectedStepId,
      previewStepId: this.previewStepId,
      previewStepIndex: this.previewStepIndex,
      previewElapsed: this.previewElapsed,
      playbackTime: this.playbackTime,
      interactionMode: this.interactionMode,
      draftGestures: clone(this.draftGestures),
      draftGesture: clone(this.draftGesture),
      draftPath: clone(this.draftPath),
      draftBoom: clone(this.draftBoom),
      takeSettings: clone(this.takeSettings),
      stagedSettings: clone(this.stagedSettings),
      nextStepNumber: this.nextStepNumber,
      revision: this.revision,
    };
  }

  restoreProjectState(snapshot) {
    const restored = migrateLegacySnapshot(
      snapshot,
      this.initialTakeSettings.showPath,
    );
    if (!this.validSnapshot(restored)) return false;
    this.mode = restored.mode;
    this.steps = clone(restored.steps);
    this.selectedStepId = restored.selectedStepId;
    this.previewStepId = restored.previewStepId;
    this.previewStepIndex = restored.previewStepIndex;
    this.previewElapsed = restored.previewElapsed;
    this.playbackTime = restored.playbackTime;
    this.interactionMode = restored.interactionMode;
    this.draftGestures = clone(restored.draftGestures);
    this.draftGesture = clone(restored.draftGesture);
    this.draftPath = clone(restored.draftPath);
    this.draftBoom = clone(restored.draftBoom);
    this.drawing = null;
    this.takeSettings = clone(restored.takeSettings);
    this.stagedSettings = clone(restored.stagedSettings);
    this.nextStepNumber = restored.nextStepNumber;
    this.revision = restored.revision;
    this.logTransition("restore");
    return true;
  }

  inspect() {
    return this.planState();
  }

  planState() {
    return {
      version: PROJECT_STATE_VERSION,
      mode: this.mode,
      steps: clone(this.steps),
      selectedStepId: this.selectedStepId,
      previewStepId: this.previewStepId,
      previewStepIndex: this.previewStepIndex,
      playbackTime: this.playbackTime,
      beatSeconds: this.beatSeconds,
      revision: this.revision,
      interactionMode: this.interactionMode,
      takeSettings: clone(this.takeSettings),
      stagedSettings: clone(this.stagedSettings),
      draftGestures: clone(this.draftGestures),
      draftGesture: clone(this.draftGesture),
      draftPath: clone(this.draftPath),
      draftBoom: clone(this.draftBoom),
    };
  }

  validSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
    if (snapshot.version !== PROJECT_STATE_VERSION) return false;
    if (!INTERACTIVE_TAKE_MODES.includes(snapshot.mode)) return false;
    if (!Array.isArray(snapshot.steps) || !snapshot.steps.every(validStep)) return false;
    if (new Set(snapshot.steps.map(step => step.id)).size !== snapshot.steps.length) return false;
    const ids = new Set(snapshot.steps.map(step => step.id));
    if (snapshot.selectedStepId !== null && !ids.has(snapshot.selectedStepId)) return false;
    if (snapshot.previewStepId !== null && !ids.has(snapshot.previewStepId)) return false;
    if (
      snapshot.previewStepIndex !== null
      && (
        !Number.isSafeInteger(snapshot.previewStepIndex)
        || snapshot.previewStepIndex < 0
        || snapshot.previewStepIndex >= snapshot.steps.length
      )
    ) return false;
    if (!Number.isFinite(snapshot.previewElapsed) || snapshot.previewElapsed < 0) return false;
    if (!Number.isFinite(snapshot.playbackTime) || snapshot.playbackTime < 0) return false;
    if (!INTERACTIVE_TAKE_INTERACTIONS.includes(snapshot.interactionMode)) return false;
    if (!Array.isArray(snapshot.draftGestures) || !snapshot.draftGestures.every(validGesture)) {
      return false;
    }
    if (snapshot.draftGesture !== null && !validGesture(snapshot.draftGesture)) return false;
    if (snapshot.draftPath !== null && !validPath(snapshot.draftPath)) return false;
    if (snapshot.draftBoom !== null && !validBoom(snapshot.draftBoom)) return false;
    if (
      !snapshot.takeSettings
      || typeof snapshot.takeSettings !== "object"
      || Array.isArray(snapshot.takeSettings)
      || !Number.isFinite(snapshot.takeSettings.beatSeconds)
      || snapshot.takeSettings.beatSeconds <= 0
      || typeof snapshot.takeSettings.showBoids !== "boolean"
      || typeof snapshot.takeSettings.showPath !== "boolean"
    ) return false;
    if (
      !snapshot.stagedSettings
      || typeof snapshot.stagedSettings !== "object"
      || Array.isArray(snapshot.stagedSettings)
      || !validBoomIntensity(snapshot.stagedSettings)
    ) return false;
    if (!Number.isSafeInteger(snapshot.nextStepNumber) || snapshot.nextStepNumber <= 0) {
      return false;
    }
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) return false;
    if (snapshot.mode === "sealed" && snapshot.steps.length === 0) return false;
    if (snapshot.mode === "drawing") return false;
    if (snapshot.mode === "drawn") {
      if (snapshot.interactionMode === "launcher" && snapshot.draftGestures.length === 0) {
        return false;
      }
      if (snapshot.interactionMode === "picasso" && snapshot.draftPath === null) return false;
      if (snapshot.interactionMode === "boom" && snapshot.draftBoom === null) return false;
      if (snapshot.interactionMode === "flow") return false;
    }
    if (snapshot.mode !== "drawn" && snapshot.draftGestures.length > 0) return false;
    if (snapshot.mode !== "drawn" && snapshot.draftPath !== null) return false;
    if (snapshot.mode !== "drawn" && snapshot.draftBoom !== null) return false;
    if (snapshot.interactionMode === "launcher" && snapshot.draftPath !== null) return false;
    if (snapshot.interactionMode === "launcher" && snapshot.draftBoom !== null) return false;
    if (snapshot.interactionMode === "picasso" && snapshot.draftGestures.length > 0) return false;
    if (snapshot.interactionMode === "picasso" && snapshot.draftBoom !== null) return false;
    if (
      snapshot.interactionMode === "boom"
      && (snapshot.draftGestures.length > 0 || snapshot.draftPath !== null)
    ) return false;
    if (
      snapshot.interactionMode === "flow"
      && (
        snapshot.draftGestures.length > 0
        || snapshot.draftPath !== null
        || snapshot.draftBoom !== null
      )
    ) return false;
    if (snapshot.draftGesture !== null) return false;
    if (
      snapshot.previewStepIndex !== null
      && snapshot.steps[snapshot.previewStepIndex]?.id !== snapshot.previewStepId
    ) return false;
    return true;
  }

  createStepId() {
    let id;
    do {
      id = `step-${this.nextStepNumber}`;
      this.nextStepNumber += 1;
    } while (this.stepIndex(id) >= 0);
    return id;
  }

  stepIndex(stepId) {
    return this.steps.findIndex(step => step.id === stepId);
  }

  syncPreviewIndex() {
    const index = this.stepIndex(this.previewStepId);
    this.previewStepIndex = index < 0 ? null : index;
    if (index < 0) this.previewStepId = null;
  }

  logTransition(action) {
    debug.transition(
      "take action=%s mode=%s steps=%d selected=%s preview=%s revision=%d",
      action,
      this.mode,
      this.steps.length,
      this.selectedStepId ?? "-",
      this.previewStepId ?? "-",
      this.revision,
    );
  }
}
