// Everything owned only by the interactive-grid composition family lives in
// this bundle: its visual settings, configured generator, and composition recipe.
export const INTERACTIVE_GRID_CONFIG = {
  settings: {
    interactiveGrid: {
      longSideCells: 5,
      dotMargin: 0.07,
      showCellGrid: false,
      // palette: "green",
      // colorCycleSeconds: 2, // Must match timing.bodyDurationSeconds.

      // Composition-boundary endpoint controls.
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

      // Intro/outro modes: fade or text. Both accept "auto" durations.
      // intro: {
      //   enabled: true,
      //   mode: "text",
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

      colorTransition: {
        // Dot-face motion used inside snake, diamond, and row patterns.
        // Every palette step independently rolls one pattern per parent cell;
        // waterfall traces color through stationary dots like a Connect Four drop.
        mode: "slide",
        // Replay the chosen spatial pattern through a full palette lap, then
        // settle on the color that was normally scheduled next.
        cycleThroughPalette: false,
        noise: true,
        // Total time for the whole parent-cell pattern, including its stagger.
        durationSeconds: "auto",
        // CSS cubic-bezier control points: [x1, y1, x2, y2].
        timingCurve: [1.0, 0.0, 0.0, 1],
      },

      // Press F while hovering a parent cell to opt only that cell into the
      // app-wide flicker mode. All cells start with flicker switched off.
      flicker: {
        enabled: true,
      },
    },
  },

  generatorDefinitions: {
    interactiveGrid: {
      type: "interactive-grid",
      settingsKey: "interactiveGrid",
    },
  },

  compositionDefinitions: {
    "interactive-grid": {
      timing: {
        bodyDurationSeconds: 2,
        // The current five-color palette makes one beat one palette step.
        beatCount: 5,
      },
      rule: "sequence",
      steps: [{ use: "interactiveGrid" }],
    },
  },
};
