// Flicker Preview Base
//
// Five cells cover every standard subdivision density: 1, 4, 16, 64, and
// 256 dots. Its authored flicker block inherits GLOBAL_CONFIG.flicker, then
// overrides only the local values below.
export const BASE_CONFIG = {
  settings: {
    base: {
      dotMargin: 0.07,
      // palette: "green",
      // previewSeconds: 0.5, // Must equal timing.beatSeconds when authored.
      // previewRepeats: 4, // Must equal timing.beatCount when authored.

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
      //       colorBy: "level",
      //       textColor: null,
      //     },
      //   },
      // },
      // outro: {
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
      //       colorBy: "level",
      //       textColor: null,
      //     },
      //   },
      // },

      flicker: {
        // enabled: true,
        amount: 1,
        mode: "noise", // noise, echo-ring, strobe-stack, block-drop, prism-bloom, crt-glide, or radar-arc.
        scope: "cell",
        // cellStaggerSeconds: 0.9,
        modes: {
          // noise: { speed: 0.18, spatialScale: 0.28 },
          "echo-ring": {
            // cycleSeconds: "auto",
            // ringDelayFraction: 0.14,
            // echoDelayFraction: 0.03,
            // ringCount: 5,
          },
          // "strobe-stack": {
          //   cycleSeconds: "auto",
          //   columns: 5,
          //   rows: 5,
          //   baseIntensity: 0.08,
          // },
          // "block-drop": { cycleSeconds: "auto", baseIntensity: 0.08 },
          // "prism-bloom": {
          //   cycleSeconds: "auto",
          //   blendSeconds: 0.18,
          //   baseIntensity: 0.08,
          // },
          // "crt-glide": {
          //   cycleSeconds: "auto",
          //   rows: 5,
          //   decay: 0.72,
          //   columnWarp: 0.07,
          //   baseIntensity: 0.08,
          //   peakIntensity: 1,
          // },
          // "radar-arc": {
          //   cycleSeconds: "auto",
          //   gridSteps: 5,
          //   beamWidth: 0.55,
          //   wakeWidth: 1.15,
          //   ringInnerRadius: 1.6,
          //   ringOuterRadius: 2.3,
          //   baseIntensity: 0.08,
          // },
        },
      },
    },
  },

  generatorDefinitions: {
    baseGrid: {
      type: "base-composition",
      settingsKey: "base",
    },
  },

  compositionDefinitions: {
    base: {
      timing: {
        bodyDurationSeconds: 2,
        beatCount: 4,
      },
      rule: "sequence",
      steps: [{ use: "baseGrid" }],
    },
  },
};
