// Conway's Game of Life
//
// Every generation is computed simultaneously from the eight neighboring
// parent cells. Edit the birth/survival arrays to explore other Life-like
// cellular automata while retaining the same circle-only visual grammar.
export const GAME_OF_LIFE_CONFIG = {
  settings: {
    gameOfLife: {
      longSideCells: 9,
      dotMargin: 0.08,
      flipSeconds: 0.015,
      initialDensity: 0.5,
      birthNeighbors: [1, 3],
      survivalNeighbors: [2, 4],
      wrapEdges: true,

      cellTransitions: {
        enabled: true,
        durationSeconds: "auto",
        modes: {
          "sort-selection": {
            arcHeightInCells: 0.8,
          },
        },
      },

      flicker: {
        amount: 1,
        cellStaggerSeconds: 0.5,
        scope: "canvas",
        mode: "noise",
        modes: {
          noise: {
            speed: 0.4,
            spatialScale: 0.03,
          },
          "radar-arc": {
            beamWidth: 0.5,
            gridSteps: 8,
            wakeWidth: 0.75,
          },
          "echo-ring": {
            ringCount: 10,
          },
          "crt-glide": {
            rows: 80,
            decay: 0.9,
          },
        },
        envelope: {
          edgeFraction: 0.15,
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
      timing: {
        bodyDurationSeconds: 24,
        beatCount: 12,
      },
      rule: "sequence",
      steps: [{ use: "gameOfLifeAutomaton" }],
    },
  },
};
