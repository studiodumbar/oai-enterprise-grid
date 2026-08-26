// Voronoi Influence Field
//
// Fixed grid cells become competing sites. Their territories re-weight in
// discrete passes, uncertain borders remain white, and each territory retains
// one far-edge source after consensus. These are schematic influence regions,
// not live telemetry.
export const VORONOI_CONFIG = {
  settings: {
    voronoi: {
      longSideCells: 12,
      dotMargin: 0.12,
      flipSeconds: 0.28,
      // One terminal Dijkstra source is retained per territory.
      siteCount: 8,
      // Practical ceiling is grid-dependent, not the 0.7 the validator allows:
      // at this density, above ~0.3 the boundary swallows every
      // territory interior and the region palette motion has nothing to animate.
      boundaryWhitespace: 0.6,

      // All inherited controls are listed here. Merge individual uncommented
      // keys into an active block of the same name when this composition has one.
      // palette: "green",
      // circleEndpoints: {
      //   circleSubdivision: 1, // Native endpoint only: 1, 2, 4, 8, or 16.
      //   start: { enabled: true, durationSeconds: "auto", mode: "native" },
      //   end: { enabled: true, durationSeconds: "auto", mode: "dijkstra" },
      //   modes: {
      //     dijkstra: {
      //       pathFraction: 0.4,
      //       blinkFraction: 0.2,
      //       centerHoldFraction: 0.1,
      //       blinkCount: 2,
      //       trailLength: 1,
      //       maximumLevel: 3,
      //       paletteStep: 3,
      //       cleanupAcceleration: 2,
      //       foreignTerritoryCost: 3,
      //     },
      //   },
      // },
       cellTransitions: {
         enabled: true,
         mode: "aurora", // none, fade, sort-selection, or aurora
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
             overlapDots: false,
             directions: ["top-down", "bottom-up"],
             staggerSeconds: 0,
             timingCurve: [0.65, 0, 0.35, 1],
             waveAmplitudeInCells: 1.15,
             waveCycles: 1.5,
             beamLengthInCells: 2.5,
           },
         },
       },
      // intro: {
      //   enabled: true,
      //   mode: "text", // fade or text
      //   durationSeconds: "auto",
      //   modes: {
      //     fade: { revealFraction: 0.5, timingCurve: [0.42, 0, 0.58, 1] },
      //     text: {
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
      //       colorBy: "level", // level or dot
      //       textColor: null,
      //     },
      //   },
      // },
      // outro: {
      //   enabled: true,
      //   mode: "text",
      //   durationSeconds: "auto",
      //   // modes accepts the complete fade/text controls shown under intro.
      // },
       flicker: {
         enabled: true,
         mode: "noise", // noise, echo-ring, strobe-stack, block-drop,
      //   // prism-bloom, crt-glide, or radar-arc
         scope: "canvas", // canvas or cell
         amount: 0.55,
         cellStaggerSeconds: 0.9,
         modes: {
           noise: { speed: 0.18, spatialScale: 0.28 },
           "echo-ring": {
             cycleSeconds: "auto",
             ringDelayFraction: 0.14,
             echoDelayFraction: 0.03,
             ringCount: 5,
           },
           "strobe-stack": {
             cycleSeconds: "auto",
             columns: 5,
             rows: 5,
             baseIntensity: 0.08,
           },
      //     "block-drop": { cycleSeconds: "auto", baseIntensity: 0.08 },
           "prism-bloom": {
             cycleSeconds: "auto",
             blendSeconds: 0.18,
             baseIntensity: 0.08,
           },
           "crt-glide": {
             cycleSeconds: "auto",
             rows: 5,
             decay: 0.72,
             columnWarp: 0.07,
             baseIntensity: 0.08,
             peakIntensity: 1,
           },
           "radar-arc": {
             cycleSeconds: "auto",
             gridSteps: 5,
             beamWidth: 0.55,
             wakeWidth: 1.15,
             ringInnerRadius: 1.6,
             ringOuterRadius: 2.3,
             baseIntensity: 0.08,
           },
         },
      //   // envelope is strategy-owned; its complete keys are active below
      //   // when this composition supports an envelope.
       },
      // Voronoi owns its cycle boundary. Its commit/settle body window animates
      // loaders at the fixed far-edge sources; Dijkstra takes over exclusively
      // at the outro boundary instead of sharing that phase with text.
      circleEndpoints: {
        start: {
          enabled: true,
        },
        end: {
          enabled: true,
          durationSeconds: 2,
          mode: "dijkstra",
        },
        modes: {
          dijkstra: {
            pathFraction: 0.2,
            blinkFraction: 0.06,
            centerHoldFraction: 0.008,
            blinkCount: 6,
            trailLength: 0.6,
            maximumLevel: 3,
            paletteStep: 4,
            cleanupAcceleration: 4,
            foreignTerritoryCost: 1,
          },
        },
      },
      intro: {
        enabled: true,
      },
      outro: {
        enabled: true,
      },
      flicker: {
        scope: "canvas",
        amount: 1,
        mode: "noise",
        modes: {
          noise: {
            speed: 0.3,
            spatialScale: 0.092,
          },
          "echo-ring":{
            // cycleSeconds: 0.55
          },
          "strobe-stack":{
            //BUG: doesnt work with canvas
            cycleSeconds: .5,
            columns: 5*64,
            rows: 5*64
          },
          "prism-bloom":{
            //cycleSeconds: .75 
          },
          "crt-glide":{
            // cycleSeconds: 1.5,
              rows: 10,
              decay: 0.09, 
              columnWarp: 3
          },
        },
      },
    },
  },

  generatorDefinitions: {
    voronoiGrid: {
      type: "procedural-topology",
      settingsKey: "voronoi",
      strategy: "voronoi",
    },
  },

  compositionDefinitions: {
    voronoi: {
      timing: {
        bodyDurationSeconds: 8,
        beatCount: 4,
      },
      rule: "sequence",
      steps: [{ use: "voronoiGrid" }],
    },
  },
};
