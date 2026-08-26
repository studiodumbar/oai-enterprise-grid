# Reusable Global and Per-Composition Config Architecture

## Purpose

This architecture is for creative applications that contain several radically different compositions, scenes, tools, or experiences but still need coherent app-wide behavior.

The main idea is simple:

> Authors write small global defaults and small local overrides. A startup compiler turns them into complete, validated, immutable runtime settings.

The runtime never decides how inheritance works. It receives resolved settings and renders with them.

## The layers

Use four distinct layers with clear ownership:

```text
global config
    app-wide defaults and catalogs
          ↓
optional shared config
    defaults shared by a subset of compositions
          ↓
composition bundle
    local settings + component definitions + composition recipe
          ↓
config facade/compiler
    merge → validate → resolve timing → freeze → publish runtime maps
```

### 1. Global config

Global config owns values that should feel consistent across the whole application:

- canvas/runtime defaults
- UI, debug, and application behavior defaults
- default palette or theme
- default intro/outro and transition behavior
- global effect defaults, per-mode settings, and reusable catalogs

Global values are defaults, not commands. A composition inherits them unless it explicitly overrides them.

### 2. Shared config

Keep an optional shared layer for settings used by several composition families but not by the whole app. Do not put values here preemptively; an empty shared layer is healthy. Add a shared value only when real duplication appears.

### 3. Composition bundles

Each composition or composition family owns one module containing three independent sections:

```js
export const EXAMPLE_BUNDLE = {
  settings: {
    example: {
      palette: "warm",
      transition: {
        durationSeconds: "auto",
      },
      effect: {
        mode: "pulse",
        modes: {
          pulse: { intensity: 0.8 },
        },
      },
    },
  },

  componentDefinitions: {
    exampleRenderer: {
      type: "example",
      settingsKey: "example",
    },
  },

  compositionDefinitions: {
    example: {
      timing: {
        bodyDurationSeconds: 12,
        beatCount: 6,
      },
      rule: "sequence",
      steps: [{ use: "exampleRenderer" }],
    },
  },
};
```

These sections answer different questions:

- `settings`: how a component behaves and looks
- `componentDefinitions`: which implementation to create and which settings it consumes
- `compositionDefinitions`: how components are orchestrated over time

Keep timing with the composition recipe because the recipe owns the experience's clock. Do not hide the main clock inside a renderer or effect.

### 4. Config facade/compiler

Create one public config module that imports every bundle and publishes the runtime contract:

```js
export const SETTINGS = /* fully resolved settings by key */;
export const COMPONENT_DEFINITIONS = /* unique component definitions */;
export const COMPOSITION_DEFINITIONS = /* unique composition recipes */;
export const CATALOGS = /* palettes, modes, presets, etc. */;
```

This facade is a compiler, not a bag of re-exports. At startup it should:

1. collect all bundles and reject duplicate IDs
2. verify every definition references an existing settings key, implementation type, and composition target
3. merge global/shared/local layers according to each subsystem's schema
4. resolve every automatic value and validate cross-references or conflicting clocks
5. freeze or clone the resolved output without mutating authored modules

After this phase, runtime code should not read raw composition files.

## Inheritance and override rules

The precedence order is:

```text
library defaults < global config < shared defaults < composition override
```

Use composition overrides field by field. If global config says:

```js
effect: {
  enabled: true,
  mode: "pulse",
  amount: 0.5,
  modes: {
    pulse: { speed: 1, intensity: 0.4 },
    sweep: { speed: 2, width: 0.2 },
  },
}
```

and a composition authors:

```js
effect: {
  amount: 0.9,
  modes: {
    pulse: { intensity: 0.8 },
  },
}
```

the resolved result keeps `enabled`, `mode`, both modes, and `pulse.speed`; only `amount` and `pulse.intensity` change.

Do not use a generic recursive deep-merge utility for everything. Define merge behavior per subsystem:

- scalar values: later layer replaces earlier layer
- named mode tables: merge by mode name, then by setting key
- arrays: normally replace as one authored decision; do not merge by index
- optional feature block: preserve absence when absence has meaning
- `null`: treat as an intentional value when it means “disabled” or “inherit from another source”; document which one
- unknown keys: reject in strict schemas, or preserve only when a registered plugin explicitly owns them

Each subsystem should expose one resolver such as `resolveTransitionSettings(global, local)`. That keeps inheritance rules beside validation rules instead of scattering object spreads across the application.

## One timing root and the beat system

Every finite composition owns exactly one explicit timing root:

```js
timing: {
  bodyDurationSeconds: 12,
  beatCount: 6,
}
```

Both fields are mandatory and explicit:

```text
beatSeconds = bodyDurationSeconds / beatCount
```

- `bodyDurationSeconds` must be a finite positive number. It must never be automatic.
- `beatCount` must be a positive integer.
- `beatSeconds` is derived once during config compilation.

This gives every composition its own natural rhythm without forcing all compositions to have the same duration. A slow six-beat composition and a fast six-beat composition share semantics, not seconds.

## Automatic durations

Allow duration fields to accept:

```js
durationSeconds: 1.25
durationSeconds: "auto"
durationSeconds: "calc(auto * 1.5)"
```

The meanings are:

- number: explicit seconds; ignore the automatic anchor
- `"auto"`: use the field's documented parent duration
- `"calc(auto * n)"`: multiply that same parent by a positive finite number

The critical rule is that every automatic field has exactly one named anchor. Never search several values and take the first available one. Example dependency graph:

```text
explicit bodyDurationSeconds + beatCount
                    │
                    └── beatSeconds
                         ├── intro duration
                         ├── outro duration
                         ├── effect cycle
                         └── transition duration

resolved intro duration ── intro content hold
resolved outro duration ── outro content hold
```

The exact children will differ in another project. Define the graph for that project's concepts, but preserve these rules:

1. roots are explicit
2. every automatic child names one parent
3. resolution happens once before runtime
4. missing parents and cycles are startup errors
5. explicit values always win; errors include the full field path and expected anchor

Return resolution metadata while compiling when useful:

```js
{
  authored: "calc(auto * 1.5)",
  source: "composition-beat",
  baseSeconds: 2,
  multiplier: 1.5,
  seconds: 3,
}
```

The runtime normally consumes only `seconds`, while tooling and debug output can show why it became that value.

## Avoid competing clocks

A renderer may need derived values such as state hold time, effect cycle length, or repeat count. Derive them from the composition timing root. Do not let components introduce independent `cycleSeconds`, `duration`, and `repeatCount` combinations that can disagree.

During migration, allow legacy timing aliases only if they equal the derived value:

```text
legacy value omitted       → use the timing root
legacy value matches       → accept temporarily
legacy value conflicts     → startup error naming both fields
```

A public alias for a composition should inherit its canonical recipe's timing rather than declaring another root.

## Registries and mode-owned defaults

Separate the existence of a behavior from its configuration:

- a registry answers which renderer, transition, effect, or rule types exist
- each registered mode owns its implementation defaults and normalization
- global config chooses app-wide defaults
- composition config overrides selected values
- the compiler validates settings for every authored/registered mode, not only the currently active one

Validating inactive mode blocks at startup prevents a later mode switch from surfacing a delayed config error.

Definitions should reference implementations and settings by stable IDs rather than importing concrete classes into config files. Reject unknown IDs and duplicate registrations immediately.

## Authored config versus resolved config

Treat authored modules as source documents:

- never mutate them during merge or normalization
- keep them readable and close to the composition they describe
- do not require authors to repeat inherited values
- optionally show inherited controls as commented examples, but avoid making comments the only schema documentation

Treat resolved config as compiled output:

- complete enough for runtime use
- numeric where automatic timing was allowed
- validated across references
- immutable or defensively cloned
- safe to snapshot for deterministic export and restore

This boundary makes tests clear: authored config should remain byte-for-byte or deep-equal unchanged after assembly.

## Failure behavior

Fail during startup, before a composition begins rendering, for:

- duplicate setting, component, or composition IDs
- missing settings references or unknown registry/rule types
- invalid types, ranges, or empty IDs
- incomplete automatic-duration graphs
- conflicting timing roots, including legacy clocks that disagree with the canonical root

Do not silently fall back when the result would change timing or visual behavior. A precise startup failure is cheaper than a composition that changes speed depending on runtime state.

## Tests that preserve the architecture

Test the config system as a compiler, not only individual values:

1. every bundle appears exactly once in the public facade; all IDs are unique and every cross-reference resolves
2. global defaults survive partial composition overrides, including nested mode settings and array-replacement semantics
3. authored objects remain unchanged; resolved timing objects are immutable
4. `auto` and `calc(auto * n)` resolve from their sole documented anchors, while missing anchors and conflicting clocks fail clearly
5. aliases inherit canonical timing, inactive modes are validated, and runtime consumers receive only resolved settings

## Adapting this to a radically different project

Reuse the architecture, not the domain vocabulary. Rename “composition,” “component,” “effect,” “intro,” and “beat” to match the new product. Keep the invariant roles:

```text
global defaults
local ownership bundles
stable ID references
schema-aware resolvers
one explicit timing root per experience
compile-once automatic dependencies
validated immutable runtime output
```

Start with the smallest useful schema. Add shared layers, automatic children, registries, aliases, and compatibility handling only when the new project actually needs them.
