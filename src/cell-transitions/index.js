import { createArrangementModeRegistry } from "../transitions/index.js";
import { NoneTransition } from "./none.js";

/**
 * The between-state end of the shared arrangement pool, plus `none` — which is
 * also the cell-shaper port and therefore does not belong to the pool itself.
 */
export function createCellTransitionModeRegistry() {
  return createArrangementModeRegistry("cell transition")
    .register("none", options => new NoneTransition(options));
}

export { CellStateTransition } from "./cell-state-transition.js";
export { resolveCellTransitionSettings } from "./transition-settings.js";
