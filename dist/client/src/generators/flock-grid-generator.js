import { CircleGrid } from "../grid/circle-grid.js";
import { Flock } from "./flock.js";
import { FlockFieldSource } from "../fields/flock-field-source.js";
import { TypeField } from "../fields/type-field.js";
import { TypeMaskFieldSource } from "../fields/type-mask-field-source.js";
import { NativeCircleEndpointTransition } from "../compositions/circle-endpoints.js";
import { createSceneTransitionModeRegistry } from "../scene-transitions/index.js";

function settingsGroup(settings, name, owner) {
  const group = settings[name];
  if (!group || typeof group !== "object") {
    throw new Error(`${owner} refers to missing SETTINGS.${name}.`);
  }
  return group;
}

// Adapter for today's complete visual system. The composition layer only sees
// the generic generator lifecycle; flock, typography, field mixing, grid, and
// draw order remain encapsulated here.
export class FlockGridGenerator {
  constructor({
    name,
    definition,
    settings,
    runtime,
    cellTransitionTypes,
    palettes,
    shapeRenderer,
    sceneTransitionTypes,
  }) {
    this.name = name;
    this.definition = definition;
    this.runtime = runtime;
    this.settings = settings;
    this.cellTransitionTypes = cellTransitionTypes;
    this.active = false;

    const gridOptions = settingsGroup(
      settings,
      definition.gridSettings,
      `Generator "${name}"`,
    );
    const typographyOptions = settingsGroup(
      settings,
      definition.typographySettings,
      `Generator "${name}"`,
    );
    const flockOptions = settingsGroup(
      settings,
      definition.flockSettings,
      `Generator "${name}"`,
    );
    if (
      typographyOptions.textLockup !== undefined
      && typeof typographyOptions.textLockup !== "boolean"
    ) {
      throw new TypeError("typography textLockup must be true or false.");
    }
    this.typographyOptions = typographyOptions;
    const viewport = runtime.viewport();
    this.typeField = new TypeField(runtime.p5, typographyOptions, viewport);
    this.flock = new Flock(flockOptions);
    this.fieldSources = [
      new FlockFieldSource(this.flock),
      new TypeMaskFieldSource(this.typeField, typographyOptions),
    ];
    this.cellTransition = this.createCellTransition(definition.cellTransition);
    this.activeCellTransitionKey = this.transitionKey(definition.cellTransition);
    this.grid = new CircleGrid(
      gridOptions,
      palettes,
      this.cellTransition,
      shapeRenderer,
      viewport,
    );
    this.circleEndpoint = new NativeCircleEndpointTransition({
      settings: settings?.composition,
      intro: gridOptions.intro,
      outro: gridOptions.outro,
      modeRegistry: sceneTransitionTypes ?? createSceneTransitionModeRegistry(),
    });
    this.circleEndpointActive = false;
  }

  createCellTransition(transitionDefinition) {
    if (!transitionDefinition || typeof transitionDefinition.type !== "string") {
      throw new Error(
        `Generator "${this.name}" needs a cellTransition { type, options } definition.`,
      );
    }
    const configuredModes = this.settings.cellTransitions?.modes
      ?? this.settings.cellTransitions;
    const options = typeof transitionDefinition.options === "string"
      ? settingsGroup(
        configuredModes,
        transitionDefinition.options,
        `Cell transition "${transitionDefinition.type}"`,
      )
      : transitionDefinition.options ?? {};
    const transition = this.cellTransitionTypes.create(transitionDefinition.type, options);
    if (!transition || typeof transition.updateCell !== "function") {
      throw new TypeError(
        `Cell transition "${transitionDefinition.type}" must provide updateCell().`,
      );
    }
    return transition;
  }

  transitionKey(transitionDefinition) {
    const options = transitionDefinition.options;
    const optionKey = typeof options === "string" ? options : JSON.stringify(options ?? {});
    return `${transitionDefinition.type}:${optionKey}`;
  }

  ensureCellTransition(
    transitionDefinition = this.definition.cellTransition,
    frame,
  ) {
    const key = this.transitionKey(transitionDefinition);
    if (key === this.activeCellTransitionKey) return;

    const nextTransition = this.createCellTransition(transitionDefinition);
    if (this.active) this.cellTransition.exit?.(frame);
    this.grid?.setCellTransition(nextTransition);
    this.cellTransition = nextTransition;
    this.activeCellTransitionKey = key;
    if (this.active) this.cellTransition.enter?.(frame);
    return true;
  }

  enter(frame, planEntries = []) {
    this.ensureCellTransition(
      planEntries[0]?.cellTransition ?? this.definition.cellTransition,
      frame,
    );
    this.active = true;
    this.circleEndpoint.reset();
    this.circleEndpointActive = false;
    this.cellTransition.enter?.(frame);
  }

  exit(frame) {
    this.cellTransition.exit?.(frame);
    this.active = false;
  }

  update(frame, planEntries = []) {
    this.ensureCellTransition(
      planEntries[0]?.cellTransition ?? this.definition.cellTransition,
      frame,
    );
    const { width, height } = frame.viewport;
    this.flock.update(frame.dt, width, height, this.typeField, frame.pointer);
    this.grid.update(this.fieldSources, frame.dt, frame);
  }

  draw(frame, planEntry, context = this.runtime.context()) {
    const pulse = this.flock.pulseStrength();
    const isDotHidden = this.typographyOptions.textLockup === true
      ? (x, y, radius) => this.typeField.overlapsText(x, y, radius, pulse)
      : undefined;
    this.circleEndpointActive = this.circleEndpoint?.prepare?.(
      frame?.compositionEndpoint,
      this.grid.transitionItems?.() ?? [],
      this.grid.layout,
    ) ?? false;
    if (!this.circleEndpointActive) this.flock.draw(context, isDotHidden);
    this.grid.draw(context, isDotHidden, {
      guides: !frame?.exporting,
      glyphPresentation: this.circleEndpointActive
        ? item => this.circleEndpoint.presentationsFor(item.id)
        : undefined,
    });
    if (!this.circleEndpointActive) {
      this.typeField.draw(context, this.grid.textColor(), pulse);
    }
  }

  contentBounds() {
    const viewport = this.runtime.viewport();
    if (
      this.flock.options.showBoids
      || this.typographyOptions.text
    ) {
      return { x: 0, y: 0, width: viewport.width, height: viewport.height };
    }
    const layout = this.grid.layout;
    return {
      x: layout.offsetX,
      y: layout.offsetY,
      width: layout.patternWidth,
      height: layout.patternHeight,
    };
  }

  animationDuration() {
    return null;
  }

  endpointAutoDuration(direction) {
    const transition = direction === "end"
      ? (this.grid.options.outro ?? this.grid.options.intro)
      : this.grid.options.intro;
    return Number.isFinite(transition?.durationSeconds)
      ? transition.durationSeconds
      : 1;
  }

  resize(viewport) {
    if (
      viewport.width === this.typeField.width
      && viewport.height === this.typeField.height
    ) return;
    this.typeField.resize(viewport);
    this.flock.repositionUnborn(this.typeField);
    this.grid.resize(viewport);
  }

  signal(name) {
    return name === "pulse" ? this.flock.pulseStrength() : 0;
  }

  inspect() {
    let activeBoids = 0;
    for (const boid of this.flock.boids) {
      if (boid.active) activeBoids += 1;
    }
    return {
      type: "flock-grid",
      activeBoids,
      pulse: this.flock.pulseStrength(),
      textLockup: this.typographyOptions.textLockup === true,
      grid: this.grid.inspect(),
    };
  }

  dispose() {
    this.circleEndpoint.reset();
    this.grid.dispose();
    this.typeField.dispose();
  }
}
