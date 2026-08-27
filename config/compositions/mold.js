// Mold Growth
//
// Deterministic scouts reinforce cheap shared trails while searching for hidden
// food. A discovery proliferates through every subdivision level on its route.
export const MOLD_CONFIG = {
  settings: {
    mold: {
      longSideCells: 14,
      dotMargin: 0.0,
      flipSeconds: 0.04,
      targetCount: 10,
      explorationCount: 38,
      explorationStepCount: 640,
      trailEnergyDiscount: 0.55,
      trailDecayBeats: 1.5,
      trailReuseBonusBeats: 0.5,
      proliferationDelayBeatsPerCell: 0.15,
      proliferationGlyphsPerBeat: 16,

      cellTransitions: {
        enabled: false,
        mode: "fade",
        durationSeconds: "auto",
      },

      intro: {
        enabled: true,
        mode: "fade",
        durationSeconds: "auto",
      },
      outro: {
        enabled: true,
        mode: "fade",
        durationSeconds: "auto",
      },

      circleEndpoints: {
        start: {
          enabled: true,
          durationSeconds: "auto",
          mode: "native",
        },
        end: {
          enabled: true,
          durationSeconds: "auto",
          mode: "dijkstra",
        },
        modes: {
          dijkstra: {
            pathFraction: 0.28,
            blinkFraction: 0.12,
            centerHoldFraction: 0.08,
            blinkCount: 3,
            trailLength: 0.7,
            maximumLevel: 3,
            paletteStep: 3,
            cleanupAcceleration: 2,
            foreignTerritoryCost: 1,
          },
        },
      },

      flicker: {
        enabled: true,
        mode: "noise",
        scope: "canvas",
        amount: 0.8,
        cellStaggerSeconds: 0,
        modes: {
            "noise": { 
                spatialScale: 0.0328,
            speed: 0.4,
            },
          "echo-ring": {
            cycleSeconds: "auto",
            ringDelayFraction: 0.12,
            echoDelayFraction: 0.03,
            ringCount: 6,
          },
        },
      },
    },
  },

  generatorDefinitions: {
    moldGrid: {
      type: "procedural-topology",
      settingsKey: "mold",
      strategy: "mold",
    },
  },

  compositionDefinitions: {
    mold: {
      timing: {
        bodyDurationSeconds: 48,
        beatCount: 12,
      },
      rule: "sequence",
      steps: [{ use: "moldGrid" }],
    },
  },
};
