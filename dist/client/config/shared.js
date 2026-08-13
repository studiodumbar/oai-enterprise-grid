// Motion presets shared across composition families live here so their timing,
// curves, and hinge behavior are controlled in one place.
export const SHARED_CONFIG = {
  settings: {
    cellTransitions: {
      squarify: {
        animate: true,
        fromKind: "circle",
        toKind: "square",
        // Maximum useful value is just under half the 0.25 level interval.
        brightnessTransitionWidth: 0.24,
      },
      none: {
        baseKind: "circle",
      },
      flipDot: {
        animate: true,
        baseKind: "circle",
        axisDegrees: 0,
        direction: 1,
        reverseLevelOrder: false,
        brightnessTransitionWidth: 0.75,
        foldCurve: [0.42, 0, 0.58, 1],
        bounceCurve: [0.22, 0.72, 0.32, 1.18],
        projectionPower: 0.05,
        liftInDots: 0,
        hideSkippedThresholds: true,
        quantizePalette: true,
        paletteValues: [0, 0.333, 0.667, 1],
      },
    },
  },
};
