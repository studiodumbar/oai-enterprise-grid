// Causal Horizon
//
// This composition keeps past context behind a causal frontier and future
// positions white. Tweak its grid density, timing, palette, and flip cadence
// here without affecting the other inference-grid compositions.
export const CONTEXT_WINDOW_CONFIG = {
  settings: {
    contextWindow: {
      longSideCells: 12,
      dotMargin: 0.07,
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
            cycleSeconds: "calc(auto * 0.6)",
          },
          "block-drop": {
            cycleSeconds: "calc(auto * 0.6)",
          },
          "prism-bloom": {
            cycleSeconds: "calc(auto * 1.6)",
          },
          "strobe-stack": {
            cycleSeconds: "calc(auto * 1.2)",
          },
          "echo-ring": {
            cycleSeconds: "calc(auto * 0.6)",
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
      timing: {
        bodyDurationSeconds: 8,
        beatCount: 4,
      },
      rule: "sequence",
      steps: [{ use: "contextWindowGrid" }],
    },
  },
};
