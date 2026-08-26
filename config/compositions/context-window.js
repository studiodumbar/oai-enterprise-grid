// Causal Horizon
//
// This composition keeps past context behind a causal frontier and future
// positions white. Tweak its grid density, timing, palette, and flip cadence
// here without affecting the other inference-grid compositions.
export const CONTEXT_WINDOW_CONFIG = {
  settings: {
    contextWindow: {
      longSideCells: 12,
      dotMargin: 0.07,
      flipSeconds: 0.015,

      // All inherited controls are listed here. Merge individual uncommented
      // keys into an active block of the same name when this composition has one.
      // palette: "green",
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
      // cellTransitions: {
      //   enabled: true,
      //   mode: "aurora", // none, fade, sort-selection, or aurora
      //   durationSeconds: "auto",
      //   modes: {
      //     none: { baseKind: "circle" },
      //     fade: { revealFraction: 0.5, timingCurve: [0.42, 0, 0.58, 1] },
      //     "sort-selection": {
      //       seed: 173,
      //       revealFraction: 0.16,
      //       arcHeightInCells: 0.32,
      //       overlapDots: false,
      //       directions: ["top-down", "bottom-up"],
      //       staggerSeconds: 0,
      //       timingCurve: [0.65, 0, 0.35, 1],
      //     },
      //     aurora: {
      //       seed: 173,
      //       revealFraction: 0.16,
      //       arcHeightInCells: 0.32,
      //       overlapDots: false,
      //       directions: ["top-down", "bottom-up"],
      //       staggerSeconds: 0,
      //       timingCurve: [0.65, 0, 0.35, 1],
      //       waveAmplitudeInCells: 1.15,
      //       waveCycles: 1.5,
      //       beamLengthInCells: 2.5,
      //     },
      //   },
      // },
      // intro: {
      //   enabled: true,
      //   mode: "text", // fade or text
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
      // flicker: {
      //   enabled: true,
      //   mode: "noise", // noise, echo-ring, strobe-stack, block-drop,
      //   // prism-bloom, crt-glide, or radar-arc
      //   scope: "canvas", // canvas or cell
      //   amount: 0.55,
      //   cellStaggerSeconds: 0.9,
      //   modes: {
      //     noise: { speed: 0.18, spatialScale: 0.28 },
      //     "echo-ring": {
      //       cycleSeconds: "auto",
      //       ringDelayFraction: 0.14,
      //       echoDelayFraction: 0.03,
      //       ringCount: 5,
      //     },
      //     "strobe-stack": {
      //       cycleSeconds: "auto",
      //       columns: 5,
      //       rows: 5,
      //       baseIntensity: 0.08,
      //     },
      //     "block-drop": { cycleSeconds: "auto", baseIntensity: 0.08 },
      //     "prism-bloom": {
      //       cycleSeconds: "auto",
      //       blendSeconds: 0.18,
      //       baseIntensity: 0.08,
      //     },
      //     "crt-glide": {
      //       cycleSeconds: "auto",
      //       rows: 5,
      //       decay: 0.72,
      //       columnWarp: 0.07,
      //       baseIntensity: 0.08,
      //       peakIntensity: 1,
      //     },
      //     "radar-arc": {
      //       cycleSeconds: "auto",
      //       gridSteps: 5,
      //       beamWidth: 0.55,
      //       wakeWidth: 1.15,
      //       ringInnerRadius: 1.6,
      //       ringOuterRadius: 2.3,
      //       baseIntensity: 0.08,
      //     },
      //   },
      //   // envelope is strategy-owned; its complete keys are active below
      //   // when this composition supports an envelope.
      // },
      // Only the final attention snapshot and the committed dot flicker.
      flicker: {
        amount: 1,
        scope: "cell",
        mode: "prism-bloom",
        modes: {
          noise: {
            speed: 2,
            spatialScale: 0.2,
          },
          "crt-glide": {
            cycleSeconds: "calc(auto * 0.6)",
          },
          "block-drop": {
            cycleSeconds: "calc(auto * 0.6)",
          },
          "prism-bloom": {
            cycleSeconds: "calc(auto * 1.6)",
          },
          "strobe-stack": {
            cycleSeconds: "calc(auto * 1.2)",
          },
          "echo-ring": {
            cycleSeconds: "calc(auto * 0.6)",
          },
        },
      },
    },
  },

  generatorDefinitions: {
    contextWindowGrid: {
      type: "inference-grid",
      settingsKey: "contextWindow",
      strategy: "context-window",
    },
  },

  compositionDefinitions: {
    "context-window": {
      timing: {
        bodyDurationSeconds: 8,
        beatCount: 4,
      },
      rule: "sequence",
      steps: [{ use: "contextWindowGrid" }],
    },
  },
};
