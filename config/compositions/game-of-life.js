// Conway's Game of Life
//
// Every generation is computed simultaneously from the eight neighboring
// parent cells. Edit the birth/survival arrays to explore other Life-like
// cellular automata while retaining the same circle-only visual grammar.
export const GAME_OF_LIFE_CONFIG = {
  settings: {
    gameOfLife: {
      longSideCells: 8,
      dotMargin: 0.08,
      cycleSeconds: 3,
      generationsPerCycle: 6,
      flipSeconds: 0.015,
      initialDensity: 0.034,
      birthNeighbors: [1, 3],
      survivalNeighbors: [2, 4],
      wrapEdges: false,
      // Newly born cells flicker, fading in and out across each generation.
      flicker: {
        amount: 1,
        scope: "cell",
        modes: {
          noise: {
            speed: 3,
            spatialScale: 0.3,
          },
          "radar-arc" : {
           beamWidth: 0.5, 
           gridSteps: 8,
           wakeWidth: 0.75
          },
          "echo-ring" : {
           cycleSeconds: 2,
              ringCount: 110
          }
        },
        envelope: {
          edgeFraction: 0.18,
        },
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
