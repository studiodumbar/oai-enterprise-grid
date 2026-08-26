export const NOISE_GRID_CONFIG = {
  settings: {
    noiseGrid: {
      ui: {
        noisePreview: true,
        // noisePreview: false,
      },
      longSideCells: 5, //3..31
      frameMargin: 0, // 0..10 half-cell padding steps
      dotMargin: 0.0, // 0..0.9 
      palette: "green",
      backgroundColor: "#000000",
      backend: "auto", // auto, cpu, shader;

      // Canonical field components. Legacy flat names never enter, diogonisator translates them
      noiseFields: {
        levelCount: 5, // levelCount: 4, // 1..5; five levels reach 16x16 glyphs per cell
        layers: {
          size: {
            mode: "simplex", // simplex, value, voronoi, gradient
            cyclesPerLoop: 0,
            speed: 0.12, // field units/second; simplex drift is not seam-perfect
            // Loopable-mode alternative: replace cyclesPerLoop/speed above with
            // cyclesPerLoop: "auto", // one repeat per beat
            // speed: null,
            scale: 24,
            contrast: 1.15,
            seed: 1,
            gamma: 1,
            invert: false,
            emptyBelow: 0,
          },
          color: {
            mode: "gradient", // mode: "life", simplex, value, voronoi, gradient, life
            // One full-loop cycle moves continuously and closes at the seam.
            cyclesPerLoop: 1,
            speed: null, // field units/second; negative reverses drift
            holdSeconds: 0.2, // per-glyph minimum; 0 disables, "auto" = one beat
            // Faster loop: cyclesPerLoop: "auto", speed: null,
            scale: 0.2,
            contrast: 1.1,
            seed: 17,
          },
          contrast: {
            mode: "simplex", // mode: "voronoi", // simplex, value, voronoi, gradient
            cyclesPerLoop: 0,
            speed: 0.5,
            // Loopable alternative: cyclesPerLoop: "auto", speed: null,
            scale: 2.1,
            contrast: 1,
            seed: 43,
            influence: 1,
          },
          visibility: {
            mode: "simplex", // simplex, value, voronoi, gradient
            cyclesPerLoop: 0,
            speed: 0.07, // original free-drift rate; simplex is not seam-perfect
            holdSeconds: 0.2, // per-glyph minimum; 0 disables, "auto" = one beat
            // Seam-perfect alternative: mode: "gradient", cyclesPerLoop: 1, speed: null,
            scale: 1.6,
            contrast: 1.2,
            seed: 29,
            threshold: 0.5,
            softness: 0.1,
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
      debugGrid: false,
    },
  },
  generatorDefinitions: {
    noiseGrid: { type: "noise-circle-grid", settingsKey: "noiseGrid" },
  },
  compositionDefinitions: {
    "noise-grid": {
      rule: "sequence",
      timing: { bodyDurationSeconds: 12, beatCount: 4 },
      steps: [{ use: "noiseGrid" }],
    },
  },
};
