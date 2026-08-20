// Inference Loop. The public `thinking` composition ID remains as a saved-URL
// alias; both recipes intentionally use the same configured generator.
export const INFERENCE_LOOP_CONFIG = {
  settings: {
    inferenceLoop: {
      longSideCells: 5,
      dotMargin: 0.02,
      flipSeconds: 0.016,
      // Flicker starts on the selected candidate and follows outward. The
      // envelope fractions are this composition's own timing; app-wide flicker
      // defaults live in config/global.js.
      flicker: {
        amount: 0.9,
        modes: {
          noise: {
            speed: 0.55,
            spatialScale: 0.24,
          },
        },
        envelope: {
          leadFraction: 0.18,
          spreadFraction: 0.6,
          rampFraction: 0.22,
        },
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
      timing: {
        bodyDurationSeconds: 2.6,
        beatCount: 4,
      },
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
