// Inference Loop. The public `thinking` composition ID remains as a saved-URL
// alias; both recipes intentionally use the same configured generator.
export const INFERENCE_LOOP_CONFIG = {
  settings: {
    inferenceLoop: {
      longSideCells: 5,
      dotMargin: 0.02,
      tokenSeconds: 2.6,
      layerPasses: 4,
      flipSeconds: 0.016,
      },
  },

  generatorDefinitions: {
    inferenceLoopGrid: {
      type: "inference-grid",
      settingsKey: "inferenceLoop",
      strategy: "inference-loop",
    },
  },

  compositionDefinitions: {
    "inference-loop": {
      rule: "sequence",
      steps: [{ use: "inferenceLoopGrid" }],
    },

    thinking: {
      rule: "sequence",
      legacyAliasFor: "inference-loop",
      steps: [{ use: "inferenceLoopGrid" }],
    },
  },
};

export const THINKING_CONFIG = INFERENCE_LOOP_CONFIG;
