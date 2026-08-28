export const COUNTDOWN_FRAMED_CONFIG = {
  settings: {
    countdownFramed: {
      longSideCells: 5,
      countFromSeconds: 180,
      fontFamily: "'OpenAI Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif",
      fontWeight: 700,
      fontSizeInCells: 0.28,
      textColor: null,

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
      timing: { bodyDurationSeconds: 181, beatCount: 181 },
      steps: [{ use: "countdownFramedGrid" }],
    },
  },
};
