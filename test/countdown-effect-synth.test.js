import test from "node:test";
import assert from "node:assert/strict";

import {
  countdownSynthAt,
  countdownSynthEffectTicks,
  countdownSynthSeed,
  countdownSynthStageAt,
  countdownSnakeToBubblesAt,
  createCountdownConnectorRegistry,
  createCountdownEffectRegistry,
  resolveCountdownSynth,
  sortCountdownRenderLayers,
} from "../src/countdown-effect-synth/index.js";

const shared = Object.freeze({
  seed: 0,
  evolveSeed: false,
  minimumCellDistance: 5,
  textSafeZone: Object.freeze({ widthInCells: 1.25, heightInCells: 0.75 }),
});

function track(id, use, startSeconds, durationSeconds, evolution, zIndex = 0) {
  return { id, use, startSeconds, durationSeconds, evolution, zIndex, settings: {} };
}

function resolve(tracks, connections = [], duration = 30) {
  return resolveCountdownSynth(
    { shared, synth: { tracks, connections } },
    duration,
    {
      effectRegistry: createCountdownEffectRegistry(),
      connectorRegistry: createCountdownConnectorRegistry(),
    },
  );
}

test("countdown synth default merges scale with the full countdown", () => {
  const duration = 180;
  const synth = resolveCountdownSynth(
    {
      shared,
      synth: {
        defaultTiming: {
          merges: {
            "clock-to-snake": { startProgress: 1 / 6, endProgress: 1 / 3 },
            "snake-to-bubbles": { startProgress: 2 / 3, endProgress: 5 / 6 },
          },
        },
        tracks: [
          { id: "clock", use: "clock", settings: {} },
          { id: "snake", use: "snake", settings: {} },
          { id: "bubbles", use: "bubbles", settings: {} },
        ],
        connections: [
          { id: "clock-snake", from: "clock", to: "snake", use: "auto" },
          { id: "snake-bubbles", from: "snake", to: "bubbles", use: "auto" },
        ],
      },
    },
    duration,
    {
      effectRegistry: createCountdownEffectRegistry(),
      connectorRegistry: createCountdownConnectorRegistry(),
    },
  );

  assert.deepEqual(synth.tracks.map(candidate => ({
    use: candidate.use,
    start: candidate.startSeconds,
    end: candidate.endSeconds,
    evolutionStart: candidate.evolution.startSeconds,
    evolutionEnd: candidate.evolution.endSeconds,
  })), [
    { use: "clock", start: 0, end: 30, evolutionStart: 30, evolutionEnd: 60 },
    { use: "snake", start: 60, end: 120, evolutionStart: 120, evolutionEnd: 150 },
    { use: "bubbles", start: 150, end: 180, evolutionStart: 150, evolutionEnd: 180 },
  ]);
  assert.deepEqual(synth.connections.map(candidate => ({
    use: candidate.use,
    start: candidate.startSeconds,
    end: candidate.endSeconds,
    evolutionEnd: candidate.evolution.endSeconds,
  })), [
    { use: "clock-to-snake", start: 30, end: 60, evolutionEnd: 60 },
    { use: "snake-to-bubbles", start: 120, end: 150, evolutionEnd: 150 },
  ]);
  assert.deepEqual(
    [0, 30, 60, 120, 150, 179.999, 180].map(time => {
      const state = countdownSynthAt(time, synth);
      return [
        time,
        ...state.activeTracks.map(candidate => `track:${candidate.track.id}`),
        ...state.activeConnections.map(
          candidate => `connection:${candidate.connection.id}`,
        ),
      ];
    }),
    [
      [0, "track:clock"],
      [30, "connection:clock-snake"],
      [60, "track:snake"],
      [120, "connection:snake-bubbles"],
      [150, "track:bubbles"],
      [179.999, "track:bubbles"],
      [180, "track:clock"],
    ],
  );
  assert.deepEqual(
    ["clock", "snake", "bubbles"].map(use => {
      const ticks = countdownSynthEffectTicks(use, 0, 1, duration, synth);
      return [use, ticks.startTick, ticks.evolutionStartTick, ticks.endTick];
    }),
    [
      ["clock", 0, 30, 59],
      ["snake", 60, 120, 149],
      ["bubbles", 150, 150, 179],
    ],
  );
});

test("snake-to-bubbles keeps the snake alive through its exclusive connector window", () => {
  const connection = {
    startSeconds: 20,
    endSeconds: 25,
    evolution: { startSeconds: 20, endSeconds: 25 },
  };
  assert.deepEqual(countdownSnakeToBubblesAt(19.999, connection), {
    connectorActive: false,
    connectorProgress: 0,
    snakeVisible: false,
    deathCommitted: false,
    connectorStartSeconds: 20,
    connectorEndSeconds: 25,
    connectorDurationSeconds: 5,
  });
  assert.deepEqual(countdownSnakeToBubblesAt(20, connection), {
    connectorActive: true,
    connectorProgress: 0,
    snakeVisible: true,
    deathCommitted: false,
    connectorStartSeconds: 20,
    connectorEndSeconds: 25,
    connectorDurationSeconds: 5,
  });
  assert.equal(countdownSnakeToBubblesAt(22.5, connection).connectorProgress, 0.5);
  assert.equal(countdownSnakeToBubblesAt(24.999, connection).snakeVisible, true);
  assert.deepEqual({
    active: countdownSnakeToBubblesAt(25, connection).connectorActive,
    progress: countdownSnakeToBubblesAt(25, connection).connectorProgress,
    visible: countdownSnakeToBubblesAt(25, connection).snakeVisible,
    committed: countdownSnakeToBubblesAt(25, connection).deathCommitted,
  }, { active: false, progress: 1, visible: false, committed: true });
});

test("a lone timeline track fills the countdown without canonical merge timing", () => {
  const duration = 75;
  const synth = resolveCountdownSynth(
    {
      shared,
      synth: {
        defaultTiming: {
          merges: {
            "clock-to-snake": { startProgress: 1 / 6, endProgress: 1 / 3 },
            "snake-to-bubbles": { startProgress: 2 / 3, endProgress: 5 / 6 },
          },
        },
        tracks: [{ id: "only-visual", use: "bubbles", settings: {} }],
        connections: [],
      },
    },
    duration,
    {
      effectRegistry: createCountdownEffectRegistry(),
      connectorRegistry: createCountdownConnectorRegistry(),
    },
  );

  assert.deepEqual(synth.tracks.map(candidate => ({
    id: candidate.id,
    start: candidate.startSeconds,
    end: candidate.endSeconds,
    evolutionStart: candidate.evolution.startSeconds,
    evolutionEnd: candidate.evolution.endSeconds,
  })), [{
    id: "only-visual",
    start: 0,
    end: duration,
    evolutionStart: 0,
    evolutionEnd: duration,
  }]);
  assert.deepEqual(
    countdownSynthAt(duration - 0.001, synth).activeTracks.map(state => state.track.id),
    ["only-visual"],
  );
  assert.deepEqual(
    countdownSynthAt(duration, synth).activeTracks.map(state => state.track.id),
    ["only-visual"],
  );
});

test("a lone timeline track accepts partial explicit timing", () => {
  const startingLate = resolve([
    { id: "clock", use: "clock", startSeconds: 2, settings: {} },
  ], [], 10);
  assert.deepEqual({
    start: startingLate.tracks[0].startSeconds,
    end: startingLate.tracks[0].endSeconds,
  }, { start: 2, end: 10 });

  const endingEarly = resolve([
    { id: "snake", use: "snake", durationSeconds: 4, settings: {} },
  ], [], 10);
  assert.deepEqual({
    start: endingEarly.tracks[0].startSeconds,
    end: endingEarly.tracks[0].endSeconds,
  }, { start: 0, end: 4 });

  const explicitEvolution = resolve([
    {
      id: "bubbles",
      use: "bubbles",
      startSeconds: 3,
      evolution: { startSeconds: 4, durationSeconds: 6 },
      settings: {},
    },
  ], [], 10);
  assert.deepEqual({
    start: explicitEvolution.tracks[0].startSeconds,
    end: explicitEvolution.tracks[0].endSeconds,
  }, { start: 3, end: 10 });
});

test("an untimed track list fills the countdown in authored order", () => {
  const synth = resolve([
    { id: "bubbles-first", use: "bubbles", settings: {} },
    { id: "clock-second", use: "clock", settings: {} },
  ], [], 12);

  assert.deepEqual(synth.tracks.map(candidate => ({
    id: candidate.id,
    start: candidate.startSeconds,
    end: candidate.endSeconds,
    evolutionStart: candidate.evolution.startSeconds,
    evolutionEnd: candidate.evolution.endSeconds,
  })), [
    {
      id: "bubbles-first",
      start: 0,
      end: 6,
      evolutionStart: 0,
      evolutionEnd: 6,
    },
    {
      id: "clock-second",
      start: 6,
      end: 12,
      evolutionStart: 6,
      evolutionEnd: 12,
    },
  ]);
  assert.equal(countdownSynthStageAt(5.999, synth).trackId, "bubbles-first");
  assert.equal(countdownSynthStageAt(6, synth).trackId, "clock-second");
  assert.equal(countdownSynthStageAt(12, synth).trackId, "bubbles-first");
});

test("three untimed tracks without connectors use timeline order, not merge defaults", () => {
  const duration = 9;
  const synth = resolveCountdownSynth(
    {
      shared,
      synth: {
        defaultTiming: {
          merges: {
            "clock-to-snake": { startProgress: 1 / 6, endProgress: 1 / 3 },
            "snake-to-bubbles": { startProgress: 2 / 3, endProgress: 5 / 6 },
          },
        },
        tracks: [
          { id: "clock", use: "clock", settings: {} },
          { id: "snake", use: "snake", settings: {} },
          { id: "bubbles", use: "bubbles", settings: {} },
        ],
        connections: [],
      },
    },
    duration,
    {
      effectRegistry: createCountdownEffectRegistry(),
      connectorRegistry: createCountdownConnectorRegistry(),
    },
  );

  assert.deepEqual(synth.tracks.map(candidate => [
    candidate.use,
    candidate.startSeconds,
    candidate.endSeconds,
  ]), [
    ["clock", 0, 3],
    ["snake", 3, 6],
    ["bubbles", 6, 9],
  ]);
});

test("countdown synth resolves exclusive half-open tracks, gaps, evolution, and seams", () => {
  const synth = resolve([
    track("clock-a", "clock", 0, 4, { startSeconds: 2, durationSeconds: 2 }),
    track("snake-a", "snake", 4, 3, { startSeconds: 5, durationSeconds: 2 }),
    track("clock-b", "clock", 9, 1, { startSeconds: 9, durationSeconds: 1 }),
  ], [], 10);

  assert.deepEqual(
    countdownSynthAt(3, synth).activeTracks.map(state => state.track.id),
    ["clock-a"],
  );
  assert.deepEqual(
    countdownSynthAt(4, synth).activeTracks.map(state => state.track.id),
    ["snake-a"],
  );
  assert.deepEqual(countdownSynthAt(7, synth).activeTracks, []);
  assert.deepEqual(
    countdownSynthAt(9.999, synth).activeTracks.map(state => state.track.id),
    ["clock-b"],
  );
  assert.deepEqual(
    countdownSynthAt(10, synth).activeTracks.map(state => state.track.id),
    ["clock-a"],
  );
  assert.equal(countdownSynthAt(2, synth).activeTracks[0].evolutionProgress, 0);
  assert.equal(countdownSynthAt(3, synth).activeTracks[0].evolutionProgress, 0.5);
});

test("countdown synth rejects overlapping tracks", () => {
  assert.throws(() => resolve([
    track("clock", "clock", 0, 6, { startSeconds: 0, durationSeconds: 6 }),
    track("bubbles", "bubbles", 5, 1, { startSeconds: 5, durationSeconds: 1 }),
  ], [], 6), /only one track or connection may play at a time/);
});

test("countdown synth supports repeated effect types and stable namespaced seeds", () => {
  const synth = resolve([
    track("clock-a", "clock", 0, 5, { startSeconds: 0, durationSeconds: 5 }),
    track("clock-b", "clock", 5, 5, { startSeconds: 5, durationSeconds: 5 }),
  ], [], 10);
  assert.deepEqual(synth.tracks.map(candidate => candidate.use), ["clock", "clock"]);
  assert.equal(countdownSynthSeed(17, "clock-a", 3109, 2, "dot-1"),
    countdownSynthSeed(17, "clock-a", 3109, 2, "dot-1"));
  assert.notEqual(
    countdownSynthSeed(17, "clock-a", 3109, 2, "dot-1"),
    countdownSynthSeed(17, "clock-b", 3109, 2, "dot-1"),
  );
  assert.deepEqual(
    ["clock-a", "clock-b"].map((id, index) => {
      const ticks = countdownSynthEffectTicks(id, index * 5, 1, 10, synth);
      return [id, ticks.startTick, ticks.endTick, ticks.owned];
    }),
    [
      ["clock-a", 0, 4, true],
      ["clock-b", 5, 9, true],
    ],
  );
  assert.throws(
    () => countdownSynthEffectTicks("clock", 0, 1, 10, synth),
    /pass a unique track id/,
  );
});

test("countdown synth resolves auto connectors and hard-cut fallback", () => {
  const custom = resolve([
    track("clock", "clock", 0, 2, { startSeconds: 2, durationSeconds: 2 }),
    track("snake", "snake", 4, 6, { startSeconds: 4, durationSeconds: 6 }),
  ], [{
    id: "clock-snake",
    from: "clock",
    to: "snake",
    use: "auto",
    startSeconds: 2,
    durationSeconds: 2,
    evolution: { startSeconds: 2, durationSeconds: 2 },
  }], 10);
  assert.equal(custom.connections[0].use, "clock-to-snake");

  const fallback = resolve([
    track("clock", "clock", 0, 2, { startSeconds: 0, durationSeconds: 2 }),
    track("clock-2", "clock", 4, 6, { startSeconds: 4, durationSeconds: 6 }),
  ], [{
    id: "clock-clock",
    from: "clock",
    to: "clock-2",
    use: "auto",
    startSeconds: 2,
    durationSeconds: 2,
    evolution: { startSeconds: 2, durationSeconds: 2 },
  }], 10);
  assert.equal(fallback.connections[0].use, "hard-cut");
});

test("countdown synth rejects invalid tracks, connectors, and ownership conflicts", () => {
  assert.throws(() => resolve([], [], 10), /must contain at least one track/);
  assert.throws(() => resolve([
    { id: "clock", use: "clock", startSeconds: null, settings: {} },
  ], [], 10), /startSeconds must be a finite non-negative number/);
  const validTracks = [
    track("clock", "clock", 0, 2, { startSeconds: 0, durationSeconds: 2 }),
    track("snake", "snake", 4, 2, { startSeconds: 4, durationSeconds: 2 }),
    track("bubbles", "bubbles", 8, 2, { startSeconds: 8, durationSeconds: 2 }),
  ];
  assert.throws(() => resolve([
    validTracks[0],
    { ...validTracks[1], id: "clock" },
  ], [], 10), /Duplicate countdown synth id/);
  assert.throws(() => resolve([
    { ...validTracks[0], use: "missing" },
  ], [], 10), /Unknown countdown effect/);
  assert.throws(() => resolve([
    { ...validTracks[0], durationSeconds: 11 },
  ], [], 10), /must fit inside/);
  assert.throws(() => resolve(validTracks, [{
    id: "bad-endpoint",
    from: "clock",
    to: "missing",
    use: "auto",
    startSeconds: 2,
    durationSeconds: 2,
    evolution: { startSeconds: 2, durationSeconds: 2 },
  }], 10), /unknown track/);
  assert.throws(() => resolve(validTracks, [{
    id: "bad-window",
    from: "clock",
    to: "snake",
    use: "auto",
    startSeconds: 9,
    durationSeconds: 2,
    evolution: { startSeconds: 9, durationSeconds: 1 },
  }], 10), /must fit inside/);
  assert.throws(() => resolve(validTracks, [{
    id: "bad-start",
    from: "clock",
    to: "snake",
    use: "auto",
    startSeconds: 1,
    durationSeconds: 3,
    evolution: { startSeconds: 1, durationSeconds: 3 },
  }], 10), /must start exactly when track "clock" ends/);
  assert.throws(() => resolve(validTracks, [{
    id: "bad-end",
    from: "clock",
    to: "snake",
    use: "auto",
    startSeconds: 2,
    durationSeconds: 1,
    evolution: { startSeconds: 2, durationSeconds: 1 },
  }], 10), /must end exactly when track "snake" starts/);
  assert.throws(() => resolve([
    validTracks[0],
    track("overlap", "bubbles", 1, 2, { startSeconds: 1, durationSeconds: 2 }),
  ], [], 10), /only one track or connection may play at a time/);
  assert.throws(() => resolveCountdownSynth(
    {
      shared,
      synth: {
        defaultTiming: {
          merges: {
            "clock-to-snake": { startProgress: 0.2, endProgress: 0.6 },
            "snake-to-bubbles": { startProgress: 0.5, endProgress: 0.8 },
          },
        },
        tracks: validTracks.map(({ startSeconds, durationSeconds, evolution, ...candidate }) => (
          candidate
        )),
        connections: [
          { id: "clock-snake", from: "clock", to: "snake", use: "auto" },
          { id: "snake-bubbles", from: "snake", to: "bubbles", use: "auto" },
        ],
      },
    },
    10,
    {
      effectRegistry: createCountdownEffectRegistry(),
      connectorRegistry: createCountdownConnectorRegistry(),
    },
  ), /merge windows cannot overlap/);
});

test("countdown render layers sort by band, z-index, track order, and id", () => {
  const layers = sortCountdownRenderLayers([
    { id: "z", band: "above-timer", zIndex: 0, trackIndex: 0 },
    { id: "b", band: "behind-timer", zIndex: 2, trackIndex: 0 },
    { id: "a", band: "behind-timer", zIndex: 2, trackIndex: 0 },
    { id: "first", band: "behind-timer", zIndex: 2, trackIndex: -1 },
  ]);
  assert.deepEqual(layers.map(layer => layer.id), ["first", "a", "b", "z"]);
  assert.throws(() => sortCountdownRenderLayers([
    { id: "bad", band: "middle", zIndex: 0, trackIndex: 0 },
  ]), /invalid band/);
});
