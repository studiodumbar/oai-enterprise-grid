export const NOISE_GRID_CONFIG = {
  settings: {
    noiseGrid: {
      ui: {
          noisePreview: true ,
      },
      longSideCells: 5, //3..31
      frameMargin: 0, // 0..10 half-cell padding steps
      dotMargin: 0.0, // 0..0.9 
      palette: "green",
      // Keep the Diogo source ramp: the app-wide green palette has one fewer step.
      paletteColors: ["#003415", "#00692a", "#00a240", "#04b84c", "#40c977", "#8cdfad"],
      backgroundColor: "#000000",
      backend: "auto", // auto, cpu, shader;

      // Canonical field components. Legacy flat names never enter, diogonisator translates them
      noiseFields: {
        levelCount: 5, // levelCount: 4, // 1..5; five levels reach 16x16 glyphs per cell
        layers: {
          size: {
            mode: "simplex", // simplex, value, voronoi, gradient
            cyclesPerLoop: 0,
            speed: 0.02, // field units/second; simplex drift is not seam-perfect
            // Loopable-mode alternative: replace cyclesPerLoop/speed above with
            // cyclesPerLoop: "auto", // one repeat per beat
            // speed: null,
            scale: 1.17,
            contrast: 1.48,
            seed: 63,
            gamma: 1,
            invert: false,
            emptyBelow: 0,
          },
          color: {
            mode: "simplex", // mode: "life", simplex, value, voronoi, gradient, life
            cyclesPerLoop: 0,
            speed: 0.15, // field units/second; negative reverses drift
            holdSeconds: 0.25, // per-glyph minimum; 0 disables, "auto" = one beat
            // Faster loop: cyclesPerLoop: "auto", speed: null,
            scale: 0.45,
            contrast: 1.1,
            seed: 69,
          },
          contrast: {
            mode: "simplex", // mode: "voronoi", // simplex, value, voronoi, gradient
            cyclesPerLoop: 0,
            speed: 0.05,
            // Loopable alternative: cyclesPerLoop: "auto", speed: null,
            scale: 0.69,
            contrast: 1,
            seed: 26,
            influence: 1,
          },
          visibility: {
            mode: "simplex", // simplex, value, voronoi, gradient
            cyclesPerLoop: 0,
            speed: 0.05, // original free-drift rate; simplex is not seam-perfect
            holdSeconds: "auto", // per-glyph minimum; 0 disables, "auto" = one beat
            // Seam-perfect alternative: mode: "gradient", cyclesPerLoop: 1, speed: null,
            scale: 0.69,
            contrast: 1.2,
            seed: 26,
            threshold: 0.36,
            softness: 0.1
          },
        },
      },

      levelTransition: {
        enabled: false,
        durationSeconds: 0.23,
        cascade: true,
        smoothing: 0.5,
        hysteresis: 0.03,
      },
      // This phase transition is intentionally supported only by noise-grid.
      // It runs independently from the configured intro/outro arrangement.
      noiseVisibilityTransition: {
        enabled: true,
        holdSeconds: 6,
        // Caps the clear hold so the surrounding ramps always have phase time.
        maximumHoldShare: 0.01,
        // Relative shares of the time left after the hold; values are normalized.
        edgeWeights: {
          idleBefore: 2,
          rampOut: 1000,
          rampBack: 1000,
          idleAfter: 0.1,
        },
        threshold: 1,
        contrast: 0.01,
        softness: 0,
      },
      debugGrid: false,
    },
  },
  generatorDefinitions: {
    noiseGrid: { type: "noise-circle-grid", settingsKey: "noiseGrid" },
  },
  compositionDefinitions: {
    "noise-grid": {
      rule: "sequence",
      timing: { bodyDurationSeconds: 6, beatCount: 4 },
      steps: [{ use: "noiseGrid" }],
    },
  },
};
