// Registry of noise field modes.
//
// A noise field mode is the only part of a layered noise grid that changes
// between visual directions. It owns one generator — the function that turns a
// point in field space into a normalized 0..1 value — plus the settings that
// generator needs. The contrast curve, the level reduction, the palette snap
// and the visibility verdict stay shared, so any registered mode drops into any
// of the four layers unchanged.
//
// A mode descriptor:
//
//   {
//     name: "value",                     // stable id used by config
//     defaults: { ... },                 // mode-owned settings, frozen
//     loopable: true,                    // can it close a seamless loop?
//     normalize(settings) -> settings,   // throws on invalid authored values
//     createField({ settings, loopPeriod, seed }) -> field,
//   }
//
// A field:
//
//   {
//     sampleAt(x, y, z) -> 0..1,         // required; hot path, keep it cheap
//   }
//
// `loopPeriod` is the number of z units one composition loop traverses, or
// `null` when the layer is stationary or uses free `speed` drift. A mode that
// declares `loopable: false` is refused at startup for non-zero loop cycles rather than
// silently producing a field that jumps at the seam — a discontinuity of about
// 1.0 on a 0..1 field, which reads as the whole grid reshuffling on one frame.
//
// Fields must be deterministic and free of p5: the same arguments always return
// the same sample, in the browser and under `node --test` alike.
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

export class NoiseFieldModeRegistry {
  constructor() {
    this.modes = new Map();
  }

  register(mode) {
    if (!mode || typeof mode !== "object") {
      throw new TypeError("A noise field mode must be an object descriptor.");
    }
    requireNonEmptyString(mode.name, "Noise field mode name");
    if (this.modes.has(mode.name)) {
      throw new Error(`Noise field mode "${mode.name}" is already registered.`);
    }
    if (typeof mode.createField !== "function") {
      throw new TypeError(
        `Noise field mode "${mode.name}" must provide createField().`,
      );
    }
    if (mode.normalize != null && typeof mode.normalize !== "function") {
      throw new TypeError(
        `Noise field mode "${mode.name}" normalize must be a function.`,
      );
    }
    if (mode.defaults != null && typeof mode.defaults !== "object") {
      throw new TypeError(
        `Noise field mode "${mode.name}" defaults must be an object.`,
      );
    }
    if (typeof mode.loopable !== "boolean") {
      throw new TypeError(
        `Noise field mode "${mode.name}" must declare loopable as a boolean.`,
      );
    }
    if (!Number.isInteger(mode.minimumLoopCycles) || mode.minimumLoopCycles < 0) {
      throw new TypeError(
        `Noise field mode "${mode.name}" must declare a non-negative minimumLoopCycles.`,
      );
    }
    if (!['supported', 'unsupported'].includes(mode.shaderMode)) {
      throw new TypeError(
        `Noise field mode "${mode.name}" must declare shaderMode as supported or unsupported.`,
      );
    }

    this.modes.set(mode.name, Object.freeze({
      ...mode,
      defaults: Object.freeze({ ...mode.defaults }),
    }));
    return this;
  }

  get(name) {
    requireNonEmptyString(name, "Noise field mode name");
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

  // A layer that loops can only use a mode that can close the seam. The refusal
  // names the modes that can, so the fix is visible in the error itself.
  requireLoopable(name) {
    const mode = this.get(name);
    if (!mode.loopable) {
      const loopable = this.list().filter(other => this.get(other).loopable);
      throw new Error(
        `Noise field mode "${name}" cannot close a seamless loop. Set `
        + "cyclesPerLoop to 0 and optionally use speed for documented free drift, "
        + "or use one of: "
        + `${loopable.join(", ") || "<none>"}.`,
      );
    }
    return mode;
  }

  unknownNameMessage(name) {
    const available = this.list();
    const suffix = available.length > 0
      ? ` Available noise field modes: ${available.join(", ")}.`
      : " No noise field modes are registered.";
    return `Unknown noise field mode "${name}".${suffix}`;
  }
}
