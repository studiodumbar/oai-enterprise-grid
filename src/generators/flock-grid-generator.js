import { CircleGrid } from "../grid/circle-grid.js";
import { Flock } from "./flock.js";
import { FlockFieldSource } from "../fields/flock-field-source.js";
import { TypeField } from "../fields/type-field.js";
import { TypeMaskFieldSource } from "../fields/type-mask-field-source.js";
import { nearestEquivalentAxisRadians } from "./flock-axis.js";

function settingsGroup(settings, name, owner) {
  const group = settings[name];
  if (!group || typeof group !== "object") {
    throw new Error(`${owner} refers to missing SETTINGS.${name}.`);
  }
  return group;
}

export { nearestEquivalentAxisRadians };

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
    this.flockAxisRadians = 0;
    this.hasFlockAxis = false;
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
  }

  createCellTransition(transitionDefinition) {
    if (!transitionDefinition || typeof transitionDefinition.type !== "string") {
      throw new Error(
        `Generator "${this.name}" needs a cellTransition { type, options } definition.`,
      );
    }
    const options = typeof transitionDefinition.options === "string"
      ? settingsGroup(
        this.settings.cellTransitions,
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
    const nextFlockAxis = this.flock.travelAxisRadians();
    if (Number.isFinite(nextFlockAxis)) {
      this.flockAxisRadians = this.hasFlockAxis
        ? nearestEquivalentAxisRadians(nextFlockAxis, this.flockAxisRadians)
        : nextFlockAxis;
      this.hasFlockAxis = true;
    }
    this.grid.update(this.fieldSources, frame.dt, {
      ...frame,
      motionAxisRadians: this.flockAxisRadians,
    });
  }

  draw(frame, planEntry, context = this.runtime.context()) {
    const pulse = this.flock.pulseStrength();
    const isDotHidden = this.typographyOptions.textLockup === true
      ? (x, y, radius) => this.typeField.overlapsText(x, y, radius, pulse)
      : undefined;
    this.flock.draw(context, isDotHidden);
    this.grid.draw(context, isDotHidden, { guides: !frame?.exporting });
    this.typeField.draw(context, this.grid.textColor(), pulse);
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
      flockAxisRadians: this.flockAxisRadians,
      textLockup: this.typographyOptions.textLockup === true,
      grid: this.grid.inspect(),
    };
  }

  dispose() {
    this.grid.dispose();
    this.typeField.dispose();
  }
}
