// Flicker Preview Base
//
// Five cells cover every standard subdivision density: 1, 4, 16, 64, and
// 256 dots. Its authored flicker block inherits GLOBAL_CONFIG.flicker, then
// overrides only the local values below.
export const BASE_CONFIG = {
  settings: {
    base: {
      dotMargin: 0.07,
      previewSeconds: 2,
      previewRepeats: 3,
      flicker: {
        amount: 1,
        scope: "cell",
        modes: {
          "echo-ring": {
              cycleSeconds: 1,
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
      rule: "sequence",
      steps: [{ use: "baseGrid" }],
    },
  },
};
