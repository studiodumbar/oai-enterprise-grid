import {
  CountdownConnectorRegistry,
  CountdownEffectRegistry,
  countdownEffectPorts,
} from "./registry.js";

function normalizeSettings(settings, { shared }) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new TypeError("Countdown effect settings must be an object.");
  }
  return { ...shared, ...settings };
}

class HostEffectInstance {
  constructor({ descriptor, host, track, seed }) {
    this.descriptor = descriptor;
    this.host = host;
    this.track = track;
    this.seed = seed;
    this.viewport = null;
    this.disposed = false;
  }

  resize(viewport) {
    this.viewport = { ...viewport };
  }

  planAt(time, state) {
    return {
      signal: this.sampleAt(time, state),
      layers: this.host.countdownEffectLayers(this.track, state),
    };
  }

  sampleAt(time, state) {
    return this.host.countdownEffectSignal(this.track, time, state, this.seed);
  }

  drawLayer(layer, context) {
    this.host.drawCountdownEffectLayer(this.track, layer, context);
  }

  inspect() {
    return {
      id: this.track.id,
      use: this.track.use,
      seed: this.seed,
      disposed: this.disposed,
      viewport: this.viewport === null ? null : { ...this.viewport },
    };
  }

  dispose() {
    this.disposed = true;
    this.host = null;
  }
}

class HostConnectorInstance {
  constructor({ descriptor, host, connection }) {
    this.descriptor = descriptor;
    this.host = host;
    this.connection = connection;
    this.viewport = null;
    this.disposed = false;
  }

  resize(viewport) {
    this.viewport = { ...viewport };
  }

  planAt(time, state) {
    return this.descriptor.plan({ connection: this.connection, time, state });
  }

  sampleAt(time, state) {
    const plan = this.planAt(time, state);
    return {
      id: this.connection.id,
      use: this.connection.use,
      progress: state.progress,
      evolutionProgress: state.evolutionProgress,
      layerIds: plan.layers.map(layer => layer.id),
    };
  }

  drawLayer(layer, context) {
    this.host.drawCountdownConnectorLayer(this.connection, layer, context);
  }

  inspect() {
    return {
      id: this.connection.id,
      use: this.connection.use,
      disposed: this.disposed,
      viewport: this.viewport === null ? null : { ...this.viewport },
    };
  }

  dispose() {
    this.disposed = true;
    this.host = null;
  }
}

function effectDescriptor(name, seedSalt, ports) {
  const descriptor = {
    name,
    defaults: {},
    seedSalt,
    ports,
    normalize: normalizeSettings,
    create: creation => new HostEffectInstance({ ...creation, descriptor }),
  };
  return descriptor;
}

function connectorLayer(connection, suffix, track, drawKey, zIndex = track.zIndex) {
  return {
    id: `${connection.id}:${suffix}`,
    band: track.use === "clock" && track.settings.behindText === false
      ? "above-timer"
      : "behind-timer",
    zIndex,
    trackIndex: track.index,
    ownerType: "connector",
    ownerId: connection.id,
    trackId: track.id,
    drawKey,
  };
}

function connectorDescriptor(
  name,
  seedSalt,
  from,
  to,
  requiredPorts = {},
  plan = ({ connection, state }) => {
    const showTarget = state.evolutionProgress >= 1;
    const track = showTarget
      ? connection.toTrack
      : connection.fromTrack;
    return {
      layers: [connectorLayer(
        connection,
        showTarget ? "to" : "from",
        track,
        track.use,
      )],
    };
  },
) {
  const descriptor = {
    name,
    defaults: {},
    seedSalt,
    ports: countdownEffectPorts("layers", "masks"),
    from,
    to,
    requiredPorts,
    plan,
    normalize: normalizeSettings,
    create: creation => new HostConnectorInstance({ ...creation, descriptor }),
  };
  return descriptor;
}

export function countdownSnakeToBubblesAt(time, connection) {
  if (!Number.isFinite(time) || time < 0) {
    throw new RangeError("Countdown snake-to-bubbles time must be non-negative.");
  }
  const connectorStartSeconds = connection?.startSeconds;
  const connectorEndSeconds = connection?.endSeconds;
  if (
    !Number.isFinite(connectorStartSeconds)
    || !Number.isFinite(connectorEndSeconds)
    || connectorStartSeconds >= connectorEndSeconds
  ) {
    throw new RangeError(
      "Countdown snake-to-bubbles connection requires ordered resolved windows.",
    );
  }
  const connectorDurationSeconds = connectorEndSeconds - connectorStartSeconds;
  const connectorActive = time >= connectorStartSeconds && time < connectorEndSeconds;
  const connectorProgress = Math.max(0, Math.min(1, (
    time - connectorStartSeconds
  ) / connectorDurationSeconds));
  return {
    connectorActive,
    connectorProgress,
    snakeVisible: connectorActive,
    deathCommitted: time >= connectorEndSeconds,
    connectorStartSeconds,
    connectorEndSeconds,
    connectorDurationSeconds,
  };
}

export function createCountdownEffectRegistry() {
  return new CountdownEffectRegistry()
    .register(effectDescriptor(
      "clock",
      3109,
      countdownEffectPorts("anchors", "dots", "masks", "layers"),
    ))
    .register(effectDescriptor(
      "snake",
      3121,
      countdownEffectPorts("anchors", "cells", "tiles", "masks", "layers"),
    ))
    .register(effectDescriptor(
      "bubbles",
      3137,
      countdownEffectPorts("dots", "tiles", "masks", "layers"),
    ));
}

export function createCountdownConnectorRegistry() {
  return new CountdownConnectorRegistry()
    .register(connectorDescriptor("hard-cut", 3203, null, null))
    .register(connectorDescriptor(
      "clock-to-snake",
      3209,
      "clock",
      "snake",
      { from: ["anchors", "dots"], to: ["cells"] },
      ({ connection }) => ({
        layers: [connectorLayer(
          connection,
          "clock",
          connection.fromTrack,
          "clock-to-snake",
        )],
      }),
    ))
    .register(connectorDescriptor(
      "snake-to-bubbles",
      3217,
      "snake",
      "bubbles",
      { from: ["cells", "tiles"], to: ["dots", "tiles", "masks"] },
      ({ connection }) => ({
        layers: [connectorLayer(
          connection,
          "snake-engorgement",
          connection.fromTrack,
          "snake",
        )],
      }),
    ));
}
