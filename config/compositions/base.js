// Flicker Preview Base
//
// Five cells cover every standard subdivision density: 1, 4, 16, 64, and
// 256 dots. Its authored flicker block inherits GLOBAL_CONFIG.flicker, then
// overrides only the local values below.
export const BASE_CONFIG = {
  settings: {
    base: {
      dotMargin: 0.07,
      flicker: {
        amount: 1,
        scope: "cell",
        modes: {
          "echo-ring": {
            //cycleSeconds: "calc(auto * 0.5)",
          },
        },
      },
    },
  },

  generatorDefinitions: {
    baseGrid: {
      type: "base-composition",
      settingsKey: "base",
    },
  },

  compositionDefinitions: {
    base: {
      timing: {
        bodyDurationSeconds: 2,
        beatCount: 4,
      },
      rule: "sequence",
      steps: [{ use: "baseGrid" }],
    },
  },
};
