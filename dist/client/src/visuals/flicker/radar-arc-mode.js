import {
  FieldGeometry,
  cyclePhaseAt,
  requireFinitePositive,
  requireFraction,
  requireStepCount,
} from "./field-geometry.js";

// Radar Arc, ported from matrix/public/r/dotm-circular-4.tsx. An arm rotates
// around the field with a bright beam front, a soft wake beside it, and a faint
// perimeter ring echo. Unlike the other ports this one runs on a continuous
// phase, so the arm sweeps rather than stepping.
export const RADAR_ARC_FLICKER_DEFAULTS = Object.freeze({
  // The loader runs an 1800 ms cycle at speed 1.55.
  cycleSeconds: 1.16,
  // Virtual grid the loader's distance thresholds are expressed in: a 5x5 matrix
  // spans -2..2 from its center.
  gridSteps: 5,
  // Half-width of the bright beam and of the softer wake beside it.
  beamWidth: 0.55,
  wakeWidth: 1.15,
  // The perimeter band that echoes behind the sweep.
  ringInnerRadius: 1.6,
  ringOuterRadius: 2.3,
  baseIntensity: 0.08,
});

// The loader's levels for the hub, the beam, its wake, and the ring echo.
const HUB_INTENSITY = 0.62;
const BEAM_INTENSITY = 0.96;
const WAKE_INTENSITY = 0.36;
const RING_INTENSITY = 0.22;
// The loader only lights dots ahead of the arm, not behind it.
const BEAM_LEAD = 0.3;
const HUB_RADIUS = 0.5;
const TAU = Math.PI * 2;

export class RadarArcFlickerField {
  constructor(settings, grid) {
    this.settings = settings;
    this.geometry = new FieldGeometry(grid);
  }

  resize(grid) {
    this.geometry.resize(grid);
  }

  sampleAt(x, y, time) {
    const {
      cycleSeconds,
      gridSteps,
      beamWidth,
      wakeWidth,
      ringInnerRadius,
      ringOuterRadius,
      baseIntensity,
    } = this.settings;
    const centeredX = this.geometry.centeredX(x, gridSteps);
    const centeredY = this.geometry.centeredY(y, gridSteps);
    const radius = Math.hypot(centeredX, centeredY);
    if (radius < HUB_RADIUS) return HUB_INTENSITY;

    const theta = cyclePhaseAt(time, cycleSeconds) * TAU;
    const sweepX = Math.cos(theta);
    const sweepY = Math.sin(theta);
    // Distance along the arm, and distance out to its side.
    const projection = centeredX * sweepX + centeredY * sweepY;
    const perpendicular = Math.abs(centeredX * sweepY - centeredY * sweepX);

    if (projection > BEAM_LEAD && perpendicular < beamWidth) return BEAM_INTENSITY;
    if (projection > 0 && perpendicular < wakeWidth) return WAKE_INTENSITY;
    if (radius > ringInnerRadius && radius < ringOuterRadius) return RING_INTENSITY;
    return baseIntensity;
  }
}

export const RADAR_ARC_FLICKER_MODE = Object.freeze({
  name: "radar-arc",
  defaults: RADAR_ARC_FLICKER_DEFAULTS,
  distribution: "level",

  normalize(settings) {
    const normalized = { ...RADAR_ARC_FLICKER_DEFAULTS, ...settings };
    requireFinitePositive(normalized.cycleSeconds, "cycleSeconds");
    requireStepCount(normalized.gridSteps, "gridSteps");
    requireFinitePositive(normalized.beamWidth, "beamWidth");
    requireFinitePositive(normalized.wakeWidth, "wakeWidth");
    if (normalized.wakeWidth < normalized.beamWidth) {
      throw new RangeError("wakeWidth must be greater than or equal to beamWidth.");
    }
    requireFinitePositive(normalized.ringInnerRadius, "ringInnerRadius");
    requireFinitePositive(normalized.ringOuterRadius, "ringOuterRadius");
    if (normalized.ringOuterRadius <= normalized.ringInnerRadius) {
      throw new RangeError("ringOuterRadius must be greater than ringInnerRadius.");
    }
    requireFraction(normalized.baseIntensity, "baseIntensity");
    return normalized;
  },

  createField({ settings, grid }) {
    return new RadarArcFlickerField(settings, grid);
  },
});

export default RADAR_ARC_FLICKER_MODE;
