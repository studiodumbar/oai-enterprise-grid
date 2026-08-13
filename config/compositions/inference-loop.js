// Inference Loop. The public `thinking` composition ID remains as a saved-URL
// alias; both recipes intentionally use the same configured generator.
export const INFERENCE_LOOP_CONFIG = {
  settings: {
    inferenceLoop: {
      longSideCells: 8,
      dotMargin: 0.02,
      palette: "green",
      tokenSeconds: 2.6,
      layerPasses: 8,
      flipSeconds: 0.016,
      candidateFlicker: {
        enabled: true,
        speed: 0.55,
        spatialScale: 0.24,
        amount: 0.9,
        leadFraction: 0.18,
        spreadFraction: 0.6,
        rampFraction: 0.22,
      },
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
