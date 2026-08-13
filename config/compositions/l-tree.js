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
      cycleSeconds: 3,
      generations: 4,
      flipSeconds: 0.032,
      // The growing layer flickers, then the surviving route ramps up.
      flicker: {
        amount: 0.88,
        modes: {
          noise: {
            speed: 25,
            spatialScale: 3,
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
      rule: "sequence",
      steps: [{ use: "lTreeGrid" }],
    },
  },
};
