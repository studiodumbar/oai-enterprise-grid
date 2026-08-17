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
import { mergeFlickerSettings } from "./src/visuals/flicker/index.js";
import { resolveSceneTransitionSettings } from "./src/scene-transitions/index.js";
import { resolveCellTransitionSettings } from "./src/cell-transitions/transition-settings.js";

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

export const COMPOSITION_BUNDLES = Object.freeze({
  base: BASE_CONFIG,
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
    const authoredOutro = group?.outro ?? GLOBAL_CONFIG.outro;
    resolved[name] = {
      palette: GLOBAL_CONFIG.palette,
      ...group,
      cellTransitions,
      intro,
      outro: authoredOutro === undefined
        ? resolveSceneTransitionSettings(intro, { fallbackToIntro: true })
        : resolveSceneTransitionSettings(intro, authoredOutro),
    };
  }
  return resolved;
}

// These assembled aliases preserve the existing director/generator API while
// authoring stays separated by ownership above.
export const SETTINGS = withGlobalFlickerDefaults(mergeUnique("settings group", [
  {
    canvas: GLOBAL_CONFIG.canvas,
    composition: GLOBAL_CONFIG.composition,
    cellTransitions: GLOBAL_CONFIG.cellTransitions,
  },
  SHARED_CONFIG.settings,
  ...compositionConfigs.map(config => withGlobalCompositionDefaults(config.settings)),
]));

export const PALETTES = GLOBAL_CONFIG.palettes;

export const GENERATOR_DEFINITIONS = mergeUnique(
  "generator definition",
  compositionConfigs.map(config => config.generatorDefinitions),
);

export const COMPOSITION_DEFINITIONS = mergeUnique(
  "composition definition",
  compositionConfigs.map(config => config.compositionDefinitions),
);
