// Public configuration facade. Edit app-wide values and transition presets in
// config/global.js, compatibility settings in config/shared.js, and
// composition-family values in config/compositions/. The flat exports at the
// bottom remain the runtime contract used by the composition director.
import { GLOBAL_CONFIG } from "./config/global.js";
import { SHARED_CONFIG } from "./config/shared.js";
import { INTERACTIVE_GRID_CONFIG } from "./config/compositions/interactive-grid.js";
import { FLOCK_GRID_CONFIG } from "./config/compositions/flock-grid.js";
import { INFERENCE_LOOP_CONFIG } from "./config/compositions/inference-loop.js";
import { CONTEXT_WINDOW_CONFIG } from "./config/compositions/context-window.js";
import { TOOL_LOOP_CONFIG } from "./config/compositions/tool-loop.js";
import { VORONOI_CONFIG } from "./config/compositions/voronoi.js";
import { L_TREE_CONFIG } from "./config/compositions/l-tree.js";
import { GAME_OF_LIFE_CONFIG } from "./config/compositions/game-of-life.js";
import { BASE_CONFIG } from "./config/compositions/base.js";
import { NOISE_GRID_CONFIG } from "./config/compositions/noise-grid.js";
import { mergeFlickerSettings } from "./src/visuals/flicker/index.js";
import { resolveSceneTransitionSettings } from "./src/scene-transitions/index.js";
import { resolveCellTransitionSettings } from "./src/cell-transitions/transition-settings.js";
import { resolveCompositionEndpointSettings } from "./src/composition-endpoints/index.js";
import {
  resolveTimelineDuration,
  resolveTimelineSettings,
} from "./src/timeline/timeline-settings.js";

export { GLOBAL_CONFIG } from "./config/global.js";
export { SHARED_CONFIG } from "./config/shared.js";
export { INTERACTIVE_GRID_CONFIG } from "./config/compositions/interactive-grid.js";
export { FLOCK_GRID_CONFIG } from "./config/compositions/flock-grid.js";
export {
  INFERENCE_LOOP_CONFIG,
  THINKING_CONFIG,
} from "./config/compositions/inference-loop.js";
export { CONTEXT_WINDOW_CONFIG } from "./config/compositions/context-window.js";
export { TOOL_LOOP_CONFIG } from "./config/compositions/tool-loop.js";
export { VORONOI_CONFIG } from "./config/compositions/voronoi.js";
export { L_TREE_CONFIG } from "./config/compositions/l-tree.js";
export { GAME_OF_LIFE_CONFIG } from "./config/compositions/game-of-life.js";
export { BASE_CONFIG } from "./config/compositions/base.js";
export { NOISE_GRID_CONFIG } from "./config/compositions/noise-grid.js";

export const COMPOSITION_BUNDLES = Object.freeze({
  base: BASE_CONFIG,
  "noise-grid": NOISE_GRID_CONFIG,
  "inference-loop": INFERENCE_LOOP_CONFIG,
  "context-window": CONTEXT_WINDOW_CONFIG,
  "tool-loop": TOOL_LOOP_CONFIG,
  voronoi: VORONOI_CONFIG,
  "l-tree": L_TREE_CONFIG,
  "game-of-life": GAME_OF_LIFE_CONFIG,
  "interactive-grid": INTERACTIVE_GRID_CONFIG,
  "flock-grid": FLOCK_GRID_CONFIG,
});

// Compatibility export retained for code that imported the old family-map
// name. The keys are bundle IDs; public composition IDs live inside each bundle.
export const COMPOSITION_CONFIGS = COMPOSITION_BUNDLES;

function mergeUnique(label, sections) {
  const merged = {};
  for (const section of sections) {
    for (const [name, value] of Object.entries(section ?? {})) {
      if (Object.hasOwn(merged, name)) {
        throw new Error(`Duplicate ${label} "${name}" in composition config.`);
      }
      merged[name] = value;
    }
  }
  return merged;
}

const compositionConfigs = Object.values(COMPOSITION_BUNDLES);

function definitionGeneratorIds(definition) {
  const ids = [];
  const visit = value => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.use === "string") ids.push(value.use);
    if (value.steps !== undefined) visit(value.steps);
    if (value.layers !== undefined) visit(value.layers);
  };
  visit(definition?.steps ?? definition?.layers);
  return ids;
}

// Timing is authored by a composition recipe, then injected into each settings
// group that recipe uses. This keeps clock ownership with the rule while the
// existing generator API continues to receive a flat options object.
function timingBySettingsKey(configs) {
  const byKey = new Map();
  for (const config of configs) {
    for (const [compositionName, definition] of Object.entries(
      config.compositionDefinitions ?? {},
    )) {
      const canonical = definition.legacyAliasFor === undefined
        ? definition
        : config.compositionDefinitions?.[definition.legacyAliasFor];
      const authored = definition.timing ?? canonical?.timing;
      if (authored === undefined) continue;
      const timing = resolveTimelineSettings(
        authored,
        `compositionDefinitions.${compositionName}.timing`,
      );
      for (const id of definitionGeneratorIds(definition)) {
        const generator = config.generatorDefinitions?.[id];
        const key = generator?.settingsKey
          ?? (typeof generator?.options === "string" ? generator.options : null);
        if (key === null) continue;
        const existing = byKey.get(key);
        if (
          existing
          && (
            existing.bodyDurationSeconds !== timing.bodyDurationSeconds
            || existing.beatCount !== timing.beatCount
          )
        ) {
          throw new Error(
            `SETTINGS.${key} is used by compositions with conflicting timing roots.`,
          );
        }
        byKey.set(key, timing);
      }
    }
  }
  return byKey;
}

const compositionTimingBySettingsKey = timingBySettingsKey(compositionConfigs);

// A settings group that declares `flicker` inherits the app-wide flicker
// defaults and overrides only the keys it authored. Groups without flicker are
// untouched, and the composition config modules stay unmutated.
function withGlobalFlickerDefaults(settingsGroups) {
  const resolved = {};
  for (const [name, group] of Object.entries(settingsGroups)) {
    resolved[name] = group?.flicker === undefined
      ? group
      : {
        ...group,
        flicker: mergeFlickerSettings(GLOBAL_CONFIG.flicker, group.flicker),
      };
  }
  return resolved;
}

// A composition settings group inherits the app-wide palette, cell transition,
// intro, and outro. It can override them locally; authored modules stay
// unmutated.
function withGlobalCompositionDefaults(settingsGroups) {
  const resolved = {};
  for (const [name, group] of Object.entries(settingsGroups ?? {})) {
    const cellTransitions = resolveCellTransitionSettings(
      GLOBAL_CONFIG.cellTransitions,
      group?.cellTransitions,
    );
    const intro = resolveSceneTransitionSettings(GLOBAL_CONFIG.intro, group?.intro);
    const globalOutro = GLOBAL_CONFIG.outro === undefined
      ? resolveSceneTransitionSettings(intro, { fallbackToIntro: true })
      : resolveSceneTransitionSettings(intro, GLOBAL_CONFIG.outro);
    resolved[name] = {
      palette: GLOBAL_CONFIG.palette,
      ...group,
      cellTransitions,
      intro,
      // A local outro overrides the app-wide outro. It never accidentally
      // inherits the intro merely because it authored one field.
      outro: group?.outro === undefined
        ? globalOutro
        : resolveSceneTransitionSettings(globalOutro, group.outro),
    };
  }
  return resolved;
}

function resolvedPhaseTiming(settings, timing, label) {
  const duration = resolveTimelineDuration(settings.durationSeconds, {
    automaticSeconds: timing.beatSeconds,
    label: `${label}.durationSeconds`,
    source: "composition-beat",
  });
  return { ...settings, durationSeconds: duration.seconds };
}

// Compile every composition's phase and endpoint durations before any
// generator exists. Automatic values therefore cannot change with the active
// render plan or a runtime mode swap.
function withResolvedCompositionTiming(settingsGroups, timingByKey) {
  const resolved = {};
  for (const [name, group] of Object.entries(settingsGroups ?? {})) {
    const authoredTiming = timingByKey.get(name);
    if (authoredTiming === undefined) {
      resolved[name] = group;
      continue;
    }
    const timing = resolveTimelineSettings(authoredTiming, `SETTINGS.${name}.timing`);
    const intro = resolvedPhaseTiming(group.intro, timing, `SETTINGS.${name}.intro`);
    const outro = resolvedPhaseTiming(group.outro, timing, `SETTINGS.${name}.outro`);
    const endpoints = resolveCompositionEndpointSettings(
      GLOBAL_CONFIG.composition,
      group.circleEndpoints ?? {},
    );
    const startDuration = resolveTimelineDuration(endpoints.start.durationSeconds, {
      automaticSeconds: intro.durationSeconds,
      label: `SETTINGS.${name}.circleEndpoints.start.durationSeconds`,
      source: "intro-phase",
    });
    const endDuration = resolveTimelineDuration(endpoints.end.durationSeconds, {
      automaticSeconds: outro.durationSeconds,
      label: `SETTINGS.${name}.circleEndpoints.end.durationSeconds`,
      source: "outro-phase",
    });
    const colorTransition = group.colorTransition === undefined
      ? undefined
      : {
        ...group.colorTransition,
        durationSeconds: resolveTimelineDuration(
          group.colorTransition.durationSeconds,
          {
            automaticSeconds: timing.beatSeconds,
            label: `SETTINGS.${name}.colorTransition.durationSeconds`,
            source: "composition-beat",
          },
        ).seconds,
      };
    resolved[name] = {
      ...group,
      timing,
      intro,
      outro,
      circleEndpoints: {
        circleSubdivision: endpoints.circleSubdivision,
        start: { ...endpoints.start, durationSeconds: startDuration.seconds },
        end: { ...endpoints.end, durationSeconds: endDuration.seconds },
        modes: endpoints.modes,
      },
      ...(colorTransition === undefined ? {} : { colorTransition }),
    };
  }
  return resolved;
}

// These assembled aliases preserve the existing director/generator API while
// authoring stays separated by ownership above.
export const SETTINGS = withResolvedCompositionTiming(
  withGlobalFlickerDefaults(mergeUnique("settings group", [
    {
      canvas: GLOBAL_CONFIG.canvas,
      composition: GLOBAL_CONFIG.composition,
      cellTransitions: GLOBAL_CONFIG.cellTransitions,
      noiseFields: GLOBAL_CONFIG.noiseFields,
    },
    SHARED_CONFIG.settings,
    ...compositionConfigs.map(config => withGlobalCompositionDefaults(config.settings)),
  ])),
  compositionTimingBySettingsKey,
);

export const PALETTES = GLOBAL_CONFIG.palettes;

export const GENERATOR_DEFINITIONS = mergeUnique(
  "generator definition",
  compositionConfigs.map(config => config.generatorDefinitions),
);

export const COMPOSITION_DEFINITIONS = mergeUnique(
  "composition definition",
  compositionConfigs.map(config => config.compositionDefinitions),
);
