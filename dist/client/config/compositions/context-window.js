// Causal Horizon
//
// This composition keeps past context behind a causal frontier and future
// positions white. Tweak its grid density, timing, palette, and flip cadence
// here without affecting the other inference-grid compositions.
export const CONTEXT_WINDOW_CONFIG = {
  settings: {
    contextWindow: {
      longSideCells: 5,
      dotMargin: 0.07,
      tokenSeconds: 2,
      layerPasses: 2,
      flipSeconds: 0.015,
      // Only the final attention snapshot and the committed dot flicker.
      flicker: {
        amount: 1,
        scope: "cell",
        mode: "prism-bloom",
        modes: {
         noise: {
            speed: 2,
            spatialScale: 0.2,
         },
        "crt-glide": {
            cycleSeconds: .6,
         },
        "block-drop": {
            cycleSeconds: .6,
         },
        "prism-bloom": {
            cycleSeconds: 1.6,
         },
        "strobe-stack": {
            cycleSeconds: 1.2,
         },

        "echo-ring": {
            cycleSeconds: .6,
         },

        },
      },
    },
  },

  generatorDefinitions: {
    contextWindowGrid: {
      type: "inference-grid",
      settingsKey: "contextWindow",
      strategy: "context-window",
    },
  },

  compositionDefinitions: {
    "context-window": {
      rule: "sequence",
      steps: [{ use: "contextWindowGrid" }],
    },
  },
};
