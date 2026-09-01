// Timeline editing guide: docs/countdown-timeline.md
const COUNT_FROM_SECONDS = 180;
const APPEARANCE_SLOT_SECONDS = COUNT_FROM_SECONDS / 3;
const BUBBLES_START_SECONDS = APPEARANCE_SLOT_SECONDS * 2;
const SNAKE_TO_BUBBLES_DURATION_SECONDS = 3;
const SNAKE_BUBBLES_START_SECONDS =
  BUBBLES_START_SECONDS - SNAKE_TO_BUBBLES_DURATION_SECONDS;

const COUNTDOWN_SHARED_APPEARANCE = Object.freeze({
  seed: 0,
  evolveSeed: false,
  minimumCellDistance: 5,
  textSafeZone: Object.freeze({ widthInCells: 1.25, heightInCells: 0.75 }),
});

const CLOCK_SETTINGS = Object.freeze({
  enabled: true,
  durationSeconds: "auto",
  subdivisionLevel: 3,
  squareCount: 2,
  dotsPerSquare: 4,
  travelingSquareStaggerBeats: 0.2,
  travelingSquareBeatOffset: Object.freeze({
    enabled: true,
    probability: 0.85,
    patterns: Object.freeze([
      Object.freeze({ id: "quick-four", durationBeats: 0.75, repeatCount: 4 }),
      Object.freeze({ id: "five-four", durationBeats: 1.25, repeatCount: 4 }),
      Object.freeze({ id: "slow-two", durationBeats: 1.5, repeatCount: 2 }),
      Object.freeze({ id: "double-hold", durationBeats: 2, repeatCount: 1 }),
      Object.freeze({ id: "long-two", durationBeats: 2.5, repeatCount: 2 }),
    ]),
  }),
  sizeWaterfall: Object.freeze({
    enabled: true,
    bothCells: true,
    clockProbability: 0.95,
  }),
  farSeparation: Object.freeze({
    enabled: true,
    probability: 0.5,
    minimumRadiusInCells: 3,
  }),
  birthRipple: Object.freeze({
    enabled: true,
    startBeforeHandoffBeats: 1,
    durationBeats: 4,
    wakeDepthInCells: 1.35,
    secondaryRadiusInCells: 2.5,
    radialTimingCurve: Object.freeze([0.18, 0.42, 0.68, 0.86]),
    wakeFlicker: Object.freeze({
      enabled: true,
      probability: 0.7,
      distanceDecayInCells: 5,
      flashesPerBeat: 6,
      minimumOpacity: 0.2,
    }),
  }),
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
  durationSeconds: "auto",
  lengthCells: 7,
  growAfterEachTick: true,
  mergeIntoBubbles: true,
  engorgement: Object.freeze({
    enabled: true,
    growthMode: "linear",
    growthStartProgress: 0,
    mealRevealBeforeEndBeats: 0.5,
    mealPulseScale: 1.08,
    mealPulseTimingCurve: Object.freeze([0.42, 0, 0.58, 1]),
    deathFlicker: Object.freeze({
      enabled: true,
      beforeEndBeats: 0.5,
      mode: "strobe-stack",
    }),
  }),
  maximumSubdivisionLevel: 3,
  colorVariations: Object.freeze([
    Object.freeze({ use: "none", weight: 1 }),
    Object.freeze({ use: "vertical-stripes", weight: 1 }),
    Object.freeze({ use: "horizontal-stripes", weight: 1 }),
  ]),
  secondaryMovement: Object.freeze({
    enabled: true,
    probability: 0.33,
    directions: Object.freeze(["top", "bottom"]),
  }),
  disappearanceVariations: Object.freeze([
    Object.freeze({ use: "instant", weight: 1 }),
    Object.freeze({ use: "tail-dive", weight: 1 }),
  ]),
  selfCollision: Object.freeze({
    enabled: true,
    flickerMode: "strobe-stack",
  }),
  dotMargin: 0.0,
  timingCurve: Object.freeze([0.42, 0, 0.58, 1]),
});

const BUBBLES_SETTINGS = Object.freeze({
  enabled: true,
  debug: Object.freeze({
    visualizeBubbles: false,
    opacity: 0.12,
  }),
  subdivisionLevel: 3,
  squareCount: 2,
  evolveSquareCount: true,
  dotsPerSquare: 4,
  numberSpacingInSubdivisions: 1.25,
  avoidance: Object.freeze({
    radiusInCells: 1,
    radiusAtEndInCells: 6,
    durationBeats: 2.5,
    timingCurve: Object.freeze([0.895, 0.03, 0.685, 0.22]),
    refill: Object.freeze({
      startBeforeTickEndBeats: 0.075,
      timingCurve: Object.freeze([0.25, 0.46, 0.45, 0.94]),
    }),
    radiusGrowthTimingCurve: Object.freeze([0.42, 0, 1, 1]),
    finalWipe: Object.freeze({
      enabled: true,
      startProgress: 0.9766666667,
      endProgress: 1,
      timingCurve: Object.freeze([0.8, 0, 1, 0]),
      center: Object.freeze({ xProgress: 0.5, yProgress: 0.5 }),
    }),
  }),
  visibilityMap: Object.freeze({
    enabled: true,
    beatWiggle: Object.freeze({
      durationBeats: 1.5,
      distance: 0.24,
      timingCurve: Object.freeze([0.42, 0, 0.58, 1]),
    }),
    displacement: Object.freeze({
      minimumInCells: 0.1,
      radiusRatio: 0.16,
      maximumInCells: 1.1,
      refillOffset: Object.freeze({ columns: 7, rows: 5 }),
    }),
    field: Object.freeze({
      mode: "ink-shards",
      cyclesPerLoop: 0,
      speed: null,
      holdSeconds: 0,
      scale: 6.5,
      contrast: 2,
      seed: 83,
      threshold: 0.25,
      softness: 0,
      modes: Object.freeze({
        "ink-shards": Object.freeze({ crawl: 0.9 }),
      }),
    }),
  }),
  growTowardZero: false,
  growthTimingCurve: Object.freeze([0.8, 0, 1, 1]),
  dotMargin: 0,
});

// The complete score lets the synth resolve every exclusive track and connector.
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

const COUNTDOWN_SYNTH_CONNECTIONS = Object.freeze([
  Object.freeze({
    id: "clock-snake",
    from: "clock-main",
    to: "snake-main",
    use: "auto",
  }),
  Object.freeze({
    id: "snake-bubbles",
    from: "snake-main",
    to: "bubbles-main",
    use: "auto",
  }),
]);

export const COUNTDOWN_FRAMED_CONFIG = {
  settings: {
    countdownFramed: {
      ui: {
        noisePreview: false,
      },
      // palette: "mono",
      timerFinalColor: "#ffffff",
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
          // Clock merge timing scales with the countdown. The final connector
          // deliberately keeps its authored three-second duration.
          defaultTiming: {
            merges: {
              "clock-to-snake": {
                startProgress: 1 / 6,
                endProgress: 1 / 3,
              },
              "snake-to-bubbles": {
                startProgress: SNAKE_BUBBLES_START_SECONDS / COUNT_FROM_SECONDS,
                endProgress: BUBBLES_START_SECONDS / COUNT_FROM_SECONDS,
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
