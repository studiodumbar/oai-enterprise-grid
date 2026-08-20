// Debug channels.
//
// Every subsystem logs its STATE TRANSITIONS here — never per frame, never with
// a bare console.log. One line per event, stable key order, so two runs can be
// diffed. See AGENTS.md section 3 for the standing rule.
//
// Import-safe in node: nothing here touches window or document at module load.

/**
 * A channel's rate-limit policy:
 *   "change"   emit only when the formatted line differs from the previous one
 *   "always"   emit every call
 *   number N   emit at most once every N frames
 */
export const DEBUG_CHANNELS = Object.freeze({
  timeline: "change",
  transition: "change",
  plan: "change",
  cells: 30,
  draw: 60,
  config: "always",
  export: "always",
});

export const DEBUG_CHANNEL_NAMES = Object.freeze(Object.keys(DEBUG_CHANNELS));

function requireChannel(name) {
  if (!Object.hasOwn(DEBUG_CHANNELS, name)) {
    throw new Error(
      `Unknown debug channel "${name}". Available channels: ${DEBUG_CHANNEL_NAMES.join(", ")}.`,
    );
  }
  return name;
}

/**
 * Parse a channel selector: a comma/space separated list, or "all", or "" for
 * none. Unknown names throw so a typo in ?debug= is not silently ignored.
 */
export function parseDebugChannels(selector) {
  if (selector === undefined || selector === null) return [];
  if (typeof selector !== "string") {
    if (!Array.isArray(selector)) {
      throw new TypeError("Debug channel selector must be a string or an array.");
    }
    return selector.map(requireChannel);
  }
  const trimmed = selector.trim();
  if (trimmed === "") return [];
  if (trimmed === "all") return [...DEBUG_CHANNEL_NAMES];
  return trimmed
    .split(/[,\s]+/)
    .filter(part => part !== "")
    .map(requireChannel);
}

/**
 * Resolve which channels are on. A URL query wins over authored config so a
 * debugging session never requires editing a file.
 */
export function resolveDebugChannels({ search, config } = {}) {
  const fromQuery = typeof search === "string" && search !== ""
    ? new URLSearchParams(search).get("debug")
    : null;
  if (fromQuery !== null) return parseDebugChannels(fromQuery);
  return parseDebugChannels(config?.channels);
}

// %s string, %d integer, %f float, %.3f fixed precision, %j compact JSON.
const TOKEN = /%(?:\.(\d+))?([sdfj%])/g;

export function formatDebugLine(template, args) {
  let index = 0;
  return String(template).replace(TOKEN, (match, precision, kind) => {
    if (kind === "%") return "%";
    const value = args[index];
    index += 1;
    switch (kind) {
      case "d": return String(Math.trunc(Number(value)));
      case "f": return precision === undefined
        ? String(Number(value))
        : Number(value).toFixed(Number(precision));
      case "j": try {
        return JSON.stringify(value);
      } catch {
        return "<unserializable>";
      }
      default: return String(value);
    }
  });
}

function padFrame(frameIndex) {
  return String(Math.max(0, Math.trunc(frameIndex))).padStart(4, "0");
}

class DebugLog {
  constructor() {
    this.enabled = new Set();
    this.sink = line => console.log(line);
    this.frameIndex = 0;
    this.lastLine = new Map();
    this.lastFrame = new Map();
    // `on.<channel>` lets a hot path skip building arguments entirely.
    this.on = {};
    for (const name of DEBUG_CHANNEL_NAMES) {
      this.on[name] = false;
      this[name] = (template, ...args) => this.write(name, template, args);
    }
  }

  configure({ channels = [], sink } = {}) {
    this.enabled = new Set(parseDebugChannels(channels));
    for (const name of DEBUG_CHANNEL_NAMES) this.on[name] = this.enabled.has(name);
    if (sink !== undefined) this.setSink(sink);
    this.lastLine.clear();
    this.lastFrame.clear();
    return this;
  }

  setSink(sink) {
    if (typeof sink !== "function") {
      throw new TypeError("Debug sink must be a function.");
    }
    this.sink = sink;
    return this;
  }

  /** The host advances this once per frame so every line carries `f=NNNN`. */
  setFrame(frameIndex) {
    if (!Number.isFinite(frameIndex)) {
      throw new TypeError("Debug frame index must be a finite number.");
    }
    this.frameIndex = frameIndex;
    return this;
  }

  channels() {
    return [...this.enabled];
  }

  write(channel, template, args) {
    if (!this.enabled.has(channel)) return false;

    const body = formatDebugLine(template, args);
    const policy = DEBUG_CHANNELS[channel];

    if (policy === "change") {
      if (this.lastLine.get(channel) === body) return false;
      this.lastLine.set(channel, body);
    } else if (typeof policy === "number") {
      const previous = this.lastFrame.get(channel);
      if (previous !== undefined && this.frameIndex - previous < policy) return false;
      this.lastFrame.set(channel, this.frameIndex);
    }

    this.sink(`[cg:${channel}] f=${padFrame(this.frameIndex)} ${body}`);
    return true;
  }
}

export const debug = new DebugLog();

export function configureDebug(options) {
  return debug.configure(options);
}

export function setDebugSink(sink) {
  return debug.setSink(sink);
}

export function setDebugFrame(frameIndex) {
  return debug.setFrame(frameIndex);
}

/**
 * Collect every line a callback emits. Used by tests and the headless driver.
 * The capture is hermetic: it starts at frame 0 and restores the previous
 * channels, sink, and frame index, so one capture cannot perturb the next.
 */
export function captureDebug(channels, run) {
  const previousSink = debug.sink;
  const previousChannels = debug.channels();
  const previousFrame = debug.frameIndex;
  const lines = [];
  debug.configure({ channels, sink: line => lines.push(line) });
  debug.setFrame(0);
  try {
    run();
  } finally {
    debug.configure({ channels: previousChannels, sink: previousSink });
    debug.setFrame(previousFrame);
  }
  return lines;
}
