// L-Tree Branch and Prune
//
// A recursive candidate tree grows along the canvas's long axis, snaps through
// two pruning faces, and resolves to one terminal output. The branches are an
// operational metaphor, not a transcript of hidden reasoning.
export const L_TREE_CONFIG = {
  settings: {
    lTree: {
      longSideCells: 8,
      dotMargin: 0.08,
      flipSeconds: 0.015,
      // The growing layer flickers, then the surviving route ramps up.
      flicker: {
        amount: 0.88,
        modes: {
          noise: {
            speed: 25,
            spatialScale: 3,
          },
          "prism-bloom": {
            cycleSeconds: "calc(auto * 1.4705882352941178)",
            blendSeconds: 0.75,
          },
          "strobe-stack": {
            cycleSeconds: "calc(auto * 0.5882352941176471)",
          },
          "echo-ring": {
            cycleSeconds: "calc(auto * 0.8823529411764706)",
          },
        },
        envelope: {
          layerEdgeFraction: 0.5,
          terminalRampFraction: 0.94,
        },
      },
    },
  },

  generatorDefinitions: {
    lTreeGrid: {
      type: "procedural-topology",
      settingsKey: "lTree",
      strategy: "l-tree",
    },
  },

  compositionDefinitions: {
    "l-tree": {
      timing: {
        bodyDurationSeconds: 3.4,
        beatCount: 4,
      },
      rule: "sequence",
      steps: [{ use: "lTreeGrid" }],
    },
  },
};
