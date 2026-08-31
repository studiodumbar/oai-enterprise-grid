import { resolveSceneTransitionSettings } from "../scene-transitions/transition-settings.js";
import { drawArrangementOverlay, modeDrawsOverlay } from "./overlay.js";
import { debug } from "../debug/index.js";

/**
 * Draws whatever the intro/outro mode owns beyond the composition's glyphs.
 *
 * This lives beside the director rather than inside a generator on purpose: the
 * overlay has to appear exactly once per frame for any composition, including
 * the ones whose generators carry no transition wiring at all — otherwise a
 * config author edits `intro` and sees nothing happen. Modes without overlay
 * content produce no driver, so the whole subsystem costs nothing unless
 * something asks for it.
 */
export class PhaseOverlay {
  constructor({ intro, outro, longSideCells = null }) {
    this.intro = intro ?? null;
    this.outro = outro ?? null;
    this.longSideCells = longSideCells;
    this.viewport = null;
    this.plans = { intro: null, outro: null };
    this.lastPhase = null;
  }

  resize(viewport) {
    const width = Number(viewport?.width);
    const height = Number(viewport?.height);
    this.viewport = width > 0 && height > 0 ? { width, height } : null;
    this.plans = { intro: null, outro: null };
  }

  layout() {
    if (!this.viewport) return null;
    // The composition's own grid density decides the cell size, so the ladder
    // lands on the same grid the composition draws on.
    const cellSize = Number.isSafeInteger(this.longSideCells) && this.longSideCells > 0
      ? Math.max(this.viewport.width, this.viewport.height) / this.longSideCells
      : undefined;
    return { ...this.viewport, cellSize };
  }

  /**
   * Plans are cached per phase and rebuilt when the phase length changes: a
   * mode may spend part of the phase in absolute seconds, so the duration is
   * part of its geometry rather than just a scale factor.
   */
  planFor(phase, durationSeconds) {
    const cached = this.plans[phase];
    if (cached && cached.durationSeconds === durationSeconds) return cached.plan;
    const entry = this[phase];
    const layout = this.layout();
    if (!entry || !layout) return null;
    const plan = entry.mode.createPlan({
      layout,
      key: `overlay:${phase}`,
      durationSeconds,
    });
    this.plans[phase] = { durationSeconds, plan };
    return plan;
  }

  phaseDescriptorAt(endpoint) {
    const phase = endpoint?.phase === "start"
      ? "intro"
      : (endpoint?.phase === "end" ? "outro" : null);
    if (phase === null) return null;
    const entry = this[phase];
    if (!entry) return null;
    const progress = phase === "intro"
      ? endpoint.progress
      : 1 - endpoint.progress;
    return { phase, entry, progress, durationSeconds: endpoint.durationSeconds };
  }

  phaseAt(endpoint) {
    const descriptor = this.phaseDescriptorAt(endpoint);
    if (!descriptor) return null;
    const { phase, durationSeconds } = descriptor;
    const plan = this.planFor(phase, durationSeconds);
    return plan === null ? null : { ...descriptor, plan };
  }

  draw(endpoint, context) {
    const phase = endpoint?.phase === "start"
      ? "intro"
      : (endpoint?.phase === "end" ? "outro" : null);
    if (phase !== this.lastPhase) {
      debug.transition(
        "overlay=%s mode=%s",
        phase ?? "-",
        phase === null ? "-" : (this[phase]?.name ?? "-"),
      );
      this.lastPhase = phase;
    }
    const frame = this.phaseAt(endpoint);
    if (!frame) return false;
    return drawArrangementOverlay(
      frame.entry.mode,
      frame.plan,
      frame.progress,
      context,
    );
  }

  inspect() {
    return {
      intro: this.intro?.name ?? null,
      outro: this.outro?.name ?? null,
      phase: this.lastPhase,
      longSideCells: this.longSideCells,
    };
  }
}

/**
 * The palette table lives with the host, so the driver is where a mode's
 * authored palette — a name, an explicit list, or nothing at all — turns into
 * the colors it draws with.
 */
export function resolveOverlayColors({ authored, compositionPalette, palettes }) {
  const requested = authored ?? compositionPalette ?? null;
  if (requested === null) return null;
  if (Array.isArray(requested)) return requested;
  if (typeof requested !== "string") {
    throw new TypeError(
      "A phase overlay palette must be a palette name or a list of colors.",
    );
  }
  const table = palettes ?? {};
  const normalized = requested.toLowerCase();
  const key = Object.keys(table).find(name => name.toLowerCase() === normalized);
  if (!key) {
    throw new Error(
      `Phase overlay palette "${requested}" is not available. `
      + `Available palettes: ${Object.keys(table).join(", ") || "<none>"}.`,
    );
  }
  return table[key];
}

function overlayModeFor(modeRegistry, settings, phase, colorContext) {
  if (settings === undefined) return null;
  const resolved = resolveSceneTransitionSettings({}, settings);
  if (!resolved.enabled) return null;
  const authored = resolved.modes[resolved.mode] ?? {};
  const colors = resolveOverlayColors({
    authored: authored.palette ?? null,
    compositionPalette: colorContext.compositionPalette,
    palettes: colorContext.palettes,
  });
  const mode = modeRegistry.createForPhase(
    resolved.mode,
    phase,
    {
      ...authored,
      colors,
      // An overlay draws over the composition, so what it has to paint out is
      // the canvas ground, which only the host knows.
      backgroundColor: authored.backgroundColor ?? colorContext.background,
    },
    `Phase overlay (${phase})`,
  );
  if (!modeDrawsOverlay(mode)) return null;
  // A mode that draws needs colors before its first frame, not at it.
  if (colors === null) {
    throw new Error(
      `Phase overlay (${phase}): mode "${resolved.mode}" draws content of its `
      + "own and has no palette. Author modes." + `${resolved.mode}.palette, or `
      + "give the composition a palette.",
    );
  }
  return { name: resolved.mode, mode };
}

/**
 * Build a driver for one composition, or return null when neither phase has
 * overlay content to draw.
 */
export function createPhaseOverlay({
  intro,
  outro,
  modeRegistry,
  longSideCells = null,
  palette = null,
  palettes = null,
  background = null,
}) {
  if (typeof modeRegistry?.createForPhase !== "function") return null;
  const colorContext = { compositionPalette: palette, palettes, background };
  const introEntry = overlayModeFor(modeRegistry, intro, "intro", colorContext);
  const outroEntry = overlayModeFor(
    modeRegistry,
    outro?.fallbackToIntro ? intro : (outro ?? intro),
    "outro",
    colorContext,
  );
  if (!introEntry && !outroEntry) return null;
  return new PhaseOverlay({
    intro: introEntry,
    outro: outroEntry,
    longSideCells,
  });
}
