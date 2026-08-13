import { FactoryRegistry } from "./core/registry.js";
import { SequenceRule } from "./compositions/sequence-rule.js";
import { SquarifyTransition } from "./cell-transitions/squarify.js";
import { NoneTransition } from "./cell-transitions/none.js";
import { FlipDotTransition } from "./cell-transitions/flip-dot.js";
import { RoundedRectRenderer } from "./shapes/rounded-rect.js";
import { FlockGridGenerator } from "./generators/flock-grid-generator.js";
import { InteractiveGridGenerator } from "./generators/interactive-grid-generator.js";
import { InferenceGridGenerator } from "./generators/inference-grid-generator.js";
import { ProceduralTopologyGenerator } from "./generators/procedural-topology-generator.js";
import { CellularAutomataGenerator } from "./generators/cellular-automata-generator.js";
import { WaveFieldGenerator } from "./generators/wave-field-generator.js";
import { PathfindingGenerator } from "./generators/pathfinding-generator.js";

// This is the only implementation catalog. Adding a generator or cell transition
// means importing it here and registering one factory; compositions continue
// to refer to stable string ids in config.js.
export function createCatalog({ palettes }) {
  const generatorTypes = new FactoryRegistry("generator type");
  const compositionRules = new FactoryRegistry("composition rule");
  const cellTransitionTypes = new FactoryRegistry("cell transition");
  const shapeRenderer = new RoundedRectRenderer();

  cellTransitionTypes
    .register("squarify", options => new SquarifyTransition(options))
    .register("none", options => new NoneTransition(options))
    .register("flip-dot", options => new FlipDotTransition(options));

  compositionRules.register(
    "sequence",
    ({ definition }) => new SequenceRule(definition),
  );

  generatorTypes.register(
    "flock-grid",
    creationContext => new FlockGridGenerator({
      ...creationContext,
      cellTransitionTypes,
      palettes,
      shapeRenderer,
    }),
  );

  generatorTypes.register(
    "interactive-grid",
    creationContext => new InteractiveGridGenerator({
      ...creationContext,
      palettes,
      shapeRenderer,
    }),
  );

  generatorTypes.register(
    "inference-grid",
    creationContext => new InferenceGridGenerator({
      ...creationContext,
      palettes,
    }),
  );

  generatorTypes.register(
    "procedural-topology",
    creationContext => new ProceduralTopologyGenerator({
      ...creationContext,
      palettes,
    }),
  );

  generatorTypes.register(
    "cellular-automata",
    creationContext => new CellularAutomataGenerator({
      ...creationContext,
      palettes,
    }),
  );

  generatorTypes.register(
    "wave-field",
    creationContext => new WaveFieldGenerator({
      ...creationContext,
      palettes,
    }),
  );

  generatorTypes.register(
    "pathfinding",
    creationContext => new PathfindingGenerator({
      ...creationContext,
      palettes,
    }),
  );

  return {
    generatorTypes,
    compositionRules,
    cellTransitionTypes,
  };
}
