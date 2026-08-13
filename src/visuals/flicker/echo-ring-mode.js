import { cubicBezierAt } from "../../cell-transitions/flip-dot.js";

// Echo Ring, ported from the dot-matrix loader of the same name:
// matrix/public/r/dotm-square-11.tsx picks a dot's ring from its Manhattan
// distance to the grid center, and `.dmx-ripple-echo` in
// matrix/public/r/components/dotmatrix-loader.css delays each ring's pulse,
// giving odd rings a small extra lag so every ring trails a softer echo.
export const ECHO_RING_FLICKER_DEFAULTS = Object.freeze({
  // The loader runs a 1500 ms cycle at speed 1.25.
  cycleSeconds: 1.2,
  // Fractions of one cycle, straight from the loader's animation-delay.
  ringDelayFraction: 0.14,
  echoDelayFraction: 0.03,
  // How many diamond bands span the field, center to furthest corner. Ring width
  // is derived from the field the mode was given, so the same value reads the
  // same whether that field is the whole board or a single cell. The loader's
  // 5x5 matrix carries five bands.
  ringCount: 5,
});

// The loader's keyframes resolved against its opacity tokens
// (base 0.16, mid 0.32, peak 1): 0.625*base, 0.98*peak, mid, then
// 0.68*peak + 0.32*mid.
const ECHO_RING_KEYFRAMES = Object.freeze([
  Object.freeze({ at: 0, value: 0.1 }),
  Object.freeze({ at: 0.28, value: 0.98 }),
  Object.freeze({ at: 0.56, value: 0.32 }),
  Object.freeze({ at: 0.78, value: 0.7824 }),
  Object.freeze({ at: 1, value: 0.1 }),
]);

// CSS `ease-in-out`, applied between keyframes exactly as the loader does.
const EASE_IN_OUT = Object.freeze([0.42, 0, 0.58, 1]);

function requireFinite(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
}

function requireFraction(value, label) {
  requireFinite(value, label);
  if (value < 0 || value > 1) {
    throw new RangeError(`${label} must be between zero and one.`);
  }
}

/** One ring's pulse over its own cycle. Phase wraps, so a delay may exceed one. */
export function echoRingIntensityAt(phase) {
  requireFinite(phase, "phase");
  const position = phase - Math.floor(phase);
  for (let index = 1; index < ECHO_RING_KEYFRAMES.length; index += 1) {
    const to = ECHO_RING_KEYFRAMES[index];
    if (position > to.at) continue;
    const from = ECHO_RING_KEYFRAMES[index - 1];
    const span = to.at - from.at;
    const eased = cubicBezierAt(
      span === 0 ? 0 : (position - from.at) / span,
      EASE_IN_OUT,
    );
    return from.value + (to.value - from.value) * eased;
  }
  return ECHO_RING_KEYFRAMES[ECHO_RING_KEYFRAMES.length - 1].value;
}

export class EchoRingFlickerField {
  constructor(settings, grid) {
    this.settings = settings;
    this.resize(grid);
  }

  resize(grid) {
    // The field's center in the same finest-subdivision units sampleAt receives.
    // Under cell scope the renderer passes a one-cell grid, so this is the
    // cell's own center and the rings fit inside it.
    const dotsPerCellAxis = grid?.dotsPerCellAxis ?? 1;
    this.centerX = (grid?.columns ?? 1) * dotsPerCellAxis * 0.5;
    this.centerY = (grid?.rows ?? 1) * dotsPerCellAxis * 0.5;
    // Furthest Manhattan distance a dot can reach, so `ringCount` bands always
    // span the field instead of depending on its size in dots.
    this.maxManhattan = this.centerX + this.centerY;
    this.ringWidth = Math.max(
      Number.EPSILON,
      this.maxManhattan / this.settings.ringCount,
    );
  }

  ringAt(x, y) {
    const manhattan = Math.abs(x - this.centerX) + Math.abs(y - this.centerY);
    return Math.min(
      this.settings.ringCount - 1,
      Math.floor(manhattan / this.ringWidth),
    );
  }

  sampleAt(x, y, time) {
    requireFinite(x, "x");
    requireFinite(y, "y");
    requireFinite(time, "time");
    const {
      cycleSeconds,
      ringDelayFraction,
      echoDelayFraction,
    } = this.settings;
    const ring = this.ringAt(x, y);
    // Odd rings lag by the extra echo fraction, which is what separates the
    // secondary pulse from the leading ripple.
    const delay = ring * ringDelayFraction + (ring % 2) * echoDelayFraction;
    return echoRingIntensityAt(time / cycleSeconds - delay);
  }
}

export const ECHO_RING_FLICKER_MODE = Object.freeze({
  name: "echo-ring",
  defaults: ECHO_RING_FLICKER_DEFAULTS,
  // A ripple's sample is its brightness, so it maps straight onto the palette
  // instead of being spread across it by rank.
  distribution: "level",

  normalize(settings) {
    const normalized = { ...ECHO_RING_FLICKER_DEFAULTS, ...settings };
    requireFinite(normalized.cycleSeconds, "cycleSeconds");
    if (normalized.cycleSeconds <= 0) {
      throw new RangeError("cycleSeconds must be greater than zero.");
    }
    requireFraction(normalized.ringDelayFraction, "ringDelayFraction");
    requireFraction(normalized.echoDelayFraction, "echoDelayFraction");
    if (!Number.isInteger(normalized.ringCount) || normalized.ringCount < 1) {
      throw new RangeError("ringCount must be an integer of at least one.");
    }
    return normalized;
  },

  createField({ settings, grid }) {
    return new EchoRingFlickerField(settings, grid);
  },
});

export default ECHO_RING_FLICKER_MODE;
