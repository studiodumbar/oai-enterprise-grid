// The flock composition and its compatibility alias share one configured
// generator, so switching IDs keeps the live flock.
export const FLOCK_GRID_CONFIG = {
  settings: {
    grid: {
      longSideCells: 12,
      dotMargin: 0.025,
      showCellGrid: false,
      fieldRadiusInCells: 1,
      fieldGain: 0.072,
      riseSeconds: 0.8,
      fallSeconds: 0.75,
    },

    typography: {
      text: "",
      textLockup: true,
      fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
      weight: 600,
      sizeInCanvasHeights: 0.2,
      influencesGrid: false,
      gridInfluence: 0.09,
      flockAvoidance: 10,
      halo: 2,
      restingOpacity: 0.0,
      pulseScale: 0.0,
    },

    flock: {
      showBoids: false,
      boidColor: "#ff0035",
      boidOpacity: 0.72,
      boidSize: 40,
      pulseEverySeconds: 2.2,
      pulseDecaySeconds: 1.7,
      birthsPerPulse: 50,
      emissionSeconds: 0.09,
      lifetimeSeconds: 18,
      fadeStartsAt: 0.5,
      initialSpeed: 48,
      count: 100,
      perceptionRadius: 75,
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

  generatorDefinitions: {
    flockGrid: {
      type: "flock-grid",
      gridSettings: "grid",
      typographySettings: "typography",
      flockSettings: "flock",
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
