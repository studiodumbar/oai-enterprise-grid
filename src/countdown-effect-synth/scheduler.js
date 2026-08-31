const BANDS = Object.freeze(["behind-timer", "above-timer"]);

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function requireId(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireFiniteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number.`);
  }
  return value;
}

function requireFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`);
  }
  return value;
}

function requireProgress(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be a finite number from zero through one.`);
  }
  return value;
}

function hasAuthoredWindow(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && (
      Object.hasOwn(value, "startSeconds")
      || Object.hasOwn(value, "durationSeconds")
    );
}

function hasCompleteWindow(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.hasOwn(value, "startSeconds")
    && Object.hasOwn(value, "durationSeconds");
}

function windowAt(authored, label, outerWindow = null, allowZeroDuration = false) {
  const value = requireObject(authored, label);
  const startSeconds = requireFiniteNonNegative(
    value.startSeconds,
    `${label}.startSeconds`,
  );
  const durationSeconds = allowZeroDuration
    ? requireFiniteNonNegative(value.durationSeconds, `${label}.durationSeconds`)
    : requireFinitePositive(value.durationSeconds, `${label}.durationSeconds`);
  const endSeconds = startSeconds + durationSeconds;
  if (
    outerWindow
    && (startSeconds < outerWindow.startSeconds || endSeconds > outerWindow.endSeconds)
  ) {
    throw new RangeError(
      `${label} [${startSeconds}, ${endSeconds}) must fit inside `
      + `[${outerWindow.startSeconds}, ${outerWindow.endSeconds}).`,
    );
  }
  return Object.freeze({ startSeconds, durationSeconds, endSeconds });
}

function evolutionAt(authored, label, ownerWindow) {
  const window = windowAt(authored, label, ownerWindow);
  return Object.freeze({ ...window });
}

function resolveDefaultTiming(authored, totalDurationSeconds, tracks, connections) {
  if (tracks.length === 1 && connections.length === 0) {
    const label = "countdownFramed.appearance.synth.tracks[0]";
    const track = requireObject(tracks[0], label);
    const id = requireId(track.id, `${label}.id`);
    const startSeconds = track.startSeconds ?? 0;
    const durationSeconds = track.durationSeconds
      ?? totalDurationSeconds - startSeconds;
    const window = Object.freeze({
      startSeconds,
      durationSeconds,
      endSeconds: startSeconds + durationSeconds,
    });
    return Object.freeze({
      trackWindows: Object.freeze({
        [id]: Object.freeze({ ...window, evolution: window }),
      }),
      connectionWindows: Object.freeze({}),
    });
  }
  const everyWindowIsExplicit = tracks.every(track => (
    hasCompleteWindow(track) && hasCompleteWindow(track.evolution)
  )) && connections.every(connection => (
    hasCompleteWindow(connection) && hasCompleteWindow(connection.evolution)
  ));
  if (everyWindowIsExplicit) return null;
  const hasAnyAuthoredTiming = tracks.some(track => (
    hasAuthoredWindow(track) || track?.evolution !== undefined
  ));
  if (connections.length === 0 && !hasAnyAuthoredTiming) {
    const durationSeconds = totalDurationSeconds / tracks.length;
    const trackWindows = Object.fromEntries(tracks.map((authoredTrack, index) => {
      const label = `countdownFramed.appearance.synth.tracks[${index}]`;
      const track = requireObject(authoredTrack, label);
      const id = requireId(track.id, `${label}.id`);
      const startSeconds = index * durationSeconds;
      const window = Object.freeze({
        startSeconds,
        durationSeconds,
        endSeconds: startSeconds + durationSeconds,
      });
      return [id, Object.freeze({ ...window, evolution: window })];
    }));
    return Object.freeze({
      trackWindows: Object.freeze(trackWindows),
      connectionWindows: Object.freeze({}),
    });
  }
  if (authored === undefined) return null;
  const timing = requireObject(
    authored,
    "countdownFramed.appearance.synth.defaultTiming",
  );
  const merges = requireObject(
    timing.merges,
    "countdownFramed.appearance.synth.defaultTiming.merges",
  );
  const pair = name => {
    const label = `countdownFramed.appearance.synth.defaultTiming.merges.${name}`;
    const merge = requireObject(merges[name], label);
    const startProgress = requireProgress(
      merge.startProgress,
      `${label}.startProgress`,
    );
    const endProgress = requireProgress(
      merge.endProgress,
      `${label}.endProgress`,
    );
    if (endProgress <= startProgress) {
      throw new RangeError(`${label}.endProgress must be greater than startProgress.`);
    }
    return Object.freeze({
      startSeconds: startProgress * totalDurationSeconds,
      endSeconds: endProgress * totalDurationSeconds,
      durationSeconds: (endProgress - startProgress) * totalDurationSeconds,
    });
  };
  const clockToSnake = pair("clock-to-snake");
  const snakeToBubbles = pair("snake-to-bubbles");
  if (clockToSnake.endSeconds > snakeToBubbles.startSeconds) {
    throw new RangeError(
      "countdownFramed.appearance.synth.defaultTiming merge windows cannot overlap.",
    );
  }
  if (
    clockToSnake.startSeconds <= 0
    || clockToSnake.endSeconds >= snakeToBubbles.startSeconds
    || snakeToBubbles.endSeconds >= totalDurationSeconds
  ) {
    throw new RangeError(
      "countdownFramed.appearance.synth.defaultTiming must leave positive "
      + "clock, snake, and bubbles track windows between its merges.",
    );
  }
  for (const use of ["clock", "snake", "bubbles"]) {
    const matches = tracks.filter(track => track?.use === use);
    if (matches.length !== 1) {
      throw new RangeError(
        "countdownFramed.appearance.synth.defaultTiming requires exactly one "
        + `${use} track; repeated or missing effects require explicit seconds.`,
      );
    }
  }
  const trackWindows = Object.freeze({
    clock: Object.freeze({
      startSeconds: 0,
      endSeconds: clockToSnake.startSeconds,
      durationSeconds: clockToSnake.startSeconds,
      evolution: clockToSnake,
    }),
    snake: Object.freeze({
      startSeconds: clockToSnake.endSeconds,
      endSeconds: snakeToBubbles.startSeconds,
      durationSeconds: snakeToBubbles.startSeconds - clockToSnake.endSeconds,
      evolution: snakeToBubbles,
    }),
    bubbles: Object.freeze({
      startSeconds: snakeToBubbles.endSeconds,
      endSeconds: totalDurationSeconds,
      durationSeconds: totalDurationSeconds - snakeToBubbles.endSeconds,
      evolution: Object.freeze({
        startSeconds: snakeToBubbles.endSeconds,
        endSeconds: totalDurationSeconds,
        durationSeconds: totalDurationSeconds - snakeToBubbles.endSeconds,
      }),
    }),
  });
  const connectionWindows = Object.freeze({
    "clock->snake": Object.freeze({
      ...clockToSnake,
      evolution: clockToSnake,
    }),
    "snake->bubbles": Object.freeze({
      ...snakeToBubbles,
      evolution: snakeToBubbles,
    }),
  });
  return Object.freeze({ trackWindows, connectionWindows });
}

function resolvedWindow(
  authored,
  label,
  outerWindow,
  defaultWindow,
  allowZeroDuration = false,
) {
  if (defaultWindow !== undefined) {
    return windowAt({
      startSeconds: Object.hasOwn(authored, "startSeconds")
        ? authored.startSeconds
        : defaultWindow.startSeconds,
      durationSeconds: Object.hasOwn(authored, "durationSeconds")
        ? authored.durationSeconds
        : defaultWindow.durationSeconds,
    }, label, outerWindow, allowZeroDuration);
  }
  return windowAt(authored, label, outerWindow, allowZeroDuration);
}

function resolvedEvolution(authored, label, ownerWindow, defaultWindow) {
  if (authored !== undefined) return evolutionAt(authored, label, ownerWindow);
  return evolutionAt(defaultWindow, label, ownerWindow);
}

function windowsOverlap(first, second) {
  return first.startSeconds < second.endSeconds
    && second.startSeconds < first.endSeconds;
}

function windowContains(outer, inner) {
  return inner.startSeconds >= outer.startSeconds
    && inner.endSeconds <= outer.endSeconds;
}

function sameBoundary(first, second) {
  return Math.abs(first - second) <= 1e-9;
}

function progressAt(time, window) {
  return Math.max(0, Math.min(1, (
    time - window.startSeconds
  ) / window.durationSeconds));
}

export function countdownSynthSeed(projectSeed, trackId, seedSalt, tick = 0, itemId = "") {
  let value = Number(projectSeed) >>> 0;
  const text = `${trackId}\u0000${itemId}`;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  value ^= Number(seedSalt) >>> 0;
  value = Math.imul(value ^ (Number(tick) >>> 0), 0x85ebca6b) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

export function resolveCountdownSynth(
  appearance,
  countFromSeconds,
  { effectRegistry, connectorRegistry } = {},
) {
  const root = requireObject(appearance, "countdownFramed.appearance");
  const shared = Object.freeze({
    ...requireObject(root.shared, "countdownFramed.appearance.shared"),
  });
  const synth = requireObject(root.synth, "countdownFramed.appearance.synth");
  const totalDurationSeconds = requireFinitePositive(
    countFromSeconds,
    "countdownFramed.countFromSeconds",
  );
  const authoredTracks = requireArray(
    synth.tracks,
    "countdownFramed.appearance.synth.tracks",
  );
  if (authoredTracks.length === 0) {
    throw new RangeError(
      "countdownFramed.appearance.synth.tracks must contain at least one track.",
    );
  }
  const authoredConnections = requireArray(
    synth.connections ?? [],
    "countdownFramed.appearance.synth.connections",
  );
  const defaultTiming = resolveDefaultTiming(
    synth.defaultTiming,
    totalDurationSeconds,
    authoredTracks,
    authoredConnections,
  );
  if (!effectRegistry || typeof effectRegistry.descriptor !== "function") {
    throw new TypeError("Countdown synth requires an effect registry.");
  }
  if (!connectorRegistry || typeof connectorRegistry.resolve !== "function") {
    throw new TypeError("Countdown synth requires a connector registry.");
  }

  const ids = new Set();
  const tracks = authoredTracks.map((authoredTrack, index) => {
    const label = `countdownFramed.appearance.synth.tracks[${index}]`;
    const track = requireObject(authoredTrack, label);
    const id = requireId(track.id, `${label}.id`);
    if (ids.has(id)) throw new Error(`Duplicate countdown synth id "${id}".`);
    ids.add(id);
    const use = requireId(track.use, `${label}.use`);
    const descriptor = effectRegistry.descriptor(use);
    const anchor = track.anchor === true;
    if (track.anchor !== undefined && typeof track.anchor !== "boolean") {
      throw new TypeError(`${label}.anchor must be a boolean.`);
    }
    const defaultWindow = defaultTiming?.trackWindows[id]
      ?? defaultTiming?.trackWindows[use];
    const window = resolvedWindow(track, label, {
      startSeconds: 0,
      endSeconds: totalDurationSeconds,
    }, defaultWindow, anchor);
    if (anchor && window.durationSeconds !== 0) {
      throw new RangeError(`${label}.durationSeconds must be zero for an anchor track.`);
    }
    const evolution = resolvedEvolution(
      track.evolution,
      `${label}.evolution`,
      { startSeconds: 0, endSeconds: totalDurationSeconds },
      defaultWindow?.evolution,
    );
    const zIndex = track.zIndex === undefined ? 0 : track.zIndex;
    if (!Number.isFinite(zIndex)) {
      throw new TypeError(`${label}.zIndex must be a finite number.`);
    }
    const settings = descriptor.normalize(
      track.settings ?? {},
      { shared, trackId: id },
    );
    return Object.freeze({
      id,
      use,
      index,
      zIndex,
      settings: Object.freeze(settings),
      descriptor,
      anchor,
      ...window,
      evolution,
    });
  });
  const tracksById = new Map(tracks.map(track => [track.id, track]));

  const connectionIds = new Set();
  const connections = authoredConnections.map((authoredConnection, index) => {
    const label = `countdownFramed.appearance.synth.connections[${index}]`;
    const connection = requireObject(authoredConnection, label);
    const id = requireId(connection.id, `${label}.id`);
    if (ids.has(id) || connectionIds.has(id)) {
      throw new Error(`Duplicate countdown synth id "${id}".`);
    }
    connectionIds.add(id);
    const from = requireId(connection.from, `${label}.from`);
    const to = requireId(connection.to, `${label}.to`);
    const fromTrack = tracksById.get(from);
    const toTrack = tracksById.get(to);
    if (!fromTrack) throw new Error(`${label}.from refers to unknown track "${from}".`);
    if (!toTrack) throw new Error(`${label}.to refers to unknown track "${to}".`);
    if (from === to) throw new Error(`${label} cannot connect a track to itself.`);
    const pair = `${fromTrack.use}->${toTrack.use}`;
    const defaultWindow = defaultTiming?.connectionWindows[pair];
    const window = resolvedWindow(connection, label, {
      startSeconds: 0,
      endSeconds: totalDurationSeconds,
    }, defaultWindow);
    const evolution = resolvedEvolution(
      connection.evolution,
      `${label}.evolution`,
      window,
      defaultWindow?.evolution,
    );
    const requestedUse = requireId(connection.use, `${label}.use`);
    const descriptor = connectorRegistry.resolve(
      requestedUse,
      fromTrack.descriptor,
      toTrack.descriptor,
    );
    return Object.freeze({
      id,
      from,
      to,
      index,
      requestedUse,
      use: descriptor.name,
      descriptor,
      fromTrack,
      toTrack,
      ...window,
      evolution,
    });
  });

  for (const connection of connections) {
    if (!sameBoundary(connection.fromTrack.endSeconds, connection.startSeconds)) {
      throw new RangeError(
        `Countdown synth connection "${connection.id}" must start exactly when `
        + `track "${connection.from}" ends (${connection.fromTrack.endSeconds}).`,
      );
    }
    if (!sameBoundary(connection.endSeconds, connection.toTrack.startSeconds)) {
      throw new RangeError(
        `Countdown synth connection "${connection.id}" must end exactly when `
        + `track "${connection.to}" starts (${connection.toTrack.startSeconds}).`,
      );
    }
  }

  const timelineItems = [
    ...tracks.map(track => ({ ...track, id: `track:${track.id}` })),
    ...connections.map(connection => ({
      ...connection,
      id: `connection:${connection.id}`,
    })),
  ];
  for (let firstIndex = 0; firstIndex < timelineItems.length; firstIndex += 1) {
    const first = timelineItems[firstIndex];
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < timelineItems.length;
      secondIndex += 1
    ) {
      const second = timelineItems[secondIndex];
      if (windowsOverlap(first, second)) {
        throw new RangeError(
          `Countdown synth timeline items "${first.id}" and "${second.id}" overlap; `
          + "only one track or connection may play at a time.",
        );
      }
    }
  }

  for (const track of tracks) {
    const ownedWindows = [track];
    for (const connection of connections) {
      if (connection.from === track.id) {
        ownedWindows.push({
          startSeconds: connection.startSeconds,
          endSeconds: connection.evolution.endSeconds,
        });
      }
      if (
        connection.to === track.id
        && connection.evolution.endSeconds < connection.endSeconds
      ) {
        ownedWindows.push({
          startSeconds: connection.evolution.endSeconds,
          endSeconds: connection.endSeconds,
        });
      }
    }
    if (!ownedWindows.some(window => windowContains(window, track.evolution))) {
      throw new RangeError(
        `Countdown synth track "${track.id}" evolution must fit inside its track `
        + "or a connector interval that it owns.",
      );
    }
  }

  return Object.freeze({
    shared,
    totalDurationSeconds,
    tracks: Object.freeze(tracks),
    connections: Object.freeze(connections),
  });
}

export function countdownSynthAt(time, resolved) {
  if (!Number.isFinite(time) || time < 0) {
    throw new RangeError("Countdown synth time must be finite and non-negative.");
  }
  const localTime = time % resolved.totalDurationSeconds;
  const activeTracks = resolved.tracks.filter(track => (
    localTime >= track.startSeconds && localTime < track.endSeconds
  )).map(track => ({
    track,
    localSeconds: localTime - track.startSeconds,
    progress: progressAt(localTime, track),
    evolutionEnabled: localTime >= track.evolution.startSeconds,
    evolutionProgress: progressAt(localTime, track.evolution),
  }));
  const activeConnections = resolved.connections.filter(connection => (
    localTime >= connection.startSeconds && localTime < connection.endSeconds
  )).map(connection => ({
    connection,
    localSeconds: localTime - connection.startSeconds,
    progress: progressAt(localTime, connection),
    evolutionEnabled: localTime >= connection.evolution.startSeconds,
    evolutionProgress: progressAt(localTime, connection.evolution),
  }));
  return { localTime, activeTracks, activeConnections };
}

export function countdownSynthStageAt(time, resolved) {
  const state = countdownSynthAt(time, resolved);
  const connectionState = state.activeConnections.at(-1) ?? null;
  if (connectionState) {
    const connection = connectionState.connection;
    const ownerId = state.localTime < connection.evolution.endSeconds
      ? connection.from
      : connection.to;
    const ownerTrack = connection.fromTrack.id === ownerId
      ? connection.fromTrack
      : connection.toTrack;
    const evolutionStartsAt = (
      connection.evolution.startSeconds - connection.startSeconds
    ) / connection.durationSeconds;
    return {
      effect: ownerTrack.use,
      trackId: ownerTrack.id,
      connectionId: connection.id,
      nextEffect: connection.toTrack.use,
      index: ownerTrack.index,
      phase: connectionState.evolutionEnabled ? "evolving" : "stable",
      evolutionStartsAt,
      evolutionEnabled: connectionState.evolutionEnabled,
      stageProgress: connectionState.progress,
      phaseProgress: connectionState.evolutionEnabled
        ? connectionState.evolutionProgress
        : (evolutionStartsAt === 0
          ? 0
          : connectionState.progress / evolutionStartsAt),
      evolutionProgress: connectionState.evolutionProgress,
      startSeconds: connection.startSeconds,
      endSeconds: connection.endSeconds,
      durationSeconds: connection.durationSeconds,
    };
  }
  const trackState = [...state.activeTracks].sort((first, second) => (
    first.track.zIndex - second.track.zIndex
    || first.track.index - second.track.index
  )).at(-1) ?? null;
  if (!trackState) {
    return {
      effect: null,
      trackId: null,
      connectionId: null,
      nextEffect: null,
      index: -1,
      phase: "gap",
      evolutionStartsAt: 0,
      evolutionEnabled: false,
      stageProgress: 0,
      phaseProgress: 0,
      evolutionProgress: 0,
      startSeconds: state.localTime,
      endSeconds: state.localTime,
      durationSeconds: 0,
    };
  }
  const { track } = trackState;
  const nextTrack = resolved.tracks[(track.index + 1) % resolved.tracks.length] ?? null;
  const evolutionStartsAt = (
    track.evolution.startSeconds - track.startSeconds
  ) / track.durationSeconds;
  return {
    effect: track.use,
    trackId: track.id,
    connectionId: null,
    nextEffect: nextTrack?.use ?? null,
    index: track.index,
    phase: trackState.evolutionEnabled ? "evolving" : "stable",
    evolutionStartsAt,
    evolutionEnabled: trackState.evolutionEnabled,
    stageProgress: trackState.progress,
    phaseProgress: trackState.evolutionEnabled
      ? trackState.evolutionProgress
      : (evolutionStartsAt === 0 ? 0 : trackState.progress / evolutionStartsAt),
    evolutionProgress: trackState.evolutionProgress,
    startSeconds: track.startSeconds,
    endSeconds: track.endSeconds,
    durationSeconds: track.durationSeconds,
  };
}

export function countdownSynthEffectTicks(effect, tick, tickSeconds, totalTickCount, resolved) {
  const exactTrack = resolved?.tracks?.find(candidate => candidate.id === effect) ?? null;
  const matchingTracks = exactTrack === null
    ? (resolved?.tracks?.filter(candidate => candidate.use === effect) ?? [])
    : [exactTrack];
  if (matchingTracks.length === 0) {
    throw new RangeError(`Countdown synth has no "${effect}" track.`);
  }
  if (matchingTracks.length > 1) {
    throw new RangeError(
      `Countdown synth effect "${effect}" has ${matchingTracks.length} tracks; `
      + "pass a unique track id to resolve its ticks.",
    );
  }
  if (!Number.isSafeInteger(tick) || tick < 0 || tick >= totalTickCount) {
    throw new RangeError("Countdown synth tick must be inside the countdown.");
  }
  requireFinitePositive(tickSeconds, "Countdown synth tick seconds");
  const track = matchingTracks[0];
  const owned = Array.from({ length: totalTickCount }, (_, candidateTick) => ({
    tick: candidateTick,
    state: countdownSynthAt(candidateTick * tickSeconds, resolved),
  })).map(candidate => {
    const trackState = candidate.state.activeTracks.find(
      state => state.track.id === track.id,
    ) ?? null;
    const connectorState = candidate.state.activeConnections.find(state => (
      state.connection.from === track.id || state.connection.to === track.id
    )) ?? null;
    const connectorOwnerId = connectorState === null
      ? null
      : (
        candidate.state.localTime < connectorState.connection.evolution.endSeconds
          ? connectorState.connection.from
          : connectorState.connection.to
      );
    const owns = trackState !== null || connectorOwnerId === track.id;
    return {
      ...candidate,
      owns,
      evolutionEnabled: owns
        && candidate.state.localTime >= track.evolution.startSeconds,
    };
  }).filter(candidate => candidate.owns);
  if (owned.length === 0) {
    throw new RangeError(`Countdown synth effect "${effect}" never owns a render window.`);
  }
  const startTick = owned[0].tick;
  const endTick = owned.at(-1).tick;
  const firstEvolution = owned.find(candidate => candidate.evolutionEnabled);
  const evolutionStartTick = firstEvolution?.tick ?? endTick + 1;
  const evolutionTickCount = Math.max(1, endTick - evolutionStartTick + 1);
  const current = owned.find(candidate => candidate.tick === tick) ?? null;
  const evolutionEnabled = current?.evolutionEnabled === true
    && tick >= evolutionStartTick
    && tick <= endTick;
  const evolutionTick = evolutionEnabled ? tick - evolutionStartTick : 0;
  return {
    trackId: track.id,
    owned: current !== null,
    startTick,
    endTick,
    evolutionStartTick,
    evolutionTickCount,
    evolutionEnabled,
    evolutionTick,
    evolutionProgress: !evolutionEnabled
      ? 0
      : (evolutionTickCount === 1 ? 1 : evolutionTick / (evolutionTickCount - 1)),
  };
}

export function sortCountdownRenderLayers(layers) {
  return layers.map((layer, index) => {
    if (!BANDS.includes(layer.band)) {
      throw new RangeError(
        `Countdown render layer "${layer.id}" has invalid band "${layer.band}".`,
      );
    }
    return { ...layer, insertionIndex: index };
  }).sort((first, second) => (
    BANDS.indexOf(first.band) - BANDS.indexOf(second.band)
    || first.zIndex - second.zIndex
    || first.trackIndex - second.trackIndex
    || first.id.localeCompare(second.id)
    || first.insertionIndex - second.insertionIndex
  )).map(({ insertionIndex, ...layer }) => layer);
}

export { BANDS as COUNTDOWN_RENDER_BANDS };
