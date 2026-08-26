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
      // palette: "green",

      // The settle scene cuts to this source cell; only Dijkstra moves it.
      circleEndpoints: {
        // circleSubdivision: 1, // Native endpoint only: 1, 2, 4, 8, or 16.
        // start: {
        //   enabled: true,
        //   durationSeconds: "auto",
        //   mode: "native",
        // },
        end: {
          enabled: true,
          durationSeconds: "auto",
          mode: "dijkstra",
        },
        // modes: {
        //   dijkstra: {
        //     pathFraction: 0.4,
        //     blinkFraction: 0.2,
        //     centerHoldFraction: 0.1,
        //     blinkCount: 2,
        //     trailLength: 1,
        //     maximumLevel: 3,
        //     paletteStep: 3,
        //     cleanupAcceleration: 2,
        //     foreignTerritoryCost: 3,
        //   },
        // },
      },

      // Modes: none, fade, sort-selection, aurora.
       cellTransitions: {
         enabled: true,
         mode: "aurora",
         durationSeconds: "auto",
         modes: {
           none: { baseKind: "circle" },
           fade: { revealFraction: 0.5, timingCurve: [0.42, 0, 0.58, 1] },
           "sort-selection": {
             seed: 173,
             revealFraction: 0.16,
             arcHeightInCells: 0.32,
             overlapDots: false,
             directions: ["top-down", "bottom-up"],
             staggerSeconds: 0,
             timingCurve: [0.65, 0, 0.35, 1],
           },
           aurora: {
             seed: 173,
             revealFraction: 0.16,
             arcHeightInCells: 0.32,
             overlapDots: true,
             directions: ["top-down", "bottom-up"],
             staggerSeconds: 0.05,
             timingCurve: [0.65, 0, 0.35, 1],
             waveAmplitudeInCells: 2,
             waveCycles: 1,
             beamLengthInCells: .05,
           },
         },
       },

       intro: {
         enabled: true,
         mode: "text",
         durationSeconds: "auto",
         modes: {
           fade: { revealFraction: 0.5, timingCurve: [0.42, 0, 0.58, 1] },
           text: {
      //       text: "TEXT",
      //       fontFamily: "'OpenAI Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif",
      //       fontWeight: 700,
      //       sizeInCells: 1.5,
      //       offsetX: 0,
      //       offsetY: 0,
      //       visibleSeconds: "auto",
      //       colorDrift: 1,
      //       backgroundColor: null,
      //       levels: 4,
      //       longSideCells: 5,
      //       dotMargin: 0.08,
      //       palette: null,
             colorBy: "level", // level or dot
      //       textColor: null,
           },
         },
       },
       outro: {
         enabled: true,
         mode: "text",
         durationSeconds: "calc(auto * 0.25)",
         modes: {
           fade: { revealFraction: 0.05, timingCurve: [0.42, 0, 0.58, 1] },
           text: {
      //       text: "TEXT",
      //       fontFamily: "'OpenAI Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif",
      //       fontWeight: 700,
             sizeInCells: 1.5,
      //       offsetX: 0,
      //       offsetY: 0,
      //       visibleSeconds: "auto",
      //       colorDrift: 1,
      //       backgroundColor: null,
             levels: 4,
             longSideCells: 5,
      //       dotMargin: 0.08,
      //       palette: null,
      //       colorBy: "level",
      //       textColor: null,
           },
         },
       },

      flicker: {
         enabled: true,
        amount: 1,
        cellStaggerSeconds: 0.05,
        scope: "canvas",
        mode: "prism-bloom",
        modes: {
          noise: {
            speed: 1,
            spatialScale: 3,
          },
          "prism-bloom": {
            cycleSeconds: "calc(auto * 0.125)",
            blendSeconds: 0.75,
            // baseIntensity: 0.08,
          },
          "strobe-stack": {
            cycleSeconds: "calc(auto * 0.5882352941176471)",
             columns: 5,
             rows: 5,
             baseIntensity: 0.08,
          },
          "echo-ring": {
            cycleSeconds: "calc(auto * 0.8823529411764706)",
             ringDelayFraction: 0.14,
             echoDelayFraction: 0.03,
             ringCount: 5,
          },
           "block-drop": { cycleSeconds: "auto", baseIntensity: 0.08 },
           "crt-glide": {
             cycleSeconds: "auto",
             rows: 5,
             decay: 0.72,
             columnWarp: 0.07,
          //   baseIntensity: 0.08,
          //   peakIntensity: 1,
           },
           "radar-arc": {
             cycleSeconds: "auto",
             gridSteps: 5,
             beamWidth: 0.55,
             wakeWidth: 1.15,
          //   ringInnerRadius: 1.6,
          //   ringOuterRadius: 2.3,
          //   baseIntensity: 0.08,
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
        bodyDurationSeconds: 12,
        beatCount: 4,
      },
      rule: "sequence",
      steps: [{ use: "lTreeGrid" }],
    },
  },
};
