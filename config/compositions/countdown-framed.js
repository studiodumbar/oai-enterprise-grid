// Timeline editing guide: docs/countdown-timeline.md
const COUNT_FROM_SECONDS = 30;

const COUNTDOWN_SHARED_APPEARANCE = Object.freeze({
  seed: 0,
  evolveSeed: false,
  minimumCellDistance: 5,
  textSafeZone: Object.freeze({ widthInCells: 1.25, heightInCells: 0.75 }),
});

const CLOCK_SETTINGS = Object.freeze({
  enabled: true,
  palette: "flicker",
  durationSeconds: "auto",
  subdivisionLevel: 3,
  squareCount: 2,
  dotsPerSquare: 4,
  behindText: true,
  evolutionSquareSizes: Object.freeze([3, 4, 8]),
  rangeInSubdivisions: Object.freeze({ x: 8, y: 8 }),
  textSafeZone: COUNTDOWN_SHARED_APPEARANCE.textSafeZone,
  minimumSquareGapInSubdivisions: 1,
  dotMargin: 0,
  timingCurve: Object.freeze([0.42, 0, 0.58, 1]),
});

const SNAKE_SETTINGS = Object.freeze({
  enabled: true,
  palette: "flicker",
  durationSeconds: "auto",
  lengthCells: 7,
  growAfterEachTick: true,
  mergeIntoBubbles: true,
  bubbleClearanceInCells: 0.125,
  maximumSubdivisionLevel: 3,
  dotMargin: 0.0,
  timingCurve: Object.freeze([0.42, 0, 0.58, 1]),
});

const BUBBLES_SETTINGS = Object.freeze({
  enabled: true,
  palette: "flicker",
  subdivisionLevel: 3,
  squareCount: 2,
  evolveSquareCount: true,
  dotsPerSquare: 4,
  numberSpacingInSubdivisions: 1.25,
  avoidance: Object.freeze({
    radiusInCells: 1,
    radiusAtEndInCells: 3,
    durationBeats: 2.5,
    timingCurve: Object.freeze([0.42, 0, 0.58, 1]),
    radiusGrowthTimingCurve: Object.freeze([0.42, 0, 0.58, 1]),
  }),
  noiseFields: Object.freeze({
    enabled: true,
    edgeWidthInSquares: 20,
    beatWiggle: Object.freeze({
      distance: 0.08,
      timingCurve: Object.freeze([0.42, 0, 0.58, 1]),
    }),
    layers: Object.freeze({
      visibility: Object.freeze({
        mode: "simplex",
        cyclesPerLoop: 0,
        speed: null,
        holdSeconds: 0,
        scale: 8,
        contrast: 12,
        seed: 83,
        threshold: 0.6,
        softness: 0.2,
      }),
    }),
  }),
  growTowardZero: false,
  growthTimingCurve: Object.freeze([0.8, 0, 1, 1]),
  dotMargin: 0,
});

// This array is the visual timeline. One untimed entry fills the full
// countdown; any other reduced or reordered untimed list gets equal slices.
const COUNTDOWN_SYNTH_TRACKS = Object.freeze([
  Object.freeze({
    id: "clock-main",
    use: "clock",
    zIndex: 10,
    settings: CLOCK_SETTINGS,
  }),
  Object.freeze({
    id: "snake-main",
    use: "snake",
    zIndex: 20,
    settings: SNAKE_SETTINGS,
  }),
  Object.freeze({
    id: "bubbles-main",
    use: "bubbles",
    zIndex: 30,
    settings: BUBBLES_SETTINGS,
  }),
]);

// The handcrafted merges apply only to this exact preset. Editing the track
// list automatically falls back to an ordered hard-cut timeline.
const COUNTDOWN_SYNTH_CONNECTIONS = (
  COUNTDOWN_SYNTH_TRACKS.map(track => track.use).join(">")
  === "clock>snake>bubbles"
)
  ? Object.freeze([
    Object.freeze({
      id: "clock-snake",
      from: COUNTDOWN_SYNTH_TRACKS[0].id,
      to: COUNTDOWN_SYNTH_TRACKS[1].id,
      use: "auto",
    }),
    Object.freeze({
      id: "snake-bubbles",
      from: COUNTDOWN_SYNTH_TRACKS[1].id,
      to: COUNTDOWN_SYNTH_TRACKS[2].id,
      use: "auto",
    }),
  ])
  : Object.freeze([]);

export const COUNTDOWN_FRAMED_CONFIG = {
  settings: {
    countdownFramed: {
      palette: "countdown",
      longSideCells: 12,
      // This composition has no center-cell endpoint, so even short sides can
      // use a complete extra row or column when the combined margins fit one.
      shortSideParity: "any",
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
        ...COUNTDOWN_SHARED_APPEARANCE,
        shared: COUNTDOWN_SHARED_APPEARANCE,
        synth: {
          // Fractions of the complete countdown; changing COUNT_FROM_SECONDS
          // stretches the full effect sequence without rewriting track windows.
          defaultTiming: {
            merges: {
              "clock-to-snake": {
                startProgress: 1 / 6,
                endProgress: 1 / 3,
              },
              "snake-to-bubbles": {
                startProgress: 2 / 3,
                endProgress: 5 / 6,
              },
            },
          },
          tracks: COUNTDOWN_SYNTH_TRACKS,
          connections: COUNTDOWN_SYNTH_CONNECTIONS,
        },
        // Accepted during the migration so saved countdown projects still load.
        order: {
          stages: [
            { effect: "clock", evolutionStartsAt: 0.5 },
            { effect: "snake", evolutionStartsAt: 0.5 },
            { effect: "bubbles", evolutionStartsAt: 0 },
          ],
        },
        effects: {
          snake: SNAKE_SETTINGS,
          clock: CLOCK_SETTINGS,
          frame: BUBBLES_SETTINGS,
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
