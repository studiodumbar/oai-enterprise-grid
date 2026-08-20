import test from "node:test";
import assert from "node:assert/strict";

import {
  SETTINGS,
  PALETTES,
  GENERATOR_DEFINITIONS,
  COMPOSITION_DEFINITIONS,
  GLOBAL_CONFIG,
  SHARED_CONFIG,
  COMPOSITION_BUNDLES,
  COMPOSITION_CONFIGS,
} from "../config.js";
import { createCatalog } from "../src/catalog.js";
import { resolveSceneTransitionSettings } from "../src/scene-transitions/index.js";
import { resolveCellTransitionSettings } from "../src/cell-transitions/transition-settings.js";

const EXPECTED_BUNDLE_OWNERSHIP = Object.freeze({
  base: {
    settings: ["base"],
    generators: ["baseGrid"],
    compositions: ["base"],
  },
  "inference-loop": {
    settings: ["inferenceLoop"],
    generators: ["inferenceLoopGrid"],
    compositions: ["inference-loop", "thinking"],
  },
  "context-window": {
    settings: ["contextWindow"],
    generators: ["contextWindowGrid"],
    compositions: ["context-window"],
  },
  "tool-loop": {
    settings: ["toolLoop"],
    generators: ["toolLoopGrid"],
    compositions: ["tool-loop"],
  },
  voronoi: {
    settings: ["voronoi"],
    generators: ["voronoiGrid"],
    compositions: ["voronoi"],
  },
  "l-tree": {
    settings: ["lTree"],
    generators: ["lTreeGrid"],
    compositions: ["l-tree"],
  },
  "game-of-life": {
    settings: ["gameOfLife"],
    generators: ["gameOfLifeAutomaton"],
    compositions: ["game-of-life"],
  },
  "interactive-grid": {
    settings: ["interactiveGrid"],
    generators: ["interactiveGrid"],
    compositions: ["interactive-grid"],
  },
  "flock-grid": {
    settings: ["flock", "grid", "typography"],
    generators: ["flockGrid"],
    compositions: ["flock", "flock-circles"],
  },
});

const EXPECTED_GRID_HIERARCHY = Object.freeze([
  {
    compositionId: "base",
    generatorInstanceId: "baseGrid",
    generatorType: "base-composition",
    settingsKey: "base",
    strategy: undefined,
  },
  {
    compositionId: "inference-loop",
    generatorInstanceId: "inferenceLoopGrid",
    generatorType: "inference-grid",
    settingsKey: "inferenceLoop",
    strategy: "inference-loop",
  },
  {
    compositionId: "thinking",
    generatorInstanceId: "inferenceLoopGrid",
    generatorType: "inference-grid",
    settingsKey: "inferenceLoop",
    strategy: "inference-loop",
  },
  {
    compositionId: "context-window",
    generatorInstanceId: "contextWindowGrid",
    generatorType: "inference-grid",
    settingsKey: "contextWindow",
    strategy: "context-window",
  },
  {
    compositionId: "tool-loop",
    generatorInstanceId: "toolLoopGrid",
    generatorType: "inference-grid",
    settingsKey: "toolLoop",
    strategy: "tool-loop",
  },
  {
    compositionId: "voronoi",
    generatorInstanceId: "voronoiGrid",
    generatorType: "procedural-topology",
    settingsKey: "voronoi",
    strategy: "voronoi",
  },
  {
    compositionId: "l-tree",
    generatorInstanceId: "lTreeGrid",
    generatorType: "procedural-topology",
    settingsKey: "lTree",
    strategy: "l-tree",
  },
  {
    compositionId: "game-of-life",
    generatorInstanceId: "gameOfLifeAutomaton",
    generatorType: "cellular-automata",
    settingsKey: "gameOfLife",
    strategy: "life-like",
  },
]);

const LEGACY_PUBLIC_COMPOSITION_IDS = Object.freeze([
  "thinking",
  "context-window",
  "tool-loop",
  "voronoi",
  "l-tree",
  "game-of-life",
  "interactive-grid",
  "flock",
  "flock-circles",
]);

function ownKeys(value) {
  return Object.keys(value).sort();
}

function assertDisjointEntries(groups, kind) {
  const ownerByKey = new Map();
  for (const [owner, entries] of groups) {
    for (const key of Object.keys(entries)) {
      assert.equal(
        ownerByKey.has(key),
        false,
        `${kind} "${key}" is owned by both "${ownerByKey.get(key)}" and "${owner}".`,
      );
      ownerByKey.set(key, owner);
    }
  }
  return ownerByKey;
}

// Composition settings groups are the one place the facade builds a merged copy
// instead of forwarding the bundle's object: app-wide palette, cell-transition,
// intro, and flicker values fill in whatever the composition left unauthored.
function assertInheritsGlobalDefaults(assembled, authored, name, inheritsPalette) {
  const {
    cellTransitions: assembledCellTransitions,
    flicker: assembledFlicker,
    intro: assembledIntro,
    outro: assembledOutro,
    palette: assembledPalette,
    ...assembledRest
  } = assembled;
  const {
    cellTransitions: authoredCellTransitions,
    flicker: authoredFlicker,
    intro: authoredIntro,
    outro: authoredOutro,
    palette: authoredPalette,
    ...authoredRest
  } = authored;
  assert.deepEqual(
    assembledCellTransitions,
    resolveCellTransitionSettings(
      GLOBAL_CONFIG.cellTransitions,
      authoredCellTransitions,
    ),
    `${name} should override only the cell-transition values it authored.`,
  );
  assert.deepEqual(
    assembledRest,
    authoredRest,
    `${name} should keep every setting it authored beside palette and flicker.`,
  );
  if (inheritsPalette) {
    assert.equal(
      assembledPalette,
      authoredPalette ?? GLOBAL_CONFIG.palette,
      `${name} should inherit the app-wide palette unless it authored one.`,
    );
  } else {
    assert.equal(assembledPalette, authoredPalette);
  }
  assert.deepEqual(
    assembledIntro,
    resolveSceneTransitionSettings(GLOBAL_CONFIG.intro, authoredIntro),
    `${name} should override only the intro values it authored.`,
  );
  // An unauthored outro takes the app-wide block if there is one, and replays
  // the intro backward only when there is not.
  const inheritedOutro = authoredOutro ?? GLOBAL_CONFIG.outro;
  assert.deepEqual(
    assembledOutro,
    inheritedOutro === undefined
      ? resolveSceneTransitionSettings(assembledIntro, { fallbackToIntro: true })
      : resolveSceneTransitionSettings(assembledIntro, inheritedOutro),
    `${name} should inherit the app-wide outro, then its own intro.`,
  );
  if (authoredFlicker === undefined) {
    assert.equal(
      assembledFlicker,
      undefined,
      `${name} should stay without flicker until it authors one.`,
    );
    return;
  }
  assert.equal(assembledFlicker.enabled, GLOBAL_CONFIG.flicker.enabled);
  assert.equal(
    assembledFlicker.mode,
    authoredFlicker.mode ?? GLOBAL_CONFIG.flicker.mode,
  );
  assert.equal(
    assembledFlicker.amount,
    authoredFlicker.amount ?? GLOBAL_CONFIG.flicker.amount,
  );
  assert.deepEqual(
    assembledFlicker.envelope,
    authoredFlicker.envelope ?? {},
    `${name} should own its flicker envelope outright.`,
  );
  for (const [mode, settings] of Object.entries(GLOBAL_CONFIG.flicker.modes)) {
    assert.deepEqual(
      assembledFlicker.modes[mode],
      { ...settings, ...authoredFlicker.modes?.[mode] },
      `${name} should override only the flicker "${mode}" values it authored.`,
    );
  }
}

function assertSameAssembly(actual, groups, kind, inheritsGlobals = () => false) {
  const expectedKeys = groups.flatMap(([, entries]) => Object.keys(entries)).sort();
  assert.deepEqual(ownKeys(actual), expectedKeys, `${kind} facade is incomplete.`);

  for (const [owner, entries] of groups) {
    for (const [key, value] of Object.entries(entries)) {
      const inheritance = inheritsGlobals(value, owner);
      if (inheritance) {
        assertInheritsGlobalDefaults(actual[key], value, key, inheritance.palette);
        continue;
      }
      assert.strictEqual(
        actual[key],
        value,
        `${kind} "${key}" should retain its owning bundle's value.`,
      );
    }
  }
}

function assertNamedSetting(settings, name, owner) {
  assert.ok(
    Object.hasOwn(settings, name),
    `${owner} refers to missing setting "${name}".`,
  );
}

function settingsKeyForDefinition(definition, owner = "Definition") {
  const hasCanonicalReference = definition.settingsKey !== undefined;
  const hasOptions = definition.options !== undefined;
  assert.equal(
    hasCanonicalReference && hasOptions,
    false,
    `${owner} cannot use both settingsKey and options.`,
  );
  if (hasCanonicalReference) {
    assert.equal(
      typeof definition.settingsKey,
      "string",
      `${owner} settingsKey must be a string.`,
    );
    assert.notEqual(definition.settingsKey.trim(), "", `${owner} settingsKey cannot be blank.`);
    return definition.settingsKey;
  }
  return typeof definition.options === "string" ? definition.options : null;
}

function assertTransitionReferences(transition, settings, owner, cellTransitionTypes) {
  if (!transition) return;
  assert.equal(typeof transition.type, "string", `${owner} needs a transition type.`);
  assert.ok(
    cellTransitionTypes.has(transition.type),
    `${owner} refers to unregistered cell-transition type "${transition.type}".`,
  );
  if (typeof transition.options === "string") {
    assert.ok(
      settings.cellTransitions
        && Object.hasOwn(settings.cellTransitions.modes, transition.options),
      `${owner} refers to missing cell-transition options "${transition.options}".`,
    );
  }
}

function assertBundleReferences(
  family,
  bundle,
  globalSettings,
  sharedSettings,
  catalog,
) {
  const availableSettings = {
    ...globalSettings,
    ...sharedSettings,
    ...bundle.settings,
  };

  for (const [name, definition] of Object.entries(bundle.generatorDefinitions)) {
    const owner = `${family} generator "${name}"`;
    assert.equal(typeof definition.type, "string", `${owner} needs a generator type.`);
    assert.ok(
      catalog.generatorTypes.has(definition.type),
      `${owner} refers to unregistered generator type "${definition.type}".`,
    );
    const settingsKey = settingsKeyForDefinition(definition, owner);
    if (settingsKey !== null) assertNamedSetting(availableSettings, settingsKey, owner);
    for (const property of ["gridSettings", "typographySettings", "flockSettings"]) {
      if (typeof definition[property] === "string") {
        assertNamedSetting(availableSettings, definition[property], owner);
      }
    }
    assertTransitionReferences(
      definition.cellTransition,
      availableSettings,
      owner,
      catalog.cellTransitionTypes,
    );
  }

  for (const [name, definition] of Object.entries(bundle.compositionDefinitions)) {
    const owner = `${family} composition "${name}"`;
    assert.equal(typeof definition.rule, "string", `${owner} needs a rule.`);
    assert.ok(
      catalog.compositionRules.has(definition.rule),
      `${owner} refers to unregistered composition rule "${definition.rule}".`,
    );
    assert.ok(
      Array.isArray(definition.steps) && definition.steps.length > 0,
      `${owner} needs at least one step.`,
    );
    if (definition.legacyAliasFor !== undefined) {
      assert.ok(
        Object.hasOwn(bundle.compositionDefinitions, definition.legacyAliasFor),
        `${owner} aliases missing composition "${definition.legacyAliasFor}".`,
      );
    }
    for (const [index, step] of definition.steps.entries()) {
      assert.ok(
        Object.hasOwn(bundle.generatorDefinitions, step.use),
        `${owner} step ${index} refers outside its bundle to "${step.use}".`,
      );
      assertTransitionReferences(
        step.cellTransition,
        availableSettings,
        `${owner} step ${index}`,
        catalog.cellTransitionTypes,
      );
    }
  }

  for (const [name, options] of Object.entries(bundle.settings)) {
    if (typeof options.palette === "string") {
      assert.ok(
        Object.hasOwn(PALETTES, options.palette),
        `${family} setting "${name}" refers to missing palette "${options.palette}".`,
      );
    }
  }
}

test("config facade preserves explicit global, shared, and bundle ownership", () => {
  assert.equal(typeof GLOBAL_CONFIG.composition.startWithCircle, "boolean");
  assert.equal(typeof GLOBAL_CONFIG.composition.endWithCircle, "boolean");
  assert.ok(
    GLOBAL_CONFIG.composition.startWithCircleDurationSeconds === "auto"
      || GLOBAL_CONFIG.composition.startWithCircleDurationSeconds > 0,
  );
  assert.ok(
    GLOBAL_CONFIG.composition.endWithCircleDurationSeconds === "auto"
      || GLOBAL_CONFIG.composition.endWithCircleDurationSeconds > 0,
  );
  assert.ok(GLOBAL_CONFIG.cellTransitions.durationSeconds > 0);
  assert.ok(
    [1, 2, 4, 8, 16].includes(GLOBAL_CONFIG.composition.circleSubdivision),
  );
  assert.ok(GLOBAL_CONFIG.composition.circleEndpoints.modes.dijkstra);
  assert.deepEqual(
    ownKeys(GLOBAL_CONFIG),
    [
      "canvas",
      "cellTransitions",
      "composition",
      "debug",
      "flicker",
      "intro",
      "outro",
      "palette",
      "palettes",
      "ui",
    ],
  );
  assert.deepEqual(ownKeys(SHARED_CONFIG), ["settings"]);
  assert.deepEqual(ownKeys(SHARED_CONFIG.settings), []);
  assert.deepEqual(ownKeys(COMPOSITION_BUNDLES), ownKeys(EXPECTED_BUNDLE_OWNERSHIP));
  assert.strictEqual(COMPOSITION_CONFIGS, COMPOSITION_BUNDLES);

  for (const [family, expected] of Object.entries(EXPECTED_BUNDLE_OWNERSHIP)) {
    const bundle = COMPOSITION_BUNDLES[family];
    assert.deepEqual(
      ownKeys(bundle),
      ["compositionDefinitions", "generatorDefinitions", "settings"],
      `${family} should expose one self-contained config bundle.`,
    );
    assert.deepEqual(ownKeys(bundle.settings), [...expected.settings].sort());
    assert.deepEqual(ownKeys(bundle.generatorDefinitions), [...expected.generators].sort());
    assert.deepEqual(ownKeys(bundle.compositionDefinitions), [...expected.compositions].sort());
  }

  const globalSettings = {
    canvas: GLOBAL_CONFIG.canvas,
    cellTransitions: GLOBAL_CONFIG.cellTransitions,
    composition: GLOBAL_CONFIG.composition,
  };
  const settingGroups = [
    ["global", globalSettings],
    ["shared", SHARED_CONFIG.settings],
    ...Object.entries(COMPOSITION_BUNDLES).map(([family, bundle]) => [
      family,
      bundle.settings,
    ]),
  ];
  const generatorGroups = Object.entries(COMPOSITION_BUNDLES).map(([family, bundle]) => [
    family,
    bundle.generatorDefinitions,
  ]);
  const compositionGroups = Object.entries(COMPOSITION_BUNDLES).map(([family, bundle]) => [
    family,
    bundle.compositionDefinitions,
  ]);

  assertDisjointEntries(settingGroups, "Setting");
  assertDisjointEntries(generatorGroups, "Generator");
  assertDisjointEntries(compositionGroups, "Composition");
  // Composition-owned groups inherit the app-wide palette; the global and
  // shared groups keep whatever they authored and only merge flicker.
  assertSameAssembly(
    SETTINGS,
    settingGroups,
    "Settings",
    (group, owner) => {
      const ownedByComposition = owner !== "global" && owner !== "shared";
      if (!ownedByComposition && group?.flicker === undefined) return false;
      return { palette: ownedByComposition };
    },
  );
  assertSameAssembly(GENERATOR_DEFINITIONS, generatorGroups, "Generator definitions");
  assertSameAssembly(COMPOSITION_DEFINITIONS, compositionGroups, "Composition definitions");
  assert.strictEqual(PALETTES, GLOBAL_CONFIG.palettes);
  assert.ok(
    Object.hasOwn(PALETTES, GLOBAL_CONFIG.palette),
    `The app-wide palette "${GLOBAL_CONFIG.palette}" is missing from PALETTES.`,
  );
});

test("public compositions expose the explicit configuration hierarchy", () => {
  for (const expected of EXPECTED_GRID_HIERARCHY) {
    const composition = COMPOSITION_DEFINITIONS[expected.compositionId];
    assert.ok(composition, `Missing public composition "${expected.compositionId}".`);
    assert.deepEqual(
      composition.steps,
      [{ use: expected.generatorInstanceId }],
      `${expected.compositionId} should select its configured generator instance.`,
    );

    const generator = GENERATOR_DEFINITIONS[expected.generatorInstanceId];
    assert.ok(generator, `Missing generator instance "${expected.generatorInstanceId}".`);
    assert.deepEqual(
      {
        compositionId: expected.compositionId,
        generatorInstanceId: expected.generatorInstanceId,
        generatorType: generator.type,
        settingsKey: settingsKeyForDefinition(generator, expected.generatorInstanceId),
        strategy: generator.strategy,
      },
      expected,
    );
    assert.ok(
      Object.hasOwn(SETTINGS, expected.settingsKey),
      `${expected.generatorInstanceId} settingsKey should resolve through SETTINGS.`,
    );
  }

  assert.equal(COMPOSITION_DEFINITIONS.thinking.legacyAliasFor, "inference-loop");
  assert.deepEqual(
    COMPOSITION_DEFINITIONS.thinking.steps,
    COMPOSITION_DEFINITIONS["inference-loop"].steps,
  );
  for (const compositionId of LEGACY_PUBLIC_COMPOSITION_IDS) {
    assert.ok(
      Object.hasOwn(COMPOSITION_DEFINITIONS, compositionId),
      `Legacy public composition "${compositionId}" must remain available.`,
    );
  }
});

test("all configured settings and implementation references resolve", () => {
  const globalSettings = {
    canvas: GLOBAL_CONFIG.canvas,
    cellTransitions: GLOBAL_CONFIG.cellTransitions,
    composition: GLOBAL_CONFIG.composition,
  };
  const catalog = createCatalog({ palettes: PALETTES });

  for (const mode of Object.keys(GLOBAL_CONFIG.cellTransitions.modes)) {
    assert.ok(
      catalog.cellTransitionTypes.has(mode),
      `Global cell-transition mode "${mode}" is not registered.`,
    );
  }

  assert.ok(
    Object.hasOwn(COMPOSITION_DEFINITIONS, GLOBAL_CONFIG.composition.active),
    `Default composition "${GLOBAL_CONFIG.composition.active}" is not assembled.`,
  );
  for (const [family, bundle] of Object.entries(COMPOSITION_BUNDLES)) {
    assertBundleReferences(
      family,
      bundle,
      globalSettings,
      SHARED_CONFIG.settings,
      catalog,
    );
  }
});

test("settings references prefer settingsKey and retain legacy string options", () => {
  assert.equal(
    settingsKeyForDefinition({ settingsKey: "canonical" }),
    "canonical",
  );
  assert.equal(
    settingsKeyForDefinition({ options: "legacy" }),
    "legacy",
  );
  assert.equal(settingsKeyForDefinition({ options: { inline: true } }), null);
  assert.throws(
    () => settingsKeyForDefinition({ settingsKey: "canonical", options: "legacy" }),
    /cannot use both settingsKey and options/,
  );
});
