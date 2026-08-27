// The flock composition and its compatibility alias share one configured
// generator, so switching IDs keeps the live flock.
export const FLOCK_GRID_CONFIG = {
  settings: {
    flock: {
      ui: {
        flockPreview: true,
      },
      grid: {
        longSideCells: 20,
        dotMargin: 0.025,
        showCellGrid: false,
        fieldRadiusInCells: 1,
        fieldGain: 1,
        riseSeconds: 0.08,
        fallSeconds: 0.05,
        emptyBelow: 0.01,
        paletteMode: "step",
      },
      field: {
        longSidePixels: 240,
        boidSize: 50,
      },
      simulation: {
        pulseEverySeconds: 2.2,
        pulseDecaySeconds: .07,
        birthsPerPulse: 5,
        emissionSeconds: 0.01,
        lifetimeSeconds: 8,
        fadeStartsAt: 0.5,
        initialSpeed: 408,
        spawnRadius: 2,
        count: 100,
        perceptionRadius: 5,
        separationRadius: 10,
        maxSpeed: 520,
        maxForce: 720,
        alignment: 0.78,
        cohesion: 0.054,
        separation: 5,
        pointerRadius: 100,
        pointerForce: 0,
      },
    },
  },

  generatorDefinitions: {
    flockGrid: {
      type: "flock-grid",
      settingsKey: "flock",
      cellTransition: { type: "none", options: "none" },
    },
  },

  compositionDefinitions: {
    flock: {
      rule: "sequence",
      loop: true,
      steps: [{ use: "flockGrid" }],
    },

    "flock-circles": {
      rule: "sequence",
      loop: true,
      steps: [
        {
          use: "flockGrid",
          cellTransition: { type: "none", options: "none" },
        },
      ],
    },
  },
};
