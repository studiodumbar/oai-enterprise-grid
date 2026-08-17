import { FactoryRegistry } from "../core/registry.js";
import { SortSelectionTransitionMode } from "./sort-selection.js";

export {
  DEFAULT_SCENE_TRANSITION_SETTINGS,
  resolveSceneTransitionSettings,
} from "./transition-settings.js";
export {
  SCENE_TRANSITION_DIRECTIONS,
  SceneTransition,
} from "./scene-transition.js";
export { SortSelectionTransitionMode } from "./sort-selection.js";

export function createSceneTransitionModeRegistry() {
  return new FactoryRegistry("scene-transition mode")
    .register(
      "sort-selection",
      options => new SortSelectionTransitionMode(options),
    );
}
