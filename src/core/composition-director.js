import {
  animationDurationWithCircleEndpoints,
  circleEndpointTimelineAt,
} from "../compositions/circle-endpoints.js";
import { createPhaseOverlay } from "../transitions/phase-overlay.js";
import { debug } from "../debug/index.js";
import { resolveCompositionEndpointSettings } from "../composition-endpoints/index.js";
import {
  isAutomaticDurationSetting,
  resolveAutomaticDuration,
} from "./automatic-duration.js";

const GENERATOR_LIFECYCLE = [
  "enter",
  "exit",
  "update",
  "draw",
  "resize",
  "input",
  "dispose",
];

const INITIAL_ENDPOINT_DURATION_SECONDS = 1;

function compositionGeneratorIds(definition) {
  const ids = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.use === "string") ids.push(value.use);
    if (value.steps !== undefined) visit(value.steps);
    if (value.layers !== undefined) visit(value.layers);
  };
  visit(definition?.steps ?? definition?.layers);
  return ids;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object or Map.`);
  }
  return value;
}

function toDefinitionMap(value, label) {
  if (value instanceof Map) return new Map(value);
  requireObject(value, label);
  return new Map(Object.entries(value));
}

function requireRegistry(value, label) {
  if (
    !value
    || typeof value.create !== "function"
    || typeof value.has !== "function"
    || typeof value.list !== "function"
  ) {
    throw new TypeError(`${label} must provide create(), has(), and list().`);
  }
  return value;
}

function requireName(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function availableMessage(values) {
  return values.length > 0 ? values.join(", ") : "<none>";
}

/**
 * Owns composition-rule selection and the generator instances used by its
 * render plans. The director has no p5 dependency; the host supplies the live
 * 2D context through `runtime.context()`.
 */
export class CompositionDirector {
  constructor({
    settings,
    generatorDefinitions,
    compositionDefinitions,
    generatorTypes,
    compositionRules,
    sceneTransitionTypes = null,
    palettes = null,
    runtime,
  }) {
    this.settings = requireObject(settings, "Settings");
    this.generatorDefinitions = toDefinitionMap(generatorDefinitions, "Generator definitions");
    this.compositionDefinitions = toDefinitionMap(
      compositionDefinitions,
      "Composition definitions",
    );
    this.generatorTypes = requireRegistry(generatorTypes, "Generator type registry");
    this.compositionRules = requireRegistry(compositionRules, "Composition rule registry");
    // Optional: without it an intro/outro mode still places glyphs, it just
    // cannot draw content of its own. See src/transitions/phase-overlay.js.
    this.sceneTransitionTypes = sceneTransitionTypes;
    // The palette table an overlay resolves its colors against. Generators get
    // theirs from the catalog; the overlay is not a generator.
    this.palettes = palettes;
    this.runtime = requireObject(runtime, "Runtime");
    if (typeof this.runtime.context !== "function") {
      throw new TypeError("Runtime must provide context().");
    }
    this.compositionEndpoints = resolveCompositionEndpointSettings(
      this.settings.composition ?? {},
    );
    this.circleEndpoints = this.compositionEndpoints.timeline;
    this.endpointDurations = Object.freeze({
      start: INITIAL_ENDPOINT_DURATION_SECONDS,
      end: INITIAL_ENDPOINT_DURATION_SECONDS,
    });
    this.endpointElapsed = 0;
    this.endpointCoreElapsed = 0;
    this.endpointState = circleEndpointTimelineAt(
      0,
      null,
      this.circleEndpoints,
      this.endpointDurations,
    );

    this.generators = new Map();
    this.activeGeneratorIds = new Set();
    this.currentCompositionName = null;
    this.currentRule = null;
    this.phaseOverlay = null;
    this.renderPlan = [];
    this.viewport = null;
    this.lastFrame = undefined;
    this.disposed = false;
  }

  use(name) {
    this.assertUsable();
    requireName(name, "Composition name");
    if (name === this.currentCompositionName) return this;

    const definition = this.compositionDefinitions.get(name);
    if (!definition) {
      throw new Error(
        `Unknown composition "${name}". Available compositions: ${availableMessage(this.list())}.`,
      );
    }
    requireObject(definition, `Composition definition "${name}"`);

    const ruleType = requireName(definition.rule, `Rule for composition "${name}"`);
    if (!this.compositionRules.has(ruleType)) {
      throw new Error(
        `Composition "${name}" references unknown rule "${ruleType}". `
        + `Available rules: ${availableMessage(this.compositionRules.list())}.`,
      );
    }

    // Create first so a bad new definition cannot tear down a working one.
    const nextRule = this.compositionRules.create(
      ruleType,
      this.creationContext(name, definition),
    );
    if (!nextRule || typeof nextRule.update !== "function") {
      throw new TypeError(`Composition rule "${ruleType}" must return an object with update().`);
    }
    const nextPhaseSettings = this.phaseSettingsGroup(name);
    const authoredEndpoints = nextPhaseSettings?.circleEndpoints ?? {};
    const legacyCompositionSettings = this.settings.composition ?? {};
    const endpointOverrides = this.isLegacyFlockComposition(definition)
      ? {
        ...authoredEndpoints,
        start: {
          ...(authoredEndpoints.start ?? {}),
          enabled: legacyCompositionSettings.startWithCircle,
          durationSeconds: legacyCompositionSettings.startWithCircleDurationSeconds,
          mode: "native",
        },
        end: {
          ...(authoredEndpoints.end ?? {}),
          enabled: legacyCompositionSettings.endWithCircle,
          durationSeconds: legacyCompositionSettings.endWithCircleDurationSeconds,
          mode: "native",
        },
      }
      : authoredEndpoints;
    const nextCompositionEndpoints = resolveCompositionEndpointSettings(
      this.settings.composition ?? {},
      endpointOverrides,
    );
    const nextEndpointDurations = this.resolveEndpointDurations(
      name,
      definition,
      nextCompositionEndpoints.timeline,
    );

    for (const id of this.activeGeneratorIds) {
      const entries = this.renderPlan.filter(entry => entry.use === id);
      this.callGenerator(id, "exit", this.lastFrame, entries);
    }
    this.activeGeneratorIds.clear();
    this.renderPlan = [];

    if (this.currentRule && typeof this.currentRule.dispose === "function") {
      this.currentRule.dispose();
    }

    this.currentCompositionName = name;
    this.currentRule = nextRule;
    this.compositionEndpoints = nextCompositionEndpoints;
    this.circleEndpoints = nextCompositionEndpoints.timeline;
    this.endpointDurations = nextEndpointDurations;
    this.endpointElapsed = 0;
    this.endpointCoreElapsed = 0;
    this.endpointState = circleEndpointTimelineAt(
      0,
      null,
      this.circleEndpoints,
      this.endpointDurations,
    );
    debug.config(
      "endpoints composition=%s start=%s end=%s flockLegacy=%s",
      name,
      nextCompositionEndpoints.start.mode,
      nextCompositionEndpoints.end.mode,
      this.isLegacyFlockComposition(definition) ? "yes" : "no",
    );
    const timing = nextPhaseSettings?.timing;
    if (timing) {
      debug.config(
        "timing composition=%s body=%.3f beats=%d beat=%.3f intro=%.3f outro=%.3f start=%.3f end=%.3f",
        name,
        timing.bodyDurationSeconds,
        timing.beatCount,
        timing.beatSeconds,
        nextPhaseSettings.intro.durationSeconds,
        nextPhaseSettings.outro.durationSeconds,
        this.endpointDurations.start,
        this.endpointDurations.end,
      );
    }
    this.buildPhaseOverlay();
    return this;
  }

  /**
   * The intro/outro settings of the named composition. A definition with
   * several generators takes the first one that authors a phase, which is the
   * same group its endpoint transitions read. Read from the definition rather
   * than the live plan, because a rule has not chosen one yet at use() time.
   */
  phaseSettingsGroup(name) {
    const definition = this.compositionDefinitions.get(name);
    for (const id of compositionGeneratorIds(definition)) {
      const generatorDefinition = this.generatorDefinitions.get(id);
      if (!generatorDefinition) continue;
      const key = this.settingsKeyForDefinition(id, generatorDefinition);
      const group = key ? this.settings[key] : undefined;
      if (group?.intro !== undefined) return group;
    }
    return undefined;
  }

  isLegacyFlockComposition(definition) {
    const ids = compositionGeneratorIds(definition);
    return ids.length > 0 && ids.every(
      id => this.generatorDefinitions.get(id)?.type === "flock-grid",
    );
  }

  buildPhaseOverlay(name = this.currentCompositionName) {
    const group = this.phaseSettingsGroup(name);
    this.phaseOverlay = group === undefined
      ? null
      : createPhaseOverlay({
        intro: group.intro,
        outro: group.outro,
        modeRegistry: this.sceneTransitionTypes,
        longSideCells: group.longSideCells ?? null,
        palette: group.palette ?? null,
        palettes: this.palettes,
        background: this.settings.canvas?.background ?? null,
      });
    if (this.phaseOverlay && this.viewport) this.phaseOverlay.resize(this.viewport);
  }

  phaseOverlayEndpoint(endpoint) {
    const direction = endpoint?.phase === "start"
      ? "start"
      : (endpoint?.phase === "end" ? "end" : null);
    if (direction === null) return endpoint;
    // A custom endpoint draws the complete phase through the generator port.
    // Giving the same phase to the overlay would put text over that endpoint.
    return this.compositionEndpoints[direction]?.mode === "native"
      ? endpoint
      : null;
  }

  update(frame) {
    this.assertUsable();
    if (!this.currentRule) return [];

    const outerDt = frame?.compositionDt ?? frame?.dt ?? 0;
    if (!Number.isFinite(outerDt) || outerDt < 0) {
      throw new RangeError("Composition frame dt must be finite and non-negative.");
    }
    this.endpointElapsed += outerDt;
    const endpointState = circleEndpointTimelineAt(
      this.endpointElapsed,
      this.coreAnimationDuration(),
      this.circleEndpoints,
      this.endpointDurations,
    );
    const coreDt = Math.max(0, endpointState.coreTime - this.endpointCoreElapsed);
    // The core clock is paused during an endpoint by zeroing this delta rather
    // than by a flag, so a nonzero coreDt outside the core phase means two
    // layers are both advancing the cycle. Worth seeing.
    debug.timeline(
      "phase=%s cycle=%d duration=%s paused=%s",
      endpointState.phase,
      endpointState.cycleIndex,
      endpointState.durationSeconds === null
        ? "-"
        : endpointState.durationSeconds.toFixed(3),
      endpointState.phase !== "core" && coreDt === 0 ? "yes" : "no",
    );
    this.endpointCoreElapsed = endpointState.coreTime;
    this.endpointState = endpointState;
    const mappedFrame = this.frameForCore(frame, endpointState, coreDt);
    this.lastFrame = mappedFrame;

    const nextPlan = this.validatePlan(this.currentRule.update(mappedFrame));
    const nextIds = new Set(nextPlan.map(entry => entry.use));

    // Instantiate every entering generator before changing the active set. A
    // factory error therefore leaves the previous active set intact.
    for (const id of nextIds) {
      if (!this.activeGeneratorIds.has(id)) this.generator(id);
    }

    for (const id of this.activeGeneratorIds) {
      if (!nextIds.has(id)) {
        const entries = this.renderPlan.filter(entry => entry.use === id);
        debug.plan("exit=%s", id);
        this.callGenerator(id, "exit", mappedFrame, entries);
      }
    }
    for (const id of nextIds) {
      if (!this.activeGeneratorIds.has(id)) {
        const entries = nextPlan.filter(entry => entry.use === id);
        debug.plan("enter=%s", id);
        this.callGenerator(id, "enter", mappedFrame, entries);
      }
    }

    debug.plan(
      "render=[%s]",
      nextPlan.map(entry => `${entry.use}@${(entry.opacity ?? 1).toFixed(2)}`).join(" "),
    );

    this.activeGeneratorIds = nextIds;
    this.renderPlan = nextPlan;

    // A generator may occur more than once in a render plan, but simulation is
    // advanced exactly once per frame.
    for (const id of nextIds) {
      const entries = nextPlan.filter(entry => entry.use === id);
      this.callGenerator(id, "update", mappedFrame, entries);
    }
    return this.renderPlan.slice();
  }

  draw(frame, context = this.runtime.context()) {
    this.assertUsable();
    const drawable = this.renderPlan.filter(
      entry => typeof this.generator(entry.use).draw === "function",
    );
    if (drawable.length === 0 && this.phaseOverlay === null) return;

    if (!context || typeof context.save !== "function" || typeof context.restore !== "function") {
      throw new TypeError("runtime.context() must return a context with save() and restore().");
    }

    const drawFrame = this.frameForDraw(frame);
    if (drawable.length > 0) this.drawPlan(drawable, drawFrame, context);
    // Native endpoints and overlays can share a phase. A custom endpoint owns
    // its phase exclusively because it supplies the complete rendered frame.
    this.phaseOverlay?.draw(
      this.phaseOverlayEndpoint(drawFrame.compositionEndpoint),
      context,
    );
  }

  drawPlan(drawable, frame, context) {
    for (const entry of drawable) {
      const generator = this.generator(entry.use);
      context.save();
      try {
        const inheritedAlpha = Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1;
        context.globalAlpha = inheritedAlpha * (entry.opacity ?? 1);
        generator.draw(frame, entry, context);
      } finally {
        context.restore();
      }
    }
  }

  frameForCore(frame, endpointState, coreDt) {
    const endpoint = endpointState.phase === "start" || endpointState.phase === "end"
      ? { ...endpointState }
      : null;
    return {
      ...frame,
      dt: Math.min(coreDt, Number.isFinite(frame?.dt) ? frame.dt : coreDt),
      compositionDt: coreDt,
      endpointDt: frame?.compositionDt ?? frame?.dt ?? 0,
      time: endpointState.coreTime,
      compositionEndpoint: endpoint,
    };
  }

  frameForDraw(frame) {
    let endpointState = this.endpointState;
    const isLastExportFrame = frame?.exporting === true
      && Number.isSafeInteger(frame.exportFrameIndex)
      && Number.isSafeInteger(frame.exportFrameCount)
      && frame.exportFrameCount > 0
      && frame.exportFrameIndex === frame.exportFrameCount - 1;
    if (isLastExportFrame && this.circleEndpoints.endWithCircle) {
      endpointState = {
        ...endpointState,
        phase: "end",
        progress: 1,
        durationSeconds: this.endpointDurations.end,
      };
    }
    return this.frameForCore(frame, endpointState, 0);
  }

  input(type, payload = {}) {
    this.assertUsable();
    requireName(type, "Input type");
    let handled = false;
    for (const id of this.activeGeneratorIds) {
      const generator = this.generator(id);
      if (typeof generator.input === "function") {
        handled = Boolean(generator.input(type, payload)) || handled;
      }
    }
    return handled;
  }

  resize(viewport) {
    this.assertUsable();
    requireObject(viewport, "Viewport");
    this.viewport = viewport;
    for (const generator of this.generators.values()) {
      if (typeof generator.resize === "function") generator.resize(viewport);
    }
    this.phaseOverlay?.resize(viewport);
    return this;
  }

  dispose() {
    if (this.disposed) return;

    let firstError = null;
    const safely = callback => {
      try {
        callback();
      } catch (error) {
        if (!firstError) firstError = error;
      }
    };

    for (const id of this.activeGeneratorIds) {
      const entries = this.renderPlan.filter(entry => entry.use === id);
      safely(() => this.callGenerator(id, "exit", this.lastFrame, entries));
    }
    this.activeGeneratorIds.clear();

    if (this.currentRule && typeof this.currentRule.dispose === "function") {
      safely(() => this.currentRule.dispose());
    }
    for (const generator of this.generators.values()) {
      if (typeof generator.dispose === "function") safely(() => generator.dispose());
    }

    this.generators.clear();
    this.renderPlan = [];
    this.currentRule = null;
    this.currentCompositionName = null;
    this.disposed = true;
    if (firstError) throw firstError;
  }

  inspect() {
    this.assertUsable();
    const generators = {};
    for (const id of new Set(this.renderPlan.map(entry => entry.use))) {
      const definition = this.generatorDefinitions.get(id);
      const state = this.generator(id).inspect?.() ?? {};
      generators[id] = {
        ...state,
        generatorInstanceId: id,
        generatorType: definition.type,
        settingsKey: definition.settingsKey
          ?? (typeof definition.options === "string" ? definition.options : null),
        strategy: definition.strategy ?? state.strategy ?? null,
      };
    }
    return {
      compositionId: this.currentCompositionName,
      renderPlan: this.renderPlan.map(entry => ({ ...entry })),
      generators,
      phaseOverlay: this.phaseOverlay?.inspect() ?? null,
      // The endpoint state drives how the intro and outro render and was
      // previously computed every frame and readable by nobody.
      timeline: {
        ...this.endpointState,
        outerElapsed: this.endpointElapsed,
        coreElapsed: this.endpointCoreElapsed,
        coreDuration: this.coreAnimationDuration(),
        endpointDurations: { ...this.endpointDurations },
        rule: typeof this.currentRule?.inspect === "function"
          ? this.currentRule.inspect()
          : null,
      },
    };
  }

  contentBounds() {
    this.assertUsable();
    const bounds = [];
    for (const id of this.activeGeneratorIds) {
      const generator = this.generator(id);
      const candidate = typeof generator.contentBounds === "function"
        ? generator.contentBounds()
        : null;
      if (
        candidate
        && Number.isFinite(candidate.x)
        && Number.isFinite(candidate.y)
        && Number.isFinite(candidate.width)
        && Number.isFinite(candidate.height)
        && candidate.width > 0
        && candidate.height > 0
      ) bounds.push(candidate);
    }
    if (bounds.length === 0 && this.viewport) {
      return {
        x: 0,
        y: 0,
        width: this.viewport.width,
        height: this.viewport.height,
      };
    }
    if (bounds.length === 0) return null;
    const left = Math.min(...bounds.map(bound => bound.x));
    const top = Math.min(...bounds.map(bound => bound.y));
    const right = Math.max(...bounds.map(bound => bound.x + bound.width));
    const bottom = Math.max(...bounds.map(bound => bound.y + bound.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  animationDuration() {
    return animationDurationWithCircleEndpoints(
      this.coreAnimationDuration(),
      this.circleEndpoints,
      this.endpointDurations,
    );
  }

  resolveEndpointDurations(compositionName, definition, circleEndpoints) {
    const ids = compositionGeneratorIds(definition);
    const legacyFlock = this.isLegacyFlockComposition(definition);
    const durationFor = (direction) => {
      const configuredDuration = direction === "start"
        ? circleEndpoints.startWithCircleDurationSeconds
        : circleEndpoints.endWithCircleDurationSeconds;
      if (!isAutomaticDurationSetting(configuredDuration)) return configuredDuration;
      if (!legacyFlock) {
        throw new Error(
          `Composition "${compositionName}" left its ${direction} endpoint duration `
          + `as ${JSON.stringify(configuredDuration)}. Add an explicit composition timing `
          + "root so config assembly can resolve it before generator creation.",
        );
      }
      const orderedIds = direction === "start" ? ids : [...ids].reverse();
      for (const id of orderedIds) {
        const generator = this.generator(id);
        if (typeof generator.endpointAutoDuration !== "function") continue;
        const duration = generator.endpointAutoDuration(direction);
        if (Number.isFinite(duration) && duration > 0) {
          return resolveAutomaticDuration(configuredDuration, {
            label: `Composition "${compositionName}" ${direction} endpoint duration`,
            candidates: [{ source: `legacy-flock:${id}`, seconds: duration }],
          }).seconds;
        }
      }
      throw new RangeError(
        `Legacy flock composition "${compositionName}" could not resolve its `
        + `${direction} endpoint duration.`,
      );
    };
    return Object.freeze({ start: durationFor("start"), end: durationFor("end") });
  }

  coreAnimationDuration() {
    this.assertUsable();
    const durations = [];
    for (const id of this.activeGeneratorIds) {
      const generator = this.generator(id);
      const duration = typeof generator.animationDuration === "function"
        ? generator.animationDuration()
        : null;
      if (Number.isFinite(duration) && duration > 0) durations.push(duration);
    }
    return durations.length > 0 ? Math.max(...durations) : null;
  }

  seek(time) {
    this.assertUsable();
    if (!Number.isFinite(time) || time < 0) {
      throw new RangeError("Composition seek time must be finite and non-negative.");
    }
    const endpointState = circleEndpointTimelineAt(
      time,
      this.coreAnimationDuration(),
      this.circleEndpoints,
      this.endpointDurations,
    );
    for (const id of this.activeGeneratorIds) {
      const generator = this.generator(id);
      if (
        typeof generator.seek === "function"
        && generator.seek(endpointState.coreTime) === false
      ) {
        throw new Error(`Generator "${id}" could not seek to the restored time.`);
      }
    }
    this.endpointElapsed = time;
    this.endpointCoreElapsed = endpointState.coreTime;
    this.endpointState = endpointState;
    return this;
  }

  snapshotProjectState() {
    this.assertUsable();
    const generators = {};
    for (const [id, generator] of this.generators) {
      const state = generator.snapshotProjectState?.();
      if (state !== undefined) generators[id] = state;
    }
    return {
      compositionId: this.currentCompositionName,
      generators,
    };
  }

  restoreProjectState(snapshot) {
    this.assertUsable();
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new TypeError("Project state must be an object.");
    }
    if (
      typeof snapshot.compositionId !== "string"
      || !this.compositionDefinitions.has(snapshot.compositionId)
    ) throw new Error("Project state refers to an unknown composition.");
    this.use(snapshot.compositionId);
    const savedGenerators = snapshot.generators;
    if (!savedGenerators || typeof savedGenerators !== "object") return this;
    for (const [id, state] of Object.entries(savedGenerators)) {
      if (!this.generatorDefinitions.has(id)) continue;
      const restore = this.generator(id).restoreProjectState;
      if (typeof restore === "function" && restore.call(this.generator(id), state) === false) {
        throw new Error(`Project state for generator "${id}" is invalid.`);
      }
    }
    return this;
  }

  list() {
    return Array.from(this.compositionDefinitions.keys());
  }

  creationContext(name, definition) {
    let options = {};
    const settingsKey = this.settingsKeyForDefinition(name, definition);
    if (settingsKey !== null) {
      options = this.settings[settingsKey];
      if (!options || typeof options !== "object") {
        throw new Error(
          `Definition "${name}" refers to missing SETTINGS.${settingsKey}.`,
        );
      }
    } else if (definition.options !== undefined) {
      options = requireObject(definition.options, `Options for definition "${name}"`);
    }

    return {
      name,
      definition,
      settingsKey,
      options,
      settings: this.settings,
      runtime: this.runtime,
      director: this,
    };
  }

  settingsKeyForDefinition(name, definition) {
    if (
      definition.settingsKey !== undefined
      && definition.options !== undefined
    ) {
      throw new Error(
        `Definition "${name}" cannot use both settingsKey and options.`,
      );
    }
    const settingsKey = definition.settingsKey !== undefined
      ? requireName(definition.settingsKey, `Settings key for definition "${name}"`)
      : (typeof definition.options === "string" ? definition.options : null);
    return settingsKey === null
      ? null
      : requireName(settingsKey, `Settings key for definition "${name}"`);
  }

  generator(name) {
    const existing = this.generators.get(name);
    if (existing) return existing;

    const definition = this.generatorDefinitions.get(name);
    if (!definition) {
      throw new Error(
        `Unknown generator "${name}". Available generators: `
        + `${availableMessage(Array.from(this.generatorDefinitions.keys()))}.`,
      );
    }
    requireObject(definition, `Generator definition "${name}"`);

    const type = requireName(definition.type, `Type for generator "${name}"`);
    if (!this.generatorTypes.has(type)) {
      throw new Error(
        `Generator "${name}" references unknown type "${type}". `
        + `Available generator types: ${availableMessage(this.generatorTypes.list())}.`,
      );
    }

    const instance = this.generatorTypes.create(type, this.creationContext(name, definition));
    if (!instance || typeof instance !== "object") {
      throw new TypeError(`Generator factory "${type}" must return an object.`);
    }
    for (const method of GENERATOR_LIFECYCLE) {
      if (instance[method] !== undefined && typeof instance[method] !== "function") {
        throw new TypeError(`Generator "${name}" ${method} must be a function when provided.`);
      }
    }

    if (this.viewport && typeof instance.resize === "function") instance.resize(this.viewport);
    this.generators.set(name, instance);
    return instance;
  }

  callGenerator(name, method, ...args) {
    const generator = this.generator(name);
    if (typeof generator[method] === "function") generator[method](...args);
  }

  validatePlan(plan) {
    if (!Array.isArray(plan)) {
      throw new TypeError("Composition rule update() must return a render-plan array.");
    }

    return plan.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new TypeError(`Render-plan entry ${index} must be an object.`);
      }
      requireName(entry.use, `Render-plan entry ${index} use`);
      if (!this.generatorDefinitions.has(entry.use)) {
        throw new Error(
          `Render-plan entry ${index} references unknown generator "${entry.use}". `
          + `Available generators: ${availableMessage(Array.from(this.generatorDefinitions.keys()))}.`,
        );
      }
      if (
        entry.opacity !== undefined
        && (!Number.isFinite(entry.opacity) || entry.opacity < 0 || entry.opacity > 1)
      ) {
        throw new RangeError(`Render-plan entry ${index} opacity must be between 0 and 1.`);
      }
      return { ...entry };
    });
  }

  assertUsable() {
    if (this.disposed) throw new Error("CompositionDirector has been disposed.");
  }
}

export default CompositionDirector;
