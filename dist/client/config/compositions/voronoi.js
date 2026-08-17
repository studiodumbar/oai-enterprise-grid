// Voronoi Influence Field
//
// Fixed grid cells become competing sites. Their territories re-weight in
// discrete passes, uncertain borders remain white, and one basin resolves to a
// committed output. These are schematic influence regions, not live telemetry.
export const VORONOI_CONFIG = {
  settings: {
    voronoi: {
      longSideCells: 5,
      dotMargin: 0.09,
      cycleSeconds: 4,
      partitionPasses: 8,
      flipSeconds: 0.032,
      siteCount: 5,
      boundaryWhitespace: 0.99,
      flicker: {
        scope: "canvas",
        amount: 1,
        modes: {
          noise: {
            speed: 2,
            spatialScale: 0.8,
          },
          "echo-ring":{
            cycleSeconds: 0.55
          },
          "strobe-stack":{
            //BUG: doesnt work with canvas
            cycleSeconds: 1.25
          },
          "prism-bloom":{
            cycleSeconds: .75 
          },
          "crt-glide":{
            cycleSeconds: 1.5,
              rows: 25,
              decay: 0.1, 
              columnWrap: 0.3
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
