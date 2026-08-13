// Observe–Act Loop
//
// This composition represents tool-enabled operation: model work, a tool-call
// gateway, a white wait, an external observation, and assimilation. Its visual
// and timing controls are isolated here for easy tuning.
export const TOOL_LOOP_CONFIG = {
  settings: {
    toolLoop: {
      longSideCells: 20,
      dotMargin: 0.05,
      palette: "green",
      tokenSeconds: 6,
      layerPasses: 3,
      flipSeconds: 0.15,
      highDensityFlicker: {
        enabled: true,
        speed: 5,
        spatialScale: 12,
        amount: 1,
      },
    },
  },

  generatorDefinitions: {
    toolLoopGrid: {
      type: "inference-grid",
      settingsKey: "toolLoop",
      strategy: "tool-loop",
    },
  },

  compositionDefinitions: {
    "tool-loop": {
      rule: "sequence",
      steps: [{ use: "toolLoopGrid" }],
    },
  },
};
