import { FactoryRegistry } from "./core/registry.js";
import { SequenceRule } from "./compositions/sequence-rule.js";
import { InteractiveTakeRule } from "./compositions/interactive-take-rule.js";
import { createCellTransitionModeRegistry } from "./cell-transitions/index.js";
import { RoundedRectRenderer } from "./shapes/rounded-rect.js";
import { FlockGridGenerator } from "./generators/flock-grid-generator.js";
import { InteractiveGridGenerator } from "./generators/interactive-grid-generator.js";
import { InferenceGridGenerator } from "./generators/inference-grid-generator.js";
import { ProceduralTopologyGenerator } from "./generators/procedural-topology-generator.js";
import { CellularAutomataGenerator } from "./generators/cellular-automata-generator.js";
import { WaveFieldGenerator } from "./generators/wave-field-generator.js";
import { PathfindingGenerator } from "./generators/pathfinding-generator.js";
import { BaseCompositionGenerator } from "./generators/base-composition-generator.js";
import { createSceneTransitionModeRegistry } from "./scene-transitions/index.js";
import { NoiseCircleGridGenerator } from "./generators/noise-circle-grid-generator.js";
import { CountdownFramedGenerator } from "./generators/countdown-framed-generator.js";
import { createNoiseFieldRegistry } from "./noise-fields/index.js";

// This is the implementation catalog. Generator factories are registered here;
// cell-transition factories live in cell-transitions/index.js. Compositions
// continue to refer to stable string ids in config.js.
export function createCatalog({ palettes }) {
  const generatorTypes = new FactoryRegistry("generator type");
  const compositionRules = new FactoryRegistry("composition rule");
  const cellTransitionTypes = createCellTransitionModeRegistry();
  const sceneTransitionTypes = createSceneTransitionModeRegistry();
  const shapeRenderer = new RoundedRectRenderer();
  const noiseFieldModes = createNoiseFieldRegistry();

  compositionRules.register(
    "sequence",
    ({ definition }) => new SequenceRule(definition),
  );
  compositionRules.register(
    "interactive-take",
    creationContext => new InteractiveTakeRule(creationContext),
  );

  generatorTypes.register(
    "noise-circle-grid",
    creationContext => new NoiseCircleGridGenerator({ ...creationContext, palettes, noiseFieldModes }),
  );

  generatorTypes.register(
    "countdown-framed",
    creationContext => new CountdownFramedGenerator({ ...creationContext, palettes }),
  );

  generatorTypes.register(
    "base-composition",
    creationContext => new BaseCompositionGenerator({
      ...creationContext,
      palettes,
      sceneTransitionTypes,
    }),
  );

  generatorTypes.register(
    "flock-grid",
    creationContext => new FlockGridGenerator({
      ...creationContext,
      cellTransitionTypes,
      palettes,
      shapeRenderer,
      sceneTransitionTypes,
    }),
  );

  generatorTypes.register(
    "interactive-grid",
    creationContext => new InteractiveGridGenerator({
      ...creationContext,
      palettes,
      shapeRenderer,
      sceneTransitionTypes,
    }),
  );

  generatorTypes.register(
    "inference-grid",
    creationContext => new InferenceGridGenerator({
      ...creationContext,
      cellTransitionTypes,
      palettes,
      sceneTransitionTypes,
    }),
  );

  generatorTypes.register(
    "procedural-topology",
    creationContext => new ProceduralTopologyGenerator({
      ...creationContext,
      cellTransitionTypes,
      palettes,
      sceneTransitionTypes,
    }),
  );

  generatorTypes.register(
    "cellular-automata",
    creationContext => new CellularAutomataGenerator({
      ...creationContext,
      cellTransitionTypes,
      palettes,
      sceneTransitionTypes,
    }),
  );

  generatorTypes.register(
    "wave-field",
    creationContext => new WaveFieldGenerator({
      ...creationContext,
      cellTransitionTypes,
      palettes,
      sceneTransitionTypes,
    }),
  );

  generatorTypes.register(
    "pathfinding",
    creationContext => new PathfindingGenerator({
      ...creationContext,
      cellTransitionTypes,
      palettes,
      sceneTransitionTypes,
    }),
  );

  return {
    generatorTypes,
    compositionRules,
    cellTransitionTypes,
    sceneTransitionTypes,
    noiseFieldModes,
  };
}
