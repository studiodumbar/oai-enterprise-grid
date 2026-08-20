import { normalizeCircleEndpointSettings } from "../compositions/circle-endpoints.js";
import {
  DEFAULT_DIJKSTRA_ENDPOINT_SETTINGS,
  DijkstraCompositionEndpoint,
} from "./dijkstra.js";

export const COMPOSITION_ENDPOINT_MODES = Object.freeze([
  "native",
  "dijkstra",
]);

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function resolvePhase(direction, fallback, authored = {}) {
  requireObject(authored, `circleEndpoints.${direction}`);
  const enabled = authored.enabled ?? fallback.enabled;
  const durationSeconds = authored.durationSeconds ?? fallback.durationSeconds;
  const mode = authored.mode ?? fallback.mode;
  if (typeof enabled !== "boolean") {
    throw new TypeError(`circleEndpoints.${direction}.enabled must be true or false.`);
  }
  if (!COMPOSITION_ENDPOINT_MODES.includes(mode)) {
    throw new Error(
      `Unknown composition endpoint mode "${mode}" for ${direction}. Available modes: `
      + `${COMPOSITION_ENDPOINT_MODES.join(", ")}.`,
    );
  }
  return Object.freeze({ enabled, durationSeconds, mode });
}

function mergeModeSettings(globalModes = {}, authoredModes = {}) {
  requireObject(globalModes, "Global circleEndpoints.modes");
  requireObject(authoredModes, "circleEndpoints.modes");
  const merged = {};
  for (const mode of new Set([
    ...Object.keys(globalModes),
    ...Object.keys(authoredModes),
  ])) {
    const globalMode = globalModes[mode] ?? {};
    const authoredMode = authoredModes[mode] ?? {};
    requireObject(globalMode, `Global circleEndpoints.modes.${mode}`);
    requireObject(authoredMode, `circleEndpoints.modes.${mode}`);
    merged[mode] = Object.freeze({ ...globalMode, ...authoredMode });
  }
  return Object.freeze(merged);
}

export function resolveCompositionEndpointSettings(globalSettings = {}, authored = {}) {
  requireObject(globalSettings, "Global composition settings");
  requireObject(authored, "circleEndpoints");
  const legacy = normalizeCircleEndpointSettings(globalSettings);
  const globalEndpoints = globalSettings.circleEndpoints ?? {};
  requireObject(globalEndpoints, "Global composition.circleEndpoints");
  const legacyStart = {
    enabled: legacy.startWithCircle,
    durationSeconds: legacy.startWithCircleDurationSeconds,
    mode: "native",
  };
  const legacyEnd = {
    enabled: legacy.endWithCircle,
    durationSeconds: legacy.endWithCircleDurationSeconds,
    mode: "native",
  };
  const globalStart = resolvePhase("start", legacyStart, globalEndpoints.start ?? {});
  const globalEnd = resolvePhase("end", legacyEnd, globalEndpoints.end ?? {});
  const start = resolvePhase("start", globalStart, authored.start ?? {});
  const end = resolvePhase("end", globalEnd, authored.end ?? {});
  const circleSubdivision = authored.circleSubdivision
    ?? globalEndpoints.circleSubdivision
    ?? legacy.circleSubdivision;
  const timeline = normalizeCircleEndpointSettings({
    startWithCircle: start.enabled,
    startWithCircleDurationSeconds: start.durationSeconds,
    endWithCircle: end.enabled,
    endWithCircleDurationSeconds: end.durationSeconds,
    circleSubdivision,
  });
  return Object.freeze({
    start,
    end,
    circleSubdivision,
    modes: mergeModeSettings(globalEndpoints.modes, authored.modes),
    timeline,
  });
}

export function nativeCircleEndpointSettings(resolved) {
  return normalizeCircleEndpointSettings({
    ...resolved.timeline,
    startWithCircle: resolved.start.enabled && resolved.start.mode === "native",
    endWithCircle: resolved.end.enabled && resolved.end.mode === "native",
  });
}

export function createCompositionEndpointMode(resolvedPhase, modes = {}) {
  if (!resolvedPhase?.enabled || resolvedPhase.mode === "native") return null;
  if (resolvedPhase.mode === "dijkstra") {
    return new DijkstraCompositionEndpoint({
      ...DEFAULT_DIJKSTRA_ENDPOINT_SETTINGS,
      ...(modes.dijkstra ?? {}),
    });
  }
  throw new Error(
    `Unknown composition endpoint mode "${resolvedPhase.mode}". Available modes: `
    + `${COMPOSITION_ENDPOINT_MODES.join(", ")}.`,
  );
}

export {
  DEFAULT_DIJKSTRA_ENDPOINT_SETTINGS,
  DijkstraCompositionEndpoint,
} from "./dijkstra.js";
