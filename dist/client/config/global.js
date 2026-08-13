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
    // interactive-grid,
    // inference-loop (or thinking),
    // game-of-life
    // l-tree,
    // voronoi,
    // tool-loop,
    // context-window,
    active: "tool-loop",
  },

  // app-wide palette, composition overrides it
  palette: "violet",

  flicker: {
    enabled: true,
    // noise, echo-ring, strobe-stack, block-drop, prism-bloom, crt-glide, radar-arc
    mode: "prism-bloom",
    scope: "cell", // canvas, cell
    amount: 0.55,  // How far a flickering dot may travel from its base palette step.
    cellStaggerSeconds: 0.9,
    modes: {
      // Drifting clouds 
      "noise": {
        speed: 0.18,
        spatialScale: 0.28,
      },
      // diamond rings pulse outward 
      "echo-ring": {
        cycleSeconds: .2,
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
        cycleSeconds: 1.36,
        blendSeconds: 0.18,
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
      "radar-arc": {
        cycleSeconds: 1.16,
        gridSteps: 5,
        beamWidth: 0.55,
        wakeWidth: 1.15,
        ringInnerRadius: 1.6,
        ringOuterRadius: 2.3,
        baseIntensity: 0.08,
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
    green: ["#005122", "#008a3a", "#00b63c", "#7fd3a5"],
    thinking: ["#dce8e3", "#a7d1c2", "#10a37f", "#08745a", "#123b31"],
    orange: ["#762b0a", "#c73f13", "#ff6b00", "#ffb389"],
    mono: ["#303030", "#666666", "#aaaaaa", "#ffffff"],
  },
};
