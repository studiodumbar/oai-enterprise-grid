// Causal Horizon
//
// This composition keeps past context behind a causal frontier and future
// positions white. Tweak its grid density, timing, palette, and flip cadence
// here without affecting the other inference-grid compositions.
export const CONTEXT_WINDOW_CONFIG = {
  settings: {
    contextWindow: {
      longSideCells: 8,
      dotMargin: 0.07,
      palette: "green",
      tokenSeconds: 2.2,
      layerPasses: 8,
      flipSeconds: 0.016,
      finalSnapshotFlicker: {
        enabled: true,
        speed: 1.2,
        spatialScale: 0.2,
        amount: 1,
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
