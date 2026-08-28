import { Pane } from "../vendor/tweakpane-4.0.5.min.js";
import { debug } from "../debug/index.js";

const TAKE_MODES = new Set([
  "frozen",
  "drawing",
  "drawn",
  "playing",
  "sealed",
]);

const INTERACTION_MODES = new Set(["launcher", "picasso", "boom", "flow"]);
const INTERACTION_OPTIONS = Object.freeze({
  Launcher: "launcher",
  Picasso: "picasso",
  Boom: "boom",
  "Let it flow": "flow",
});

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function firstDefined(...values) {
  return values.find(value => value !== undefined);
}

function labelFor(value) {
  return String(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, character => character.toUpperCase());
}

function optionMap(values) {
  return Object.fromEntries(values.map(value => [labelFor(value), value]));
}

function paletteNames(palettes, fallback) {
  const values = Array.isArray(palettes)
    ? palettes.filter(value => typeof value === "string" && value !== "")
    : Object.keys(objectOrEmpty(palettes));
  if (typeof fallback === "string" && fallback !== "" && !values.includes(fallback)) {
    values.unshift(fallback);
  }
  return values.length > 0 ? values : ["default"];
}

function takeFromInspection(value) {
  const candidates = [value, value?.take, value?.timeline?.rule];
  return candidates.find(candidate => (
    candidate
    && typeof candidate === "object"
    && TAKE_MODES.has(candidate.mode)
    && Array.isArray(candidate.steps)
  )) ?? null;
}

function formatSeconds(value) {
  const precision = value > 0 && value < 10 ? 1 : 0;
  return `${finiteOr(value, 0).toFixed(precision)}s`;
}

function createElement(documentRef, name, className, text = "") {
  const element = documentRef.createElement(name);
  element.className = className;
  element.textContent = text;
  return element;
}

function createSvgElement(documentRef, name, className) {
  const element = documentRef.createElementNS("http://www.w3.org/2000/svg", name);
  element.setAttribute("class", className);
  return element;
}

export function takeInteractionMode(value, fallback = "launcher") {
  return INTERACTION_MODES.has(value) ? value : fallback;
}

export function takeStepInteraction(step) {
  return takeInteractionMode(step?.interaction);
}

export function takeCanPlay(take) {
  if (take?.mode === "drawn") return true;
  if (take?.mode !== "frozen" || !Array.isArray(take.steps)) return false;
  if (takeInteractionMode(take.interactionMode) === "flow") return true;
  const selected = take.steps.find(step => step?.id === take.selectedStepId);
  return Boolean(
    selected
    && takeStepInteraction(selected) === takeInteractionMode(take.interactionMode),
  );
}

export function takeStepPathPoints(step) {
  const points = Array.isArray(step?.path?.points) ? step.path.points : [];
  return points.filter(point => (
    point
    && typeof point === "object"
    && !Array.isArray(point)
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
  ));
}

export function takeStepGestures(step) {
  const gestures = Array.isArray(step?.gestures)
    ? step.gestures.filter(gesture => (
      gesture && typeof gesture === "object" && !Array.isArray(gesture)
    ))
    : [];
  if (gestures.length > 0) return gestures;
  const legacy = step?.gesture;
  return legacy && typeof legacy === "object" && !Array.isArray(legacy)
    ? [legacy]
    : [];
}

export function takeStepBoom(step) {
  const boom = step?.boom;
  return boom
    && typeof boom === "object"
    && !Array.isArray(boom)
    && Number.isFinite(boom.centerX)
    && Number.isFinite(boom.centerY)
    && Number.isFinite(boom.radius)
    && boom.radius > 0
    ? boom
    : null;
}

export function takeStripAspectRatio(viewport, fallback = 16 / 9) {
  const width = viewport?.width;
  const height = viewport?.height;
  return Number.isFinite(width) && width > 0
    && Number.isFinite(height) && height > 0
    ? width / height
    : fallback;
}

export function takeStripScreenSize(viewport, longSide = 64) {
  const aspectRatio = takeStripAspectRatio(viewport);
  return aspectRatio >= 1
    ? { width: longSide, height: longSide / aspectRatio, aspectRatio }
    : { width: longSide * aspectRatio, height: longSide, aspectRatio };
}

export function takeStripPathGeometry(step, screenSize) {
  const points = takeStepPathPoints(step);
  const width = finiteOr(screenSize?.width, 64);
  const height = finiteOr(screenSize?.height, 36);
  if (points.length < 2 || width <= 0 || height <= 0) return null;
  const plotted = points.map(point => ({
    x: Math.max(0, Math.min(1, point.x)) * width,
    y: Math.max(0, Math.min(1, point.y)) * height,
  }));
  const end = plotted.at(-1);
  let prior = plotted.at(-2);
  for (let index = plotted.length - 2; index >= 0; index -= 1) {
    const candidate = plotted[index];
    if (candidate.x !== end.x || candidate.y !== end.y) {
      prior = candidate;
      break;
    }
  }
  return {
    points: plotted.map(point => `${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(" "),
    endX: end.x,
    endY: end.y,
    endAngle: Math.atan2(end.y - prior.y, end.x - prior.x) * 180 / Math.PI,
  };
}

export function createInteractiveFlockPanel({
  container,
  inspectTake,
  input,
  palettes = {},
  confirm: confirmTake,
  defaults = {},
  viewport = null,
} = {}) {
  const documentRef = container?.ownerDocument;
  if (!documentRef?.createElement || typeof container?.append !== "function") {
    throw new TypeError("Interactive flock panel needs a DOM container.");
  }
  if (typeof inspectTake !== "function") {
    throw new TypeError("Interactive flock panel inspectTake must be a function.");
  }
  if (typeof input !== "function") {
    throw new TypeError("Interactive flock panel input must be a function.");
  }

  const root = createElement(documentRef, "section", "interactive-flock-panel");
  root.setAttribute("aria-label", "Interactive flock take controls");

  const telemetry = createElement(
    documentRef,
    "div",
    "interactive-flock-panel__telemetry",
  );
  const status = createElement(
    documentRef,
    "span",
    "interactive-flock-panel__status",
    "Select Interactive Flock",
  );
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const time = createElement(
    documentRef,
    "span",
    "interactive-flock-panel__time",
    "NO TAKE",
  );
  telemetry.append(status, time);

  const takeSection = createElement(
    documentRef,
    "section",
    "interactive-flock-panel__take",
  );
  takeSection.setAttribute("aria-label", "Recorded beats");
  const takeHeader = createElement(
    documentRef,
    "div",
    "interactive-flock-panel__take-header",
  );
  const takeLabel = createElement(
    documentRef,
    "span",
    "interactive-flock-panel__take-label",
    "COMPOSITION BEATS",
  );
  const takeCount = createElement(
    documentRef,
    "span",
    "interactive-flock-panel__take-count",
    "0 BEATS",
  );
  takeHeader.append(takeLabel, takeCount);
  const takeStrip = createElement(
    documentRef,
    "ol",
    "interactive-flock-panel__take-strip",
  );
  takeSection.append(takeHeader, takeStrip);

  const paneHost = createElement(
    documentRef,
    "div",
    "interactive-flock-panel__pane",
  );
  root.append(telemetry, takeSection, paneHost);
  container.append(root);

  const defaultSimulation = objectOrEmpty(defaults.simulation);
  const defaultFlicker = objectOrEmpty(defaults.flicker);
  const defaultGrid = objectOrEmpty(defaults.grid);
  const defaultField = objectOrEmpty(defaults.field);
  const defaultIntro = objectOrEmpty(defaults.intro);
  const defaultOutro = objectOrEmpty(defaults.outro);
  const defaultBeat = finiteOr(
    defaults.timing?.beatSeconds,
    finiteOr(defaults.beatSeconds, 3),
  );
  const defaultPalette = firstDefined(
    defaults.palette,
    defaultGrid.palette,
    Object.keys(objectOrEmpty(palettes))[0],
    "default",
  );
  const modes = Object.keys(objectOrEmpty(defaultFlicker.modes));
  if (
    typeof defaultFlicker.mode === "string"
    && !modes.includes(defaultFlicker.mode)
  ) modes.unshift(defaultFlicker.mode);
  if (modes.length === 0) modes.push("noise");

  const model = {
    interactionMode: takeInteractionMode(defaults.interaction?.mode),
    showBoids: Boolean(
      defaults.visibleBoids?.show
      ?? defaults.visibleBoids?.enabled
      ?? false
    ),
    showPath: Boolean(defaults.interaction?.picasso?.showPath ?? true),
    visibleBoidSize: finiteOr(defaults.visibleBoids?.size, 6),
    visibleBoidColor: defaults.visibleBoids?.color ?? "#8cdfad",
    visibleBoidOpacity: finiteOr(defaults.visibleBoids?.opacity, 0.78),
    initialSpeed: finiteOr(defaultSimulation.initialSpeed, 0),
    birthsPerPulse: finiteOr(defaultSimulation.birthsPerPulse, 1),
    boomIntensity: finiteOr(defaults.interaction?.boom?.intensity, 4),
    alignment: finiteOr(defaultSimulation.alignment, 0),
    cohesion: finiteOr(defaultSimulation.cohesion, 0),
    separation: finiteOr(defaultSimulation.separation, 0),
    perceptionRadius: finiteOr(defaultSimulation.perceptionRadius, 1),
    flickerEnabled: defaultFlicker.enabled !== false,
    flickerMode: defaultFlicker.mode ?? modes[0],
    flickerAmount: finiteOr(defaultFlicker.amount, 1),
    count: finiteOr(defaultSimulation.count, 1),
    gridCells: finiteOr(defaultGrid.longSideCells, 3),
    fieldResolution: finiteOr(defaultField.longSidePixels, 16),
    palette: defaultPalette,
    beatSeconds: defaultBeat,
    introEnabled: defaultIntro.enabled !== false,
    introMode: defaultIntro.mode ?? "text",
    introSeconds: finiteOr(defaultIntro.durationSeconds, defaultBeat),
    outroEnabled: defaultOutro.enabled !== false,
    outroMode: defaultOutro.mode ?? "text",
    outroSeconds: finiteOr(defaultOutro.durationSeconds, defaultBeat),
  };

  const pane = new Pane({ container: paneHost });
  pane.element.classList.add("interactive-flock-panel__tweakpane");
  const transport = pane.addFolder({ title: "Build composition", expanded: true });
  const interactionBinding = transport.addBinding(model, "interactionMode", {
    label: "Beat action",
    options: INTERACTION_OPTIONS,
  });
  interactionBinding.element.querySelector("select")?.setAttribute(
    "aria-label",
    "Beat action",
  );
  const playButton = transport.addButton({ title: "Play" });
  const enoughButton = transport.addButton({ title: "Finish take" });
  const editButton = transport.addButton({ title: "Edit take" });
  const newButton = transport.addButton({ title: "Clear take" });

  const edit = pane.addFolder({ title: "Selected beat", expanded: false });
  const moveLeftButton = edit.addButton({ title: "Move left" });
  const moveRightButton = edit.addButton({ title: "Move right" });
  const duplicateButton = edit.addButton({ title: "Duplicate" });
  const deleteButton = edit.addButton({ title: "Delete" });

  const preview = pane.addFolder({ title: "Preview", expanded: true });
  const showBoidsBinding = preview.addBinding(model, "showBoids", {
    label: "Show boids",
  });
  const showPathBinding = preview.addBinding(model, "showPath", {
    label: "Show path",
  });
  const visibleBoidStyleBindings = [
    preview.addBinding(model, "visibleBoidSize", {
      label: "Boid size",
      min: 1,
      max: 64,
      step: 0.5,
    }),
    preview.addBinding(model, "visibleBoidColor", {
      label: "Boid color",
    }),
    preview.addBinding(model, "visibleBoidOpacity", {
      label: "Boid opacity",
      min: 0,
      max: 1,
      step: 0.01,
    }),
  ];

  const simulation = pane.addFolder({ title: "Simulation", expanded: false });
  const stepBindings = [
    simulation.addBinding(model, "initialSpeed", {
      label: "Initial speed",
      min: 0,
      max: 2000,
      step: 10,
    }),
    simulation.addBinding(model, "birthsPerPulse", {
      label: "Births / pulse",
      min: 1,
      max: 128,
      step: 1,
    }),
    simulation.addBinding(model, "alignment", {
      label: "Alignment",
      min: 0,
      max: 5,
      step: 0.01,
    }),
    simulation.addBinding(model, "cohesion", {
      label: "Cohesion",
      min: 0,
      max: 100,
      step: 0.5,
    }),
    simulation.addBinding(model, "separation", {
      label: "Separation",
      min: 0,
      max: 1000,
      step: 1,
    }),
    simulation.addBinding(model, "perceptionRadius", {
      label: "Perception",
      min: 1,
      max: 300,
      step: 1,
    }),
  ];
  const boomIntensityBinding = simulation.addBinding(model, "boomIntensity", {
    label: "Boom launchers",
    min: 1,
    max: 64,
    step: 1,
  });
  stepBindings.push(boomIntensityBinding);

  const flicker = pane.addFolder({ title: "Flicker", expanded: false });
  const flickerBindings = [
    flicker.addBinding(model, "flickerEnabled", { label: "Enabled" }),
    flicker.addBinding(model, "flickerMode", {
      label: "Mode",
      options: optionMap(modes),
    }),
    flicker.addBinding(model, "flickerAmount", {
      label: "Amount",
      min: 0,
      max: 1,
      step: 0.01,
    }),
  ];
  stepBindings.push(...flickerBindings);

  const take = pane.addFolder({ title: "Take", expanded: false });
  const takeBindings = [
    take.addBinding(model, "count", {
      label: "Boid capacity",
      min: 1,
      max: 2000,
      step: 1,
    }),
    take.addBinding(model, "gridCells", {
      label: "Grid cells",
      min: 3,
      max: 101,
      step: 1,
    }),
    take.addBinding(model, "fieldResolution", {
      label: "Field pixels",
      min: 16,
      max: 1024,
      step: 1,
    }),
    take.addBinding(model, "palette", {
      label: "Palette",
      options: optionMap(paletteNames(palettes, defaultPalette)),
    }),
    take.addBinding(model, "beatSeconds", {
      label: "Beat seconds",
      min: 0.1,
      max: 30,
      step: 0.1,
    }),
  ];

  const phases = pane.addFolder({ title: "Phases", expanded: false });
  const phaseModes = optionMap(["text", "fade"]);
  takeBindings.push(
    phases.addBinding(model, "introEnabled", { label: "Intro" }),
    phases.addBinding(model, "introMode", {
      label: "Intro mode",
      options: phaseModes,
    }),
    phases.addBinding(model, "introSeconds", {
      label: "Intro seconds",
      min: 0.1,
      max: 30,
      step: 0.1,
    }),
    phases.addBinding(model, "outroEnabled", { label: "Outro" }),
    phases.addBinding(model, "outroMode", {
      label: "Outro mode",
      options: phaseModes,
    }),
    phases.addBinding(model, "outroSeconds", {
      label: "Outro seconds",
      min: 0.1,
      max: 30,
      step: 0.1,
    }),
  );

  let disposed = false;
  let syncing = false;
  let currentTake = null;
  let modelSignature = "";
  let stripSignature = "";

  const inspectViewport = typeof viewport === "function"
    ? viewport
    : () => viewport;

  function dispatch(payload) {
    if (disposed) return false;
    const result = input("take", payload);
    sync();
    return result;
  }

  function stage(settings, scope = "step") {
    return dispatch({ action: "stage-settings", scope, settings });
  }

  function onChange(binding, callback) {
    binding.on("change", event => {
      if (syncing) return;
      callback(event.value);
    });
  }

  onChange(interactionBinding, value => {
    dispatch({ action: "set-interaction", mode: takeInteractionMode(value) });
  });

  onChange(showBoidsBinding, value => {
    stage({ showBoids: Boolean(value) }, "take");
  });
  onChange(showPathBinding, value => {
    stage({ showPath: Boolean(value) }, "take");
  });
  onChange(visibleBoidStyleBindings[0], value => {
    stage({ visibleBoids: { size: value } }, "take");
  });
  onChange(visibleBoidStyleBindings[1], value => {
    stage({ visibleBoids: { color: value } }, "take");
  });
  onChange(visibleBoidStyleBindings[2], value => {
    stage({ visibleBoids: { opacity: value } }, "take");
  });
  const simulationKeys = [
    "initialSpeed",
    "birthsPerPulse",
    "alignment",
    "cohesion",
    "separation",
    "perceptionRadius",
  ];
  stepBindings.slice(0, simulationKeys.length).forEach((binding, index) => {
    const key = simulationKeys[index];
    onChange(binding, value => stage({ simulation: { [key]: value } }));
  });
  onChange(boomIntensityBinding, value => {
    stage({ interaction: { boom: { intensity: Math.round(value) } } });
  });
  onChange(flickerBindings[0], value => {
    stage({ flicker: { enabled: Boolean(value) } });
  });
  onChange(flickerBindings[1], value => {
    stage({ flicker: { mode: value } });
  });
  onChange(flickerBindings[2], value => {
    stage({ flicker: { amount: value } });
  });
  onChange(takeBindings[0], value => {
    stage({ simulation: { count: Math.round(value) } }, "take");
  });
  onChange(takeBindings[1], value => {
    stage({ grid: { longSideCells: Math.round(value) } }, "take");
  });
  onChange(takeBindings[2], value => {
    stage({ field: { longSidePixels: Math.round(value) } }, "take");
  });
  onChange(takeBindings[3], value => stage({ palette: value }, "take"));
  onChange(takeBindings[4], value => stage({ beatSeconds: value }, "take"));
  onChange(takeBindings[5], value => {
    stage({ intro: { enabled: Boolean(value) } }, "take");
  });
  onChange(takeBindings[6], value => {
    stage({ intro: { mode: value } }, "take");
  });
  onChange(takeBindings[7], value => {
    stage({ intro: { durationSeconds: value } }, "take");
  });
  onChange(takeBindings[8], value => {
    stage({ outro: { enabled: Boolean(value) } }, "take");
  });
  onChange(takeBindings[9], value => {
    stage({ outro: { mode: value } }, "take");
  });
  onChange(takeBindings[10], value => {
    stage({ outro: { durationSeconds: value } }, "take");
  });

  playButton.on("click", () => dispatch({ action: "play" }));
  enoughButton.on("click", () => dispatch({ action: "enough" }));
  editButton.on("click", () => dispatch({ action: "edit" }));
  moveLeftButton.on("click", () => {
    const index = currentTake?.steps.findIndex(
      step => step.id === currentTake.selectedStepId,
    ) ?? -1;
    if (index > 0) dispatch({
      action: "reorder",
      stepId: currentTake.selectedStepId,
      toIndex: index - 1,
    });
  });
  moveRightButton.on("click", () => {
    const index = currentTake?.steps.findIndex(
      step => step.id === currentTake.selectedStepId,
    ) ?? -1;
    if (index >= 0 && index < currentTake.steps.length - 1) dispatch({
      action: "reorder",
      stepId: currentTake.selectedStepId,
      toIndex: index + 1,
    });
  });
  duplicateButton.on("click", () => dispatch({
    action: "duplicate",
    stepId: currentTake?.selectedStepId,
  }));
  deleteButton.on("click", () => dispatch({
    action: "delete",
    stepId: currentTake?.selectedStepId,
  }));

  const confirmAction = typeof confirmTake === "function"
    ? confirmTake
    : documentRef.defaultView?.confirm?.bind(documentRef.defaultView);
  newButton.on("click", () => {
    if (
      typeof confirmAction === "function"
      && confirmAction("Clear this take and start a new one?", currentTake) === true
    ) dispatch({ action: "new" });
  });

  function syncModel(takeState) {
    const takeSettings = objectOrEmpty(takeState.takeSettings);
    const staged = objectOrEmpty(takeState.stagedSettings);
    const visibleBoids = {
      ...objectOrEmpty(defaults.visibleBoids),
      ...objectOrEmpty(takeSettings.visibleBoids),
    };
    const simulationSettings = {
      ...defaultSimulation,
      ...objectOrEmpty(staged.simulation),
    };
    const flickerSettings = {
      ...defaultFlicker,
      ...objectOrEmpty(staged.flicker),
    };
    const boomSettings = {
      ...objectOrEmpty(defaults.interaction?.boom),
      ...objectOrEmpty(staged.interaction?.boom),
    };
    const takeSimulation = {
      ...defaultSimulation,
      ...objectOrEmpty(takeSettings.simulation),
    };
    const gridSettings = {
      ...defaultGrid,
      ...objectOrEmpty(takeSettings.grid),
    };
    const fieldSettings = {
      ...defaultField,
      ...objectOrEmpty(takeSettings.field),
    };
    const introSettings = {
      ...defaultIntro,
      ...objectOrEmpty(takeSettings.intro),
    };
    const outroSettings = {
      ...defaultOutro,
      ...objectOrEmpty(takeSettings.outro),
    };
    const next = {
      interactionMode: takeInteractionMode(
        takeState.interactionMode,
        takeInteractionMode(defaults.interaction?.mode),
      ),
      showBoids: Boolean(firstDefined(
        takeSettings.showBoids,
        takeSettings.visibleBoids?.show,
        defaults.visibleBoids?.show,
        defaults.visibleBoids?.enabled,
        false,
      )),
      showPath: Boolean(firstDefined(
        takeSettings.showPath,
        defaults.interaction?.picasso?.showPath,
        true,
      )),
      visibleBoidSize: finiteOr(visibleBoids.size, model.visibleBoidSize),
      visibleBoidColor: visibleBoids.color ?? model.visibleBoidColor,
      visibleBoidOpacity: finiteOr(
        visibleBoids.opacity,
        model.visibleBoidOpacity,
      ),
      initialSpeed: finiteOr(simulationSettings.initialSpeed, model.initialSpeed),
      birthsPerPulse: finiteOr(
        simulationSettings.birthsPerPulse,
        model.birthsPerPulse,
      ),
      boomIntensity: finiteOr(boomSettings.intensity, model.boomIntensity),
      alignment: finiteOr(simulationSettings.alignment, model.alignment),
      cohesion: finiteOr(simulationSettings.cohesion, model.cohesion),
      separation: finiteOr(simulationSettings.separation, model.separation),
      perceptionRadius: finiteOr(
        simulationSettings.perceptionRadius,
        model.perceptionRadius,
      ),
      flickerEnabled: flickerSettings.enabled !== false,
      flickerMode: flickerSettings.mode ?? model.flickerMode,
      flickerAmount: finiteOr(flickerSettings.amount, model.flickerAmount),
      count: finiteOr(takeSimulation.count, model.count),
      gridCells: finiteOr(gridSettings.longSideCells, model.gridCells),
      fieldResolution: finiteOr(
        fieldSettings.longSidePixels,
        model.fieldResolution,
      ),
      palette: takeSettings.palette ?? defaultPalette,
      beatSeconds: finiteOr(takeState.beatSeconds, defaultBeat),
      introEnabled: introSettings.enabled !== false,
      introMode: introSettings.mode ?? model.introMode,
      introSeconds: finiteOr(
        introSettings.durationSeconds,
        model.introSeconds,
      ),
      outroEnabled: outroSettings.enabled !== false,
      outroMode: outroSettings.mode ?? model.outroMode,
      outroSeconds: finiteOr(
        outroSettings.durationSeconds,
        model.outroSeconds,
      ),
    };
    const signature = JSON.stringify(next);
    if (signature === modelSignature) return;
    modelSignature = signature;
    Object.assign(model, next);
    syncing = true;
    try {
      pane.refresh();
    } finally {
      syncing = false;
    }
  }

  function renderTakeStrip(takeState, editable) {
    const screenSize = takeStripScreenSize(inspectViewport());
    const { aspectRatio } = screenSize;
    root.style.setProperty("--take-screen-aspect", String(aspectRatio));
    root.style.setProperty("--take-screen-width", `${screenSize.width}px`);
    root.style.setProperty("--take-screen-height", `${screenSize.height}px`);
    root.style.setProperty(
      "--take-arrow-length",
      `${Math.min(screenSize.width, screenSize.height) * 0.34}px`,
    );
    const signature = JSON.stringify({
      steps: takeState.steps.map(step => ({
        id: step.id,
        interaction: takeStepInteraction(step),
        gestures: takeStepGestures(step),
        path: takeStepPathPoints(step),
        boom: takeStepBoom(step),
      })),
      interactionMode: takeInteractionMode(takeState.interactionMode),
      selected: takeState.selectedStepId,
      preview: takeState.previewStepId,
      editable,
      aspectRatio,
    });
    if (signature === stripSignature) return;
    stripSignature = signature;
    takeStrip.replaceChildren();
    takeState.steps.forEach((step, index) => {
      const interaction = takeStepInteraction(step);
      const gestures = takeStepGestures(step);
      const item = createElement(
        documentRef,
        "li",
        "interactive-flock-panel__step-item",
      );
      const button = createElement(
        documentRef,
        "button",
        "interactive-flock-panel__step",
      );
      button.type = "button";
      button.dataset.stepId = step.id;
      button.disabled = !editable;
      const selected = step.id === takeState.selectedStepId;
      button.classList.toggle("is-selected", selected);
      button.classList.toggle("is-preview", step.id === takeState.previewStepId);
      button.setAttribute("aria-pressed", String(selected));
      const screen = createElement(
        documentRef,
        "span",
        "interactive-flock-panel__step-screen",
      );
      screen.setAttribute("aria-hidden", "true");
      if (interaction === "flow") {
        screen.append(createElement(
          documentRef,
          "span",
          "interactive-flock-panel__step-flow",
          "FLOW",
        ));
      } else if (interaction === "boom") {
        const boom = takeStepBoom(step);
        if (boom) {
          const radius = boom.radius * Math.min(screenSize.width, screenSize.height);
          const marker = createElement(
            documentRef,
            "span",
            "interactive-flock-panel__step-boom",
          );
          marker.style.setProperty("--take-boom-x", `${boom.centerX * 100}%`);
          marker.style.setProperty("--take-boom-y", `${boom.centerY * 100}%`);
          marker.style.setProperty("--take-boom-radius", `${radius}px`);
          screen.append(marker);
        }
      } else if (interaction === "picasso") {
        const geometry = takeStripPathGeometry(step, screenSize);
        if (geometry) {
          const map = createSvgElement(
            documentRef,
            "svg",
            "interactive-flock-panel__step-path-map",
          );
          map.setAttribute("viewBox", `0 0 ${screenSize.width} ${screenSize.height}`);
          map.setAttribute("preserveAspectRatio", "none");
          const basePath = createSvgElement(
            documentRef,
            "polyline",
            "interactive-flock-panel__step-path-base",
          );
          basePath.setAttribute("points", geometry.points);
          const signalPath = createSvgElement(
            documentRef,
            "polyline",
            "interactive-flock-panel__step-path-signal",
          );
          signalPath.setAttribute("points", geometry.points);
          const endpoint = createSvgElement(
            documentRef,
            "path",
            "interactive-flock-panel__step-path-end",
          );
          endpoint.setAttribute("d", "M -5 -2.5 L 0 0 L -5 2.5");
          endpoint.setAttribute(
            "transform",
            `translate(${geometry.endX} ${geometry.endY}) rotate(${geometry.endAngle})`,
          );
          map.append(basePath, signalPath, endpoint);
          screen.append(map);
        }
      } else gestures.forEach(gesture => {
        const marker = createElement(
          documentRef,
          "span",
          "interactive-flock-panel__step-gesture",
        );
        marker.style.setProperty(
          "--take-origin-x",
          `${finiteOr(gesture.originX, 0.5) * 100}%`,
        );
        marker.style.setProperty(
          "--take-origin-y",
          `${finiteOr(gesture.originY, 0.5) * 100}%`,
        );
        marker.style.setProperty(
          "--take-direction-angle",
          `${Math.atan2(
            finiteOr(gesture.directionY, 0),
            finiteOr(gesture.directionX, 1),
          )}rad`,
        );
        marker.style.setProperty(
          "--take-strength",
          String(Math.max(0, Math.min(1, finiteOr(gesture.strength, 1)))),
        );
        const arrow = createElement(
          documentRef,
          "span",
          "interactive-flock-panel__step-arrow",
        );
        const origin = createElement(
          documentRef,
          "span",
          "interactive-flock-panel__step-origin",
        );
        marker.append(arrow, origin);
        screen.append(marker);
      });
      const stepIndex = createElement(
        documentRef,
        "span",
        "interactive-flock-panel__step-index",
        String(index + 1).padStart(2, "0"),
      );
      button.append(screen, stepIndex);
      if (interaction === "flow") {
        button.setAttribute("aria-label", `Select beat ${index + 1}, Let it flow`);
      } else if (interaction === "picasso") {
        button.setAttribute("aria-label", `Select beat ${index + 1}, Picasso path`);
      } else if (interaction === "boom") {
        const intensity = finiteOr(
          step.settings?.interaction?.boom?.intensity,
          defaults.interaction?.boom?.intensity ?? 4,
        );
        button.setAttribute(
          "aria-label",
          `Select beat ${index + 1}, Boom with ${intensity} launchers`,
        );
      } else {
        const launchCount = gestures.length;
        button.setAttribute(
          "aria-label",
          `Select beat ${index + 1}, ${launchCount} ${launchCount === 1 ? "flock launch" : "flock launches"}`,
        );
      }
      button.addEventListener("click", () => dispatch({
        action: "select",
        stepId: step.id,
      }));
      item.append(button);
      takeStrip.append(item);
    });

    const nextIndex = takeState.steps.length + 1;
    const addItem = createElement(
      documentRef,
      "li",
      "interactive-flock-panel__step-item interactive-flock-panel__add-item",
    );
    const addButton = createElement(
      documentRef,
      "button",
      "interactive-flock-panel__step interactive-flock-panel__add-step",
    );
    const adding = editable && takeState.selectedStepId === null;
    addButton.type = "button";
    addButton.disabled = !editable;
    addButton.classList.toggle("is-selected", adding);
    addButton.setAttribute("aria-label", `Add beat ${nextIndex}`);
    addButton.setAttribute("aria-pressed", String(adding));
    const addScreen = createElement(
      documentRef,
      "span",
      "interactive-flock-panel__step-screen",
    );
    addScreen.setAttribute("aria-hidden", "true");
    addScreen.append(createElement(
      documentRef,
      "span",
      "interactive-flock-panel__add-icon",
      "+",
    ));
    const addLabel = createElement(
      documentRef,
      "span",
      "interactive-flock-panel__step-index",
      String(nextIndex).padStart(2, "0"),
    );
    addButton.append(addScreen, addLabel);
    addButton.addEventListener("click", () => dispatch({
      action: "select",
      stepId: null,
    }));
    addItem.append(addButton);
    takeStrip.append(addItem);
  }

  function syncTelemetry(takeState) {
    const count = takeState.steps.length;
    const duration = count * takeState.beatSeconds;
    const selectedIndex = takeState.steps.findIndex(
      step => step.id === takeState.selectedStepId,
    );
    const previewIndex = takeState.steps.findIndex(
      step => step.id === takeState.previewStepId,
    );
    const draftLaunchCount = Array.isArray(takeState.draftGestures)
      ? takeState.draftGestures.length
      : takeState.draftGesture === null || takeState.draftGesture === undefined
        ? 0
        : 1;
    const launcherLabels = {
      frozen: selectedIndex >= 0
        ? `Beat ${selectedIndex + 1} selected · Draw to replace its launches`
        : "New beat · Draw one or more launches on canvas",
      drawing: `Drawing launch ${draftLaunchCount + 1} · Longer is stronger`,
      drawn: `${draftLaunchCount} ${draftLaunchCount === 1 ? "launch" : "launches"} ready · Drag again or Play`,
      playing: `Playing beat ${Math.max(1, previewIndex + 1)} of ${count}`,
      sealed: `Sealed · ${count} recorded ${count === 1 ? "beat" : "beats"}`,
    };
    const picassoLabels = {
      frozen: selectedIndex >= 0
        ? `Beat ${selectedIndex + 1} selected · Draw to replace its route`
        : "New beat · Draw a route on canvas",
      drawing: "Drawing route · Keep tracing",
      drawn: "Route ready · Play to commit",
      playing: `Playing beat ${Math.max(1, previewIndex + 1)} of ${count}`,
      sealed: `Sealed · ${count} recorded ${count === 1 ? "beat" : "beats"}`,
    };
    const boomLabels = {
      frozen: selectedIndex >= 0
        ? `Beat ${selectedIndex + 1} selected · Drag to replace its boom`
        : "New beat · Drag from boom center to radius",
      drawing: "Sizing boom radius · Release to stage",
      drawn: "Boom ready · Play to commit",
      playing: `Playing beat ${Math.max(1, previewIndex + 1)} of ${count}`,
      sealed: `Sealed · ${count} recorded ${count === 1 ? "beat" : "beats"}`,
    };
    const flowLabels = {
      frozen: selectedIndex >= 0
        ? `Beat ${selectedIndex + 1} selected · Existing motion keeps flowing`
        : "New beat · Existing motion keeps flowing",
      drawing: "Let it flow · No canvas input needed",
      drawn: "Let it flow · Ready to play",
      playing: `Flowing through beat ${Math.max(1, previewIndex + 1)} of ${count}`,
      sealed: `Sealed · ${count} recorded ${count === 1 ? "beat" : "beats"}`,
    };
    const labels = {
      launcher: launcherLabels,
      picasso: picassoLabels,
      boom: boomLabels,
      flow: flowLabels,
    }[takeInteractionMode(takeState.interactionMode)];
    status.textContent = labels[takeState.mode];
    if (takeState.mode === "playing") {
      const elapsed = takeState.playbackTime - Math.max(0, previewIndex)
        * takeState.beatSeconds;
      time.textContent = `${formatSeconds(elapsed)} / ${formatSeconds(takeState.beatSeconds)}`;
    } else {
      time.textContent = `${count} ${count === 1 ? "BEAT" : "BEATS"} · ${formatSeconds(duration)}`;
    }
    takeCount.textContent = `${count} ${count === 1 ? "BEAT" : "BEATS"}`;
  }

  function syncAvailability(takeState) {
    const available = takeState !== null;
    const mode = takeState?.mode;
    const steps = takeState?.steps ?? [];
    const selectedIndex = steps.findIndex(step => step.id === takeState?.selectedStepId);
    const draftLaunchCount = Array.isArray(takeState?.draftGestures)
      ? takeState.draftGestures.length
      : takeState?.draftGesture === null || takeState?.draftGesture === undefined
        ? 0
        : 1;
    const frozen = mode === "frozen";
    const authoring = mode === "frozen" || mode === "drawing" || mode === "drawn";
    const flowing = takeInteractionMode(takeState?.interactionMode) === "flow";
    const hasWork = steps.length > 0 || draftLaunchCount > 0 || !frozen;

    playButton.disabled = !available || !takeCanPlay(takeState);
    enoughButton.disabled = !available || !(
      frozen && steps.length > 0 && draftLaunchCount === 0
    );
    editButton.disabled = mode !== "sealed";
    newButton.disabled = !available || !hasWork;
    moveLeftButton.disabled = !frozen || selectedIndex <= 0;
    moveRightButton.disabled = (
      !frozen || selectedIndex < 0 || selectedIndex >= steps.length - 1
    );
    duplicateButton.disabled = !frozen || selectedIndex < 0;
    deleteButton.disabled = !frozen || selectedIndex < 0;
    interactionBinding.disabled = !available || !frozen;
    showBoidsBinding.disabled = !available;
    showPathBinding.disabled = !available;
    for (const binding of visibleBoidStyleBindings) {
      binding.disabled = !available || !authoring;
    }
    for (const binding of stepBindings) {
      binding.disabled = !available || !authoring || flowing;
    }
    boomIntensityBinding.disabled = (
      !available
      || !authoring
      || takeInteractionMode(takeState?.interactionMode) !== "boom"
    );
    for (const binding of takeBindings) binding.disabled = !available || !authoring;
    root.classList.toggle("is-readonly", available && !authoring);
    root.classList.toggle("is-unavailable", !available);
  }

  function sync() {
    if (disposed) return null;
    const takeState = takeFromInspection(inspectTake());
    currentTake = takeState;
    root.dataset.mode = takeState?.mode ?? "unavailable";
    root.dataset.interaction = takeInteractionMode(takeState?.interactionMode);
    syncAvailability(takeState);
    if (takeState === null) {
      status.textContent = "Select Interactive Flock";
      time.textContent = "NO TAKE";
      takeCount.textContent = "0 BEATS";
      renderTakeStrip({
        mode: "frozen",
        steps: [],
        selectedStepId: null,
        previewStepId: null,
      }, false);
      return null;
    }
    syncModel(takeState);
    renderTakeStrip(takeState, takeState.mode === "frozen");
    syncTelemetry(takeState);
    return takeState;
  }

  sync();
  debug.config(
    "interactive-flock-panel ready palettes=%d modes=%d",
    paletteNames(palettes, defaultPalette).length,
    modes.length,
  );

  return {
    pane,
    root,
    sync,
    dispose() {
      if (disposed) return;
      disposed = true;
      pane.dispose();
      root.remove();
      debug.config("interactive-flock-panel disposed");
    },
  };
}
