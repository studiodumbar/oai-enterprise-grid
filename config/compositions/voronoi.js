// Voronoi Influence Field
//
// Fixed grid cells become competing sites. Their territories re-weight in
// discrete passes, uncertain borders remain white, and each territory retains
// one far-edge source after consensus. These are schematic influence regions,
// not live telemetry.
export const VORONOI_CONFIG = {
  settings: {
    voronoi: {
      longSideCells: 6,
      dotMargin: 0.09,
      flipSeconds: 0.28,
      // One terminal Dijkstra source is retained per territory.
      siteCount: 16,
      // Practical ceiling is grid-dependent, not the 0.7 the validator allows:
      // at this density, above ~0.3 the boundary swallows every
      // territory interior and the region palette motion has nothing to animate.
      boundaryWhitespace: 0.45,
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
        mode: "prism-bloom",
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
      timing: {
        bodyDurationSeconds: 8,
        beatCount: 4,
      },
      rule: "sequence",
      steps: [{ use: "voronoiGrid" }],
    },
  },
};
