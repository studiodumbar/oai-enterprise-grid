// The flock composition and its compatibility alias share one configured
// generator, so switching IDs keeps the live flock.
export const FLOCK_GRID_CONFIG = {
  settings: {
    flock: {
      ui: {
        flockPreview: true,
      },
      // Flock uses the shared phase system without reintroducing typography.
      intro: {
        enabled: false,
        mode: "text",
        durationSeconds: "auto",
      },
      outro: {
        enabled: false,
        mode: "text",
        durationSeconds: "auto",
      },
      circleEndpoints: {
        start: { enabled: false, durationSeconds: "auto", mode: "native" },
        end: { enabled: false, durationSeconds: "auto", mode: "dijkstra" },
        modes: {
          dijkstra: {
            // Give route growth a full beat-scale gesture instead of six frames.
            pathFraction: 0.4,
          },
        },
      },
      flicker: {
        // Match Base: the local preset repeats across the glyphs inside every
        // subdivided parent cell, with a deterministic time stagger per cell.
        scope: "cell",
        mode: "radar-arc",
        modes: {
          // Only the block matching `mode` is active. Keeping it local makes
          // flock tuning visible here instead of hiding it in global defaults.
          "prism-bloom": {
            cycleSeconds: "auto",
            blendSeconds: 1,
            baseIntensity: 0.08,
          },
      "radar-arc": { 
        cycleSeconds: "calc(auto * 0.25)",
        gridSteps: 5,
        beamWidth: 0.55,
        wakeWidth: 1.15,
        ringInnerRadius: 1.6,
        ringOuterRadius: 1.8,
        baseIntensity: 0.4,
      },
 
          "noise": {
            speed: 2,
            spatialScale: 0.5,
          },
        },
        envelope: {
          // WHEN flicker is applied. Switch back to "end-of-life" to use the
          // age ramp below instead of selecting cells as their energy falls.
          trigger: "disappearing-cell",
          probability: 0.4,
          // 0, 1, 2, 3 render 1, 4, 16, 64 glyphs in a selected parent cell.
          subdivisionLevel: 1,
          endOfLifeStart: 0.5,
        },
      },
      grid: {
        longSideCells: 22,
        // Roll once whenever flock energy enters a cell; lower values thin it.
        appearanceProbability: 0.35,
        dotMargin: 0.0,
        showCellGrid: false,
        fieldRadiusInCells: 1,
        fieldGain: 1,
        riseSeconds: 0.8,
        fallSeconds: 0.5,
        emptyBelow: 0.01,
        paletteMode: "step",
      },
      field: {
        longSidePixels: 240,
        boidSize: 20,
      },
      simulation: {
        wrapEdges: false,
        // One emission pulse per resolved composition beat.
        pulseEverySeconds: "auto",
        pulseDecaySeconds: 1.5,
        birthsPerPulse: 8,
        emissionSeconds: 0.1,
        lifetimeSeconds: 12,
        fadeStartsAt: 5,
        initialSpeed: 1000,
        spawnRadius: 0.01,
        count: 20,
        perceptionRadius: 5,
        separationRadius: 10,
        maxSpeed: 1020,
        maxForce: 720,
        acceleration: 360,
        drag: 520,
        proximityRadius: 75,
        proximityExponent: 1.4,
        alignment: 0.78,
        cohesion: 54,
        separation: 500,
        pointerRadius: 10,
        pointerForce: 100,
      },
    },
  },

  generatorDefinitions: {
    flockGrid: {
      type: "flock-grid",
      settingsKey: "flock",
      cellTransition: {
        type: "none",
        // 1, 2, 3 render 4, 16, 64 dots. Level 0 is the singular dot.
        options: { subdivisionLevels: [1, 2, 3] },
      },
    },
  },

  compositionDefinitions: {
    flock: {
      rule: "sequence",
      loop: true,
      timing: {
        bodyDurationSeconds: 30,
        beatCount: 10,
      },
      steps: [{ use: "flockGrid" }],
    },

    "flock-circles": {
      rule: "sequence",
      loop: true,
      timing: {
        bodyDurationSeconds: 30,
        beatCount: 10,
      },
      steps: [
        {
          use: "flockGrid",
          cellTransition: { type: "none", options: "none" },
        },
      ],
    },
  },
};
