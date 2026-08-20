// Observe–Act Loop
//
// This composition represents tool-enabled operation: model work, a tool-call
// gateway, a white wait, an external observation, and assimilation. Its visual
// and timing controls are isolated here for easy tuning.
export const TOOL_LOOP_CONFIG = {
  settings: {
    toolLoop: {
      longSideCells: 8,
      dotMargin: 0.05,
      flipSeconds: 0.05,
      // The dense 64-circle model field is the only region that flickers.
      flicker: {
        scope: "cell",
        amount: 1,
        modes: {
          noise: {
            speed: 5,
            spatialScale: 12,
          },
          "prism-bloom": {
            cycleSeconds: "calc(auto * 0.375)",
          },
          "block-drop": {
            cycleSeconds: "calc(auto * 0.225)",
          },
          "crt-glide": {
            cycleSeconds: "calc(auto * 0.225)",
            rows: 15,
          },
          "echo-ring": {
            cycleSeconds: "calc(auto * 0.225)",
          },
        },
      },
      intro: {
        enabled: true,
        mode: "text",
        //durationSeconds: "calc(auto * 0.5)",
        modes: {
          fade: {
            revealFraction: 0.5,
            // CSS cubic-bezier control points: [x1, y1, x2, y2].
            timingCurve: [0.42, 0, 0.58, 1],
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
      timing: {
        bodyDurationSeconds: 4,
        beatCount: 2,
      },
      rule: "sequence",
      steps: [{ use: "toolLoopGrid" }],
    },
  },
};
