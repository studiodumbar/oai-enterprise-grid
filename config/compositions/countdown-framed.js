const COUNT_FROM_SECONDS = 10;

export const COUNTDOWN_FRAMED_CONFIG = {
  settings: {
    countdownFramed: {
      palette: "countdown",
      longSideCells: 12,
      countFromSeconds: COUNT_FROM_SECONDS,
      fontFamily: "'OpenAI Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif",
      fontWeight: 700,
      fontSizeInCells: 0.25,
      textReveal: {
        durationSeconds: "calc(auto * 0.33)", // `auto` is one composition beat
      },
      flicker: {
        enabled: true,
        mode: "noise",
        scope: "canvas",
        amount: 1,
        cellStaggerSeconds: 0,
        modes: {
          noise: { speed: 0.04, spatialScale: 0.08 },
        },
      },
      appearance: {
        seed: 0,
        evolveSeed: false,
        minimumCellDistance: 5,
        order: {
          // This pass runs the clock stage alone for the whole countdown.
          stages: [{ effect: "clock", evolutionStartsAt: 0.5 }],
        },
        effects: {
          snake: {
            enabled: false,
            palette: "flocker",
            durationSeconds: "auto", // The snake arrives on the next beat.
            lengthCells: 7,
            growAfterEachTick: true,
            maximumSubdivisionLevel: 3,
            dotMargin: 0.0,
            timingCurve: [0.42, 0, 0.58, 1],
          },
          clock: {
            enabled: true,
            palette: "flocker",
            durationSeconds: "auto", // Both squares complete one turn per beat.
            subdivisionLevel: 3,
            squareCount: 2,
            dotsPerSquare: 4,
            rangeInSubdivisions: { x: 8, y: 8 },
            // Half-extent of the clear band around the label, in 8ths of a cell.
            textSafeZoneInSubdivisions: { x: 4, y: 2 },
            dotMargin: 0,
            timingCurve: [0.42, 0, 0.58, 1],
          },
          frame: {
            enabled: true,
            palette: "flocker",
            subdivisionLevel: 3, // 8x8 glyph units continue across the board.
            squareCount: 2,
            evolveSquareCount: true,
            dotsPerSquare: 4,
            numberSpacingInSubdivisions: 1.25,
            avoidance: {
              radiusInCells: 1,
              radiusAtEndInCells: 3,
              durationBeats: 2.5,
              timingCurve: [0.42, 0, 0.58, 1],
              radiusGrowthTimingCurve: [0.42, 0, 0.58, 1],
            },
            noiseFields: {
              enabled: true,
              edgeWidthInSquares: 20,
              beatWiggle: {
                distance: 0.08,
                timingCurve: [0.42, 0, 0.58, 1],
              },
              layers: {
                visibility: {
                  mode: "simplex",
                  cyclesPerLoop: 0,
                  speed: null,
                  holdSeconds: 0,
                  scale: 8,
                  contrast: 12,
                  seed: 83,
                  threshold: 0.6,
                  softness: 0.2,
                },
              },
            },
            growTowardZero: false, // Reserved for a later scale/pop transition.
            growthTimingCurve: [0.8, 0, 1, 1],
            dotMargin: 0,
          },
        },
      },

      // The first pass owns only the countdown. Boundary effects can be
      // enabled once their role in this composition is defined.
      intro: { enabled: false, durationSeconds: "auto" },
      outro: { enabled: false, durationSeconds: "auto" },
      circleEndpoints: {
        start: { enabled: false, durationSeconds: "auto", mode: "native" },
        end: { enabled: false, durationSeconds: "auto", mode: "dijkstra" },
      },
    },
  },

  generatorDefinitions: {
    countdownFramedGrid: {
      type: "countdown-framed",
      settingsKey: "countdownFramed",
    },
  },

  compositionDefinitions: {
    "countdown-framed": {
      rule: "sequence",
      timing: {
        bodyDurationSeconds: COUNT_FROM_SECONDS,
        beatCount: COUNT_FROM_SECONDS,
      },
      steps: [{ use: "countdownFramedGrid" }],
    },
  },
};
