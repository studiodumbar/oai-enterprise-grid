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
      palette: "green",
      cycleSeconds: 3,
      generations: 4,
      flipSeconds: 0.032,
      layerFlicker: {
        enabled: true,
        speed: 25,
        spatialScale: 3,
        amount: 0.88,
        layerEdgeFraction: 0.5,
        terminalRampFraction: 0.94,
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
