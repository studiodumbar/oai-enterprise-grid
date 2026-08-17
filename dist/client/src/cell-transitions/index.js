import { FactoryRegistry } from "../core/registry.js";
import { NoneTransition } from "./none.js";
import { SortSelectionTransitionMode } from "./sort-selection.js";

/** Registry shared by renderer-driven and discrete-state cell transitions. */
export function createCellTransitionModeRegistry() {
  return new FactoryRegistry("cell transition")
    .register("none", options => new NoneTransition(options))
    .register(
      "sort-selection",
      options => new SortSelectionTransitionMode(options),
    );
}

export { CellStateTransition } from "./cell-state-transition.js";
export { resolveCellTransitionSettings } from "./transition-settings.js";
