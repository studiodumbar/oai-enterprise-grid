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

export function paletteChoices(palettes) {
  if (!palettes || typeof palettes !== "object" || Array.isArray(palettes)) {
    throw new TypeError("Composition panel palettes must be an object.");
  }
  const names = Object.keys(palettes);
  if (names.length === 0) {
    throw new TypeError("Composition panel needs at least one palette.");
  }
  return Object.freeze(names.map(name => Object.freeze({
    id: name,
    label: compositionLabel(name),
  })));
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

export function normalizeLongSideCells(value) {
  const cells = Number(value);
  if (!Number.isSafeInteger(cells) || cells < 2 || cells > 200) {
    throw new RangeError("Long side cells must be an integer between 2 and 200.");
  }
  return cells;
}

export function createCompositionPanel({
  container,
  compositions,
  current,
  use,
  palettes,
  currentPalette,
  usePalette,
  currentLongSideCells = () => null,
  setLongSideCells = () => null,
  noisePreviewVisible = () => false,
  setNoisePreviewVisible = () => false,
} = {}) {
  if (!container?.append) {
    throw new TypeError("Composition panel needs a DOM container.");
  }
  if (typeof current !== "function" || typeof use !== "function") {
    throw new TypeError("Composition panel needs current() and use(id) functions.");
  }
  if (typeof currentPalette !== "function" || typeof usePalette !== "function") {
    throw new TypeError(
      "Composition panel needs currentPalette() and usePalette(name) functions.",
    );
  }
  if (
    typeof currentLongSideCells !== "function"
    || typeof setLongSideCells !== "function"
  ) {
    throw new TypeError("Composition panel long-side cell hooks must be functions.");
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
  const availablePalettes = paletteChoices(palettes);
  const knownPalettes = new Set(availablePalettes.map(choice => choice.id));
  const paletteOptions = Object.fromEntries(
    availablePalettes.map(choice => [choice.label, choice.id]),
  );
  const initial = compositionPanelTelemetry(current());
  if (!knownIds.has(initial.compositionId)) {
    throw new RangeError(
      `Current composition "${initial.compositionId}" is not in the canonical composition list.`,
    );
  }
  const initialPalette = currentPalette();
  if (!knownPalettes.has(initialPalette)) {
    throw new RangeError(`Current palette "${initialPalette}" is not available.`);
  }
  const initialLongSideCells = currentLongSideCells();
  if (initialLongSideCells !== null) normalizeLongSideCells(initialLongSideCells);

  const values = {
    composition: initial.compositionId,
    palette: initialPalette,
    longSideCells: initialLongSideCells ?? 2,
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
  const paletteBinding = pane.addBinding(values, "palette", {
    label: "Palette",
    options: paletteOptions,
  });
  const longSideCellsBinding = pane.addBinding(values, "longSideCells", {
    label: "Long side cells",
    min: 2,
    max: 200,
    step: 1,
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
      values.palette = currentPalette();
      const longSideCells = currentLongSideCells();
      if (longSideCells !== null) {
        values.longSideCells = normalizeLongSideCells(longSideCells);
      }
      values.phase = telemetry.phase;
      values.cycle = telemetry.cycle;
      values.coreDuration = telemetry.coreDuration;
      values.instruction = telemetry.instruction;
      values.noisePreview = Boolean(noisePreviewVisible());
      longSideCellsBinding.hidden = longSideCells === null;
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
  paletteBinding.on("change", event => {
    if (syncing || event.last === false || event.value === currentPalette()) return;
    try {
      usePalette(event.value);
    } finally {
      sync();
    }
  });
  longSideCellsBinding.on("change", event => {
    if (syncing || event.last === false) return;
    const cells = normalizeLongSideCells(event.value);
    if (cells === currentLongSideCells()) return;
    try {
      setLongSideCells(cells);
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
