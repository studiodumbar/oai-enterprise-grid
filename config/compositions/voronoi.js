// Voronoi Influence Field
//
// Fixed grid cells become competing sites. Their territories re-weight in
// discrete passes, uncertain borders remain white, and one basin resolves to a
// committed output. These are schematic influence regions, not live telemetry.
export const VORONOI_CONFIG = {
  settings: {
    voronoi: {
      longSideCells: 8,
      dotMargin: 0.06,
      cycleSeconds: 4,
      partitionPasses: 2,
      flipSeconds: 0.032,
      siteCount: 5,
      boundaryWhitespace: 0.08,
      // Territory interiors flicker; the uncertain boundary stays white.
      flicker: {
        amount: 0.3,
        modes: {
          noise: {
            speed: 2,
            spatialScale: 0.8,
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
