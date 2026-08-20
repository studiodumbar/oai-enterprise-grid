import { createArrangementModeRegistry } from "../transitions/index.js";

export {
  DEFAULT_SCENE_TRANSITION_SETTINGS,
  resolveSceneTransitionSettings,
} from "./transition-settings.js";
export {
  SCENE_TRANSITION_DIRECTIONS,
  SceneTransition,
} from "./scene-transition.js";

/**
 * The intro/outro end of the shared arrangement pool. It is the same registry
 * the between-state transitions use; which phases a mode may run in is the
 * mode's own declaration, checked when the transition resolves it.
 */
export function createSceneTransitionModeRegistry() {
  return createArrangementModeRegistry("scene-transition mode");
}
