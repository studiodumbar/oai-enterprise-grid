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
      //cycleSeconds: 6,
      generationsPerCycle: 12,
      flipSeconds: 0.015,
      initialDensity: 0.034,
      birthNeighbors: [1, 3],
      survivalNeighbors: [2, 4],
      wrapEdges: false,
      
      cellTransitions: {
        enabled: true, 
        durationSeconds: "auto",
          modes: {
            "sort-selection": {
                arcHeightInCells: 0.01
            },
          },
      },

      outro: {
        modes: {
            text: {
             revealFraction: 0.05,
               timingCurve: [1, 0.05, 0.38, 0]
           },

        },
      },


      flicker: {
        amount: 1,
        cellStaggerSeconds: 0.5,
        scope: "canvas",
        mode: "crt-glide",
        modes: { 
          "block-drop": {
            //cycleSeconds: 3, 
          },
          noise: {
            speed: 0.04,
            spatialScale: 0.003,
          },
          "radar-arc" : {
           beamWidth: 0.5, 
           gridSteps: 8,
           wakeWidth: 0.75
          },
          "echo-ring" : {
           //cycleSeconds: 2,
              ringCount: 10
          },
            "crt-glide": {
                //cycleSeconds: 1.4,
                rows: 80, 
                decay: 0.9
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
      rule: "sequence",
      steps: [{ use: "gameOfLifeAutomaton" }],
    },
  },
};
