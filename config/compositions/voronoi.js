// Voronoi Influence Field
//
// Fixed grid cells become competing sites. Their territories re-weight in
// discrete passes, uncertain borders remain white, and one basin resolves to a
// committed output. These are schematic influence regions, not live telemetry.
export const VORONOI_CONFIG = {
  settings: {
    voronoi: {
      longSideCells: 12,
      dotMargin: 0.09,
      cycleSeconds: 24,
      partitionPasses: 4,
      flipSeconds: 0.28,
      siteCount: 13,
      // Practical ceiling is grid-dependent, not the 0.7 the validator allows:
      // at this density, above ~0.3 the boundary swallows every
      // territory interior and the region palette motion has nothing to animate.
      boundaryWhitespace: 0.45,
      // Voronoi owns its cycle boundary. It starts directly in the field and
      // ends through the composition-endpoint registry instead of inheriting
      // the global grow/crossfade circle.
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
            spatialScale: 0.012,
          },
          "echo-ring":{
            // cycleSeconds: 0.55
          },
          "strobe-stack":{
            //BUG: doesnt work with canvas
            // cycleSeconds: 1.5,
            columns: 8,
            rows: 8
          },
          "prism-bloom":{
            //cycleSeconds: .75 
          },
          "crt-glide":{
            // cycleSeconds: 1.5,
              rows: 10,
              decay: 0.09, 
              columnWrap: 3
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
      rule: "sequence",
      steps: [{ use: "voronoiGrid" }],
    },
  },
};
