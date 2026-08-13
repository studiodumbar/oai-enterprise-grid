// Observe–Act Loop
//
// This composition represents tool-enabled operation: model work, a tool-call
// gateway, a white wait, an external observation, and assimilation. Its visual
// and timing controls are isolated here for easy tuning.
export const TOOL_LOOP_CONFIG = {
  settings: {
    toolLoop: {
      longSideCells: 12,
      dotMargin: 0.05,
      tokenSeconds: 8,
      layerPasses: 4,
      flipSeconds: 0.15,
      // The dense 64-circle model field is the only region that flickers.
      flicker: {
        amount: 1,
        modes: {
          noise: {
            speed: 5,
            spatialScale: 12,
          },
        },
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
