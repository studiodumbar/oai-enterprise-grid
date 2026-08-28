import { Pane } from "../vendor/tweakpane-4.0.5.min.js";

const INTERACTIVE_FLOCK_INSTRUCTIONS = Object.freeze({
  launcher: "Add beat → draw launches → Play.",
  picasso: "Add beat → draw a route → Play.",
  boom: "Add beat → drag a radius → Play.",
  flow: "Add beat → choose Let it flow → Play.",
});

function interactiveFlockInstruction(inspection) {
  const mode = inspection?.timeline?.rule?.interactionMode;
  return INTERACTIVE_FLOCK_INSTRUCTIONS[mode]
    ?? INTERACTIVE_FLOCK_INSTRUCTIONS.launcher;
}

function compositionLabel(id) {
  return id
    .split("-")
    .map(word => word === "l"
      ? "L"
      : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export function canonicalCompositionChoices(compositions) {
  if (!Array.isArray(compositions) || compositions.length === 0) {
    throw new TypeError("Composition panel needs at least one canonical composition.");
  }
  const ids = new Set();
  const labels = new Set();
  const choices = [];
  for (const [index, entry] of compositions.entries()) {
    const id = typeof entry === "string" ? entry.trim() : entry?.id?.trim();
    if (!id || ids.has(id)) {
      throw new TypeError(
        `Canonical composition ${index} needs a unique non-empty id.`,
      );
    }
    ids.add(id);
    const label = typeof entry?.label === "string" && entry.label.trim()
      ? entry.label.trim()
      : compositionLabel(id);
    if (labels.has(label)) {
      throw new TypeError(`Canonical composition ${index} needs a unique label.`);
    }
    labels.add(label);
    choices.push(Object.freeze({
      id,
      label,
    }));
  }
  return Object.freeze(choices);
}

function displayPhase(value) {
  return typeof value === "string" && value ? value : "-";
}

function displayCycle(value) {
  return Number.isInteger(value) && value >= 0 ? String(value) : "-";
}

function displayDuration(value) {
  if (value === null) return "continuous";
  return Number.isFinite(value) && value >= 0 ? `${value.toFixed(3)} s` : "-";
}

export function compositionPanelTelemetry(inspection) {
  const compositionId = typeof inspection?.compositionId === "string"
    ? inspection.compositionId
    : "";
  return Object.freeze({
    compositionId,
    phase: displayPhase(inspection?.timeline?.phase),
    cycle: displayCycle(inspection?.timeline?.cycleIndex),
    coreDuration: displayDuration(inspection?.timeline?.coreDuration),
    instruction: compositionId === "interactive-flock"
      ? interactiveFlockInstruction(inspection)
      : "",
  });
}

export function createCompositionPanel({
  container,
  compositions,
  current,
  use,
  noisePreviewVisible = () => false,
  setNoisePreviewVisible = () => false,
} = {}) {
  if (!container?.append) {
    throw new TypeError("Composition panel needs a DOM container.");
  }
  if (typeof current !== "function" || typeof use !== "function") {
    throw new TypeError("Composition panel needs current() and use(id) functions.");
  }
  if (
    typeof noisePreviewVisible !== "function"
    || typeof setNoisePreviewVisible !== "function"
  ) {
    throw new TypeError("Composition panel noise preview hooks must be functions.");
  }

  const choices = canonicalCompositionChoices(compositions);
  const knownIds = new Set(choices.map(choice => choice.id));
  const options = Object.fromEntries(choices.map(choice => [choice.label, choice.id]));
  const initial = compositionPanelTelemetry(current());
  if (!knownIds.has(initial.compositionId)) {
    throw new RangeError(
      `Current composition "${initial.compositionId}" is not in the canonical composition list.`,
    );
  }

  const values = {
    composition: initial.compositionId,
    phase: initial.phase,
    cycle: initial.cycle,
    coreDuration: initial.coreDuration,
    instruction: initial.instruction,
    noisePreview: Boolean(noisePreviewVisible()),
  };
  const pane = new Pane({ container });
  pane.element.setAttribute("aria-label", "Composition controls and timeline status");
  let disposed = false;
  let syncing = false;

  const compositionBinding = pane.addBinding(values, "composition", {
    label: "Composition",
    options,
  });
  pane.addBinding(values, "phase", { label: "Phase", readonly: true });
  pane.addBinding(values, "cycle", { label: "Cycle", readonly: true });
  pane.addBinding(values, "coreDuration", { label: "Core loop", readonly: true });
  const noisePreviewBinding = pane.addBinding(values, "noisePreview", {
    label: "Noise preview",
  });
  const instructionBinding = pane.addBinding(values, "instruction", {
    label: "How to add a beat",
    readonly: true,
  });

  function sync() {
    if (disposed) return false;
    const telemetry = compositionPanelTelemetry(current());
    if (!knownIds.has(telemetry.compositionId)) {
      throw new RangeError(
        `Current composition "${telemetry.compositionId}" is not in the canonical composition list.`,
      );
    }
    syncing = true;
    try {
      values.composition = telemetry.compositionId;
      values.phase = telemetry.phase;
      values.cycle = telemetry.cycle;
      values.coreDuration = telemetry.coreDuration;
      values.instruction = telemetry.instruction;
      values.noisePreview = Boolean(noisePreviewVisible());
      instructionBinding.hidden = telemetry.instruction === "";
      pane.refresh();
    } finally {
      syncing = false;
    }
    return true;
  }

  compositionBinding.on("change", event => {
    if (syncing || event.last === false || event.value === current().compositionId) return;
    try {
      use(event.value);
    } finally {
      sync();
    }
  });
  noisePreviewBinding.on("change", event => {
    if (syncing || event.last === false) return;
    setNoisePreviewVisible(event.value === true);
    sync();
  });

  sync();
  return {
    pane,
    sync,
    dispose() {
      if (disposed) return;
      disposed = true;
      pane.dispose();
    },
  };
}
