import { FlickerPalette } from "./flicker-palette.js";
import { resolveFlickerSettings } from "./flicker-settings.js";

// The single object a generator talks to when it flickers dots. It owns the
// resolved settings, the active mode's field, and the shared palette mapping,
// so a generator never learns which mode is running and a mode never learns
// about palettes, cell masks, or envelopes.
export class FlickerController {
  constructor({
    palette,
    settings,
    modes,
    noiseFunction,
    grid,
    // One beat of the owning composition's timeline. A mode authored with
    // `cycleSeconds: "auto"` takes this length; without it, "auto" throws.
    autoCycleSeconds = null,
  }) {
    this.modeRegistry = modes;
    this.settings = resolveFlickerSettings(settings, modes, { autoCycleSeconds });
    this.palette = new FlickerPalette(palette);
    this.noiseFunction = noiseFunction;
    this.grid = grid ?? null;
    this.mode = null;
    this.field = null;
    this.useMode(this.settings.mode);
  }

  get enabled() {
    return this.settings.enabled;
  }

  get amount() {
    return this.settings.amount;
  }

  // "canvas" addresses the field across the whole board; "cell" restarts it
  // inside every cell. The mode never sees this — the renderer decides which
  // coordinates it hands to sampleAt.
  get scope() {
    return this.settings.scope;
  }

  get autoCycleSeconds() {
    return this.settings.autoCycleSeconds;
  }

  get cellStaggerSeconds() {
    return this.settings.cellStaggerSeconds;
  }

  get envelope() {
    return this.settings.envelope;
  }

  get distribution() {
    return this.mode.distribution;
  }

  get modeName() {
    return this.mode.name;
  }

  get paletteColors() {
    return this.palette.paletteColors;
  }

  availableModes() {
    return this.modeRegistry.list();
  }

  /**
   * Swap the active field. Settings for every registered mode were resolved up
   * front, so this cannot fail on authored values mid-composition.
   */
  useMode(name) {
    const mode = this.modeRegistry.get(name);
    const modeSettings = this.settings.modes[mode.name];
    this.mode = mode;
    this.field = mode.createField({
      settings: modeSettings,
      grid: this.grid,
      noiseFunction: this.noiseFunction,
    });
    if (typeof this.field?.sampleAt !== "function") {
      throw new TypeError(`Flicker mode "${mode.name}" field must provide sampleAt().`);
    }
    return this;
  }

  resize(grid) {
    this.grid = grid ?? null;
    this.field.resize?.(this.grid);
    return this;
  }

  beginFrame(frameState) {
    this.field.beginFrame?.(frameState);
    return this;
  }

  sampleAt(x, y, time) {
    return this.field.sampleAt(x, y, time);
  }

  baseColorAt(normalizedPosition) {
    return this.palette.baseColorAt(normalizedPosition);
  }

  /**
   * Whether the renderer should spread one cell's dots evenly across the
   * palette by sample order instead of mapping each dot's own sample.
   *
   * Rank spread re-normalizes a cell against itself, which is what a field with
   * no meaningful absolute level (noise) needs to reach every swatch. That makes
   * it a cell-scope operation: under canvas scope it would hand every cell the
   * same even spread wherever it sits in the board-wide pattern, erasing the
   * very structure canvas scope exists to show. Canvas scope always maps a dot's
   * own sample.
   */
  spreadsRankAcrossCell(glyphCount) {
    if (this.scope !== "cell") return false;
    if (this.distribution === "rank") return true;
    return this.distribution === "auto" && glyphCount >= this.paletteColors.length;
  }

  paletteIndexFromSample(basePosition, sample, amount = this.amount) {
    return this.palette.paletteIndexFromSample(basePosition, sample, amount);
  }

  colorFromSample(basePosition, sample, amount = this.amount) {
    return this.palette.colorFromSample(basePosition, sample, amount);
  }

  paletteIndexFromNoise(basePosition, sample, amount = this.amount) {
    return this.palette.paletteIndexFromNoise(basePosition, sample, amount);
  }

  colorFromNoise(basePosition, sample, amount = this.amount) {
    return this.palette.colorFromNoise(basePosition, sample, amount);
  }

  colorAt(basePosition, x, y, time) {
    return this.colorFromNoise(basePosition, this.sampleAt(x, y, time));
  }
}

export default FlickerController;
