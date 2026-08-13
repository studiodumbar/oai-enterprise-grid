// Conway's Game of Life
//
// Every generation is computed simultaneously from the eight neighboring
// parent cells. Edit the birth/survival arrays to explore other Life-like
// cellular automata while retaining the same circle-only visual grammar.
export const GAME_OF_LIFE_CONFIG = {
  settings: {
    gameOfLife: {
      longSideCells: 12,
      dotMargin: 0.08,
      palette: "green",
      cycleSeconds: 3,
      generationsPerCycle: 6,
      flipSeconds: 0.1,
      initialDensity: 0.034,
      birthNeighbors: [1, 3],
      survivalNeighbors: [2, 4],
      wrapEdges: false,
      birthFlicker: {
        enabled: true,
        speed: 3,
        spatialScale: 0.3,
        amount: 0.9,
        edgeFraction: 0.18,
      },
    },
  },

  generatorDefinitions: {
    gameOfLifeAutomaton: {
      type: "cellular-automata",
      settingsKey: "gameOfLife",
      strategy: "life-like",
    },
  },

  compositionDefinitions: {
    "game-of-life": {
      rule: "sequence",
      steps: [{ use: "gameOfLifeAutomaton" }],
    },
  },
};
