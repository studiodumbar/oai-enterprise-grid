// Interactive flock deliberately duplicates flock's authored values. The two
// compositions may evolve independently without a shared preset changing an
// existing take.
export const INTERACTIVE_FLOCK_CONFIG = {
  settings: {
    interactiveFlock: {
      ui: {
        flockPreview: false,
        interactiveFlock: true,
      },
      intro: {
        enabled: true,
        mode: "text",
        durationSeconds: "auto",
      },
      outro: {
        enabled: false,
        mode: "text",
        durationSeconds: "auto",
      },
      circleEndpoints: {
        start: { enabled: true, durationSeconds: "auto", mode: "native" },
        end: { enabled: true, durationSeconds: "auto", mode: "dijkstra" },
        modes: {
          dijkstra: {
            pathFraction: 0.4,
          },
        },
      },
      flicker: {
        scope: "cell",
        mode: "radar-arc",
        modes: {
          "prism-bloom": {
            cycleSeconds: "auto",
            blendSeconds: 1,
            baseIntensity: 0.08,
          },
          "radar-arc": {
            cycleSeconds: "calc(auto * 0.5)",
            gridSteps: 5,
            beamWidth: 0.55,
            wakeWidth: 1.15,
            ringInnerRadius: 1.6,
            ringOuterRadius: 1.8,
            baseIntensity: 0.4,
          },
          noise: {
            speed: 2,
            spatialScale: 0.5,
          },
        },
        envelope: {
          trigger: "disappearing-cell",
          probability: 0.2,
          subdivisionLevel: 1,
          endOfLifeStart: 0.5,
        },
      },
      grid: {
        longSideCells: 22,
        // Roll once whenever flock energy enters a cell; lower values thin it.
        appearanceProbability: 0.35,
        dotMargin: 0,
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
        pulseEverySeconds: "auto",
        pulseDecaySeconds: 1.5,
        birthsPerPulse: 5,
        emissionSeconds: 0.1,
        lifetimeSeconds: 8,
        fadeStartsAt: 5,
        initialSpeed: 1000,
        spawnRadius: 0.01,
        count: 20,
        perceptionRadius: 5,
        separationRadius: 10,
        maxSpeed: 1200,
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
      interaction: {
        fixedStepSeconds: 1 / 60,
        mode: "launcher",
        launcher: {
          // Dragging one quarter of the short viewport side reaches full launch speed.
          fullStrengthDragFraction: 0.25,
        },
        boom: {
          // Number of deterministic outward launchers placed inside the drag radius.
          intensity: 12,
        },
        picasso: {
          showPath: true,
          guideForce: 900,
          guideRadiusScale: 2,
          tangentWeight: 1.2,
          dashLengthPixels: 18,
          dashGapPixels: 10,
          dashCyclesPerBeat: 4,
          lineWidth: 2,
          color: "#8cdfad",
          opacity: 0.82,
        },
      },
      visibleBoids: {
        show: false,
        size: 6,
        color: "#8cdfad",
        opacity: 0.78,
      },
    },
  },

  generatorDefinitions: {
    interactiveFlockGrid: {
      type: "flock-grid",
      settingsKey: "interactiveFlock",
      cellTransition: { type: "none", options: "none" },
    },
  },

  compositionDefinitions: {
    "interactive-flock": {
      rule: "interactive-take",
      settingsKey: "interactiveFlock",
      loop: true,
      timing: {
        mode: "fixed-beat",
        beatSeconds: 3,
      },
      interaction: {
        minimumDragPixels: 8,
      },
      steps: [{ use: "interactiveFlockGrid" }],
    },
  },
};
