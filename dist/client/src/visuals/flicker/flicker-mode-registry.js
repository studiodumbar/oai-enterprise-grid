// Registry of flicker modes.
//
// A flicker mode is the only part of flickering that changes between visual
// directions. It owns one field — the function that turns a dot position and a
// time into a normalized 0..1 intensity — plus the settings that field needs.
// Palette mapping, per-cell masks, and the envelope that fades flicker in and
// out stay shared, so any registered mode drops into any composition unchanged.
//
// A mode descriptor:
//
//   {
//     name: "noise",                     // stable id used by config
//     defaults: { ... },                 // mode-owned settings, frozen
//     distribution: "auto"|"rank"|"value"|"level",
//     normalize(settings) -> settings,   // throws on invalid authored values
//     createField({ settings, grid, noiseFunction }) -> field,
//   }
//
// A field:
//
//   {
//     sampleAt(x, y, time) -> 0..1,      // required; hot path, keep it cheap
//     resize?(grid),                     // { columns, rows, dotsPerCellAxis }
//     beginFrame?({ time, progress, cycleIndex }),
//   }
//
// Fields must be deterministic: the same arguments always return the same
// sample, so exported frames match the live canvas.
// How the renderer turns a field's samples into swatches:
//   auto  — rank-spread while a cell holds at least one dot per swatch, else value
//   rank  — always spread a cell's dots evenly across the palette by sample order
//   value — band the sample so a continuous field still revisits every swatch
//   level — treat the sample as brightness and map it straight onto the palette
const DISTRIBUTIONS = Object.freeze(["auto", "rank", "value", "level"]);

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

export class FlickerModeRegistry {
  constructor() {
    this.modes = new Map();
  }

  register(mode) {
    if (!mode || typeof mode !== "object") {
      throw new TypeError("A flicker mode must be an object descriptor.");
    }
    requireNonEmptyString(mode.name, "Flicker mode name");
    if (this.modes.has(mode.name)) {
      throw new Error(`Flicker mode "${mode.name}" is already registered.`);
    }
    if (typeof mode.createField !== "function") {
      throw new TypeError(`Flicker mode "${mode.name}" must provide createField().`);
    }
    if (mode.normalize != null && typeof mode.normalize !== "function") {
      throw new TypeError(`Flicker mode "${mode.name}" normalize must be a function.`);
    }
    if (mode.defaults != null && typeof mode.defaults !== "object") {
      throw new TypeError(`Flicker mode "${mode.name}" defaults must be an object.`);
    }
    const distribution = mode.distribution ?? "auto";
    if (!DISTRIBUTIONS.includes(distribution)) {
      throw new RangeError(
        `Flicker mode "${mode.name}" distribution must be one of `
        + `${DISTRIBUTIONS.join(", ")}.`,
      );
    }

    this.modes.set(mode.name, Object.freeze({
      ...mode,
      distribution,
      defaults: Object.freeze({ ...mode.defaults }),
    }));
    return this;
  }

  get(name) {
    requireNonEmptyString(name, "Flicker mode name");
    const mode = this.modes.get(name);
    if (!mode) throw new Error(this.unknownNameMessage(name));
    return mode;
  }

  has(name) {
    return typeof name === "string" && this.modes.has(name);
  }

  list() {
    return Array.from(this.modes.keys());
  }

  unknownNameMessage(name) {
    const available = this.list();
    const suffix = available.length > 0
      ? ` Available flicker modes: ${available.join(", ")}.`
      : " No flicker modes are registered.";
    return `Unknown flicker mode "${name}".${suffix}`;
  }
}

export default FlickerModeRegistry;
