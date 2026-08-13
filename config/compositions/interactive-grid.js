// Everything owned only by the interactive-grid composition family lives in
// this bundle: its visual settings, configured generator, and composition recipe.
export const INTERACTIVE_GRID_CONFIG = {
  settings: {
    interactiveGrid: {
      longSideCells: 5,
      dotMargin: 0.07,
      showCellGrid: false,
      colorCycleSeconds: 2,
      colorTransition: {
        // Dot-face motion used inside snake, diamond, and row patterns.
        // Every palette step independently rolls one pattern per parent cell;
        // waterfall traces color through stationary dots like a Connect Four drop.
        mode: "slide", // "slide" or "flip-dot".
        // Replay the chosen spatial pattern through a full palette lap, then
        // settle on the color that was normally scheduled next.
        cycleThroughPalette: false,
        noise: true,
        // Total time for the whole parent-cell pattern, including its stagger.
        durationSeconds: 0.25,
        // CSS cubic-bezier control points: [x1, y1, x2, y2].
        timingCurve: [1.0, 0.0, 0.0, 1],
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
      rule: "sequence",
      steps: [{ use: "interactiveGrid" }],
    },
  },
};
