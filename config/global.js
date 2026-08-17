export const GLOBAL_CONFIG = {
  canvas: {
    background: "#000",
    maxPixelDensity: 3,
    frameRate: 60,
  },

  ui: {
    showExportPanel: false,
  },

  composition: {
    // flock,
    // base, // ok
    // interactive-grid,
    // inference-loop, // BUG: intro is weird
    // game-of-life
    // l-tree,
    // voronoi,
    // tool-loop,
    // context-window,
    active: "flock",
    // Endpoints use the composition's native intro/outro rule to rearrange
    // one centered parent cell. circleSubdivision is the child count per axis:
    startWithCircle: true,
    startWithCircleDurationSeconds: "auto", // "auto" or a duration
    endWithCircle: true,
    endWithCircleDurationSeconds: "auto", // "auto" or a duration
    circleSubdivision: 1, // 1, 2, 4, 8, or 16.
    // still a bit buggy
  },

  // app-wide palette, composition overrides it
  palette: "green",

  // Motion between discrete scene states. This runs inside the cycle; it is
  // independent from the intro/outro phases at the cycle boundaries.
  cellTransitions: {
    enabled: true,
    mode: "sort-selection",
    durationSeconds: 1, // should support auto option
    modes: {
      none: {
        baseKind: "circle",
      },
      "sort-selection": {
        seed: 13,
        revealFraction: 0.16,
        arcHeightInCells: 0.32,
        staggerSeconds: 0.02,
        timingCurve: [0.65, 0, 0.35, 1],
      },
    },
  },

  // App-wide cycle entrance. A composition can override any field by adding
  // its own `intro` block beside its palette/flicker settings.
  intro: {
    enabled: true,
    mode: "sort-selection",
    durationSeconds: 1,
    modes: {
      "sort-selection": {
        seed: 173,
        revealFraction: 0.6,
        arcHeightInCells: 0.32,
        staggerSeconds: 0.02,
        // CSS cubic-bezier control points: [x1, y1, x2, y2].
        timingCurve: [0.65, 0, 0.35, 1],
      },
    },
  },

  flicker: {
    enabled: true,
    // noise,
    // echo-ring,
    // strobe-stack,
    // block-drop,
    // prism-bloom,
    // crt-glide,
    // radar-arc
    mode: "echo-ring",
    scope: "canvas", // canvas, cell
    amount: 1,  // How far a flickering dot may travel from its base palette step.
    cellStaggerSeconds: 0.5,
    modes: {
      // Drifting clouds 
      "noise": {
        speed: 0.18,
        spatialScale: 0.28,
      },
      // diamond rings pulse outward 
      "echo-ring": {
        cycleSeconds: 1,
        ringDelayFraction: 0.14,
        echoDelayFraction: 0.03,
        ringCount: 5,
      },
      // Columns stack upward on a stagger 
      "strobe-stack": {
        cycleSeconds: 1.43,
        columns: 5,
        rows: 5,
        baseIntensity: 0.08,
      },
      // Frames drop and pile up 
      "block-drop": {
        cycleSeconds: 1.41,
        baseIntensity: 0.08,
      },
      // A kaleidoscope breathing out
      "prism-bloom": {
        cycleSeconds: 0.75,
        blendSeconds: 0.38,
        baseIntensity: 0.08,
      },
      // A scanline steps down the field, leaving a decaying trail
      "crt-glide": {
        cycleSeconds: 0.6,
        rows: 5,
        decay: 0.72,
        columnWarp: 0.07,
        baseIntensity: 0.08,
        peakIntensity: 1,
      },
      // A rotating arm sweeps the field
      "radar-arc": { // kinda looks like ass
        cycleSeconds: 1,
        gridSteps: 5,
        beamWidth: 0.55,
        wakeWidth: 1.15,
        ringInnerRadius: 1.6,
        ringOuterRadius: 1.8,
        baseIntensity: 0.4,
      },
    },
  },

  palettes: {
    violet: [
      "#cbafd9",
      "#7c5cad",
      "#7047a3",
      "#42276f",
    ],
    blue: ["#012a4f", "#00529d", "#2e7ec6", "#6db9e7"],
    lightBlue: ["#d4ebf7", "#a8ddf0", "#6db9e7", "#2e7ec6", "#0066b3"],
    justBlue: ["#2e7ec6", "#3a89ce", "#5aa0d9", "#7ab7e3", "#9aceee"],
    green: ["#00692a", "#00a240", "#04b84c", "#8cdfad"],
    thinking: ["#dce8e3", "#a7d1c2", "#10a37f", "#08745a", "#123b31"],
    orange: ["#762b0a", "#c73f13", "#ff6b00", "#ffb389"],
    mono: ["#303030", "#666666", "#aaaaaa", "#ffffff"],
  },
};
