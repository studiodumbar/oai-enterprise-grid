# Circle Grid — p5.js

A real-time generative circle grid with inference, direct cell interaction,
and flocking-driven compositions. Composition timing, visual generators, and
per-cell transitions can evolve independently.

## Discrete circle-grid compositions

The project contains six distinct operational schematics. The inference scenes
do not claim to show private chain-of-thought, exact internal telemetry, or
literal model layer, head, or token counts. Voronoi, L-tree, and Game of Life
are separate procedural systems rather than inference representations.

All six share the same strict circle-face renderer and blank-hinge grammar. A
parent cell can show nothing, 1, 4, 16, or 64 circles. Count, color, and
whitespace change as a single face:
the old face switches off, the cell passes through a blank hinge, and the new
face switches on at the configured snap speed. Colors never ease between
values. Circles never slide, rotate, flatten, overlap an outgoing lattice, or
leave their fixed grid positions.

### Inference Loop — `inference-loop` (`thinking` legacy alias)

This is the primary new composition. Sparse, simultaneous feature snapshots stand
for the current position moving through model blocks while attending over
cached context; the earlier token states are not shown being recomputed. The
middle-right readout cell then becomes 64 fixed circles encoding a normalized,
compressed proxy for next-token probabilities. One candidate flips to the
selected color, the readout resolves to one committed circle, and a final
whole-field face represents appending that token to cached context.

Blank cells vary on every pass. They mean that a feature is below this
schematic's display threshold, not that the real model has an empty neuron or
zero activity there.

### Causal Horizon — `context-window`

The grid is a compressed aggregate influence field arranged along its long
axis. On wide canvases the causal frontier advances left-to-right; on tall
canvases it advances top-to-bottom. Past context exists behind that frontier,
while positions ahead remain genuinely blank because future tokens do not yet
exist. Several sparse aggregate-attention snapshots flip in place, the final
snapshot resolves at the frontier, and exactly one circle appears in the next
fixed slot. At the edge, the board starts a new window without sliding any
circle.

Behind the frontier, additional blanks mean influence below the display
threshold. The normalized weights are deterministic proxies, not reported
attention weights from a live ChatGPT request.

### Observe–Act Loop — `tool-loop`

This composition represents tool-enabled operation specifically. On wide
canvases the left field is model inference, the centre cell is a structured
tool-call gateway, and the right field is an external observation; on tall
canvases those regions rotate to top, centre, and bottom. Permanently blank
gutters mark the model/tool boundary. During the external wait the board
becomes almost entirely white; when the result arrives it appears
simultaneously at fixed observation positions, then the model field flips to
an assimilated context. The final face marks either a possible next tool
iteration or an answer-ready state, after which the schematic loop restarts.

An ordinary answer-only request can bypass this external loop; the composition
is not claiming that every ChatGPT response uses a tool.

### Voronoi Influence Field — `voronoi`

Several fixed cells act as competing influence sites. Discrete re-weighting
passes repartition the surrounding grid into colored territories; cells nearest
an uncertain boundary remain white, making the whitespace itself describe low
confidence. After the strongest basin wins the consensus face, every territory
retains its farthest non-boundary level-0 parent cell. Those fixed cells animate
as loaders through the commit and settle body window, then start concurrent
Dijkstra routes across parent-cell neighbors to the centre during the outro.
The merged route blinks, subdivides, and disappears in an accelerating cascade,
leaving one large dot at the centre. This is a weighted-Voronoi metaphor for
distributed competing evidence, not a map extracted from a model request.

### L-Tree Branch and Prune — `l-tree`

An L-system-inspired candidate tree grows along the canvas's long axis. Every
node is a fixed grid cell and every branch is an orthogonal chain of circles—no
lines or moving particles are introduced. Two sharp pruning faces retain one
route, which then resolves to a single terminal circle. The tree represents
hypothetical expansion and selection; it is not hidden chain-of-thought or a
literal tree built internally by ChatGPT.

### Conway Life — `game-of-life`

This direction uses editable Conway-style neighbor rules. `birthNeighbors` and
`survivalNeighbors` decide which dead cells are born and which living cells
survive; standard Conway Life is B3/S23. Every cell updates simultaneously and
every other cell becomes white. New births appear as 64 bright circles, while
survivors show 4 or 16 circles according to their neighbor count. After the
configured number of generations, a new deterministic seed field begins. This
explores how simple local rules create emergent global behavior; it is not a
claim that transformer inference is a cellular automaton.

The field is derived from the project's 32-bit seed. The active seed appears as
`state.generators.gameOfLifeAutomaton.seed` in inspection output and as
`params.seed` in embedded export metadata. Dropping a stamped export back onto
the app restores that seed before reconstructing the saved generation.

## Interactive grid composition

`interactive-grid` is the directly editable grid composition. Click any parent
grid cell to cycle through six stable states:

```text
empty → 1×1 → 2×2 → 4×4 → 8×8 → 16×16 → empty
```

Every active size uses the same visual system. At each palette change, every
parent grid cell independently rolls one of five color patterns: a serpentine
snake, diamond-in, diamond-out, waterfall, or rows. Rows make a second random
choice between top-to-bottom, bottom-to-top, left-to-right, and right-to-left.
The roll is held for the entire palette step, so it cannot flicker between
frames. Diamond-out starts at the center; diamond-in starts at the perimeter.
The waterfall pattern behaves like a Connect Four color fill: every circle
stays fixed while the incoming color briefly traces an adjacent path down the
column, then remains in the lowest unfilled target. Recursively split cells use
their actual neighboring geometry for the traced path.

`interactiveGrid.colorTransition.durationSeconds` is the total time for every
pattern: the first dot starts at zero and the final dot finishes at that exact
duration regardless of the number of dots in the cell. `"auto"` resolves to one
composition beat, which interactive-grid defines as one palette step. Its
editable `timingCurve: [x1, y1, x2, y2]` applies CSS-style cubic-bezier acceleration.
Durations longer than one palette step are rejected because the next color
would otherwise begin before the current pattern could finish.
Set `cycleThroughPalette: true` to replay the chosen pattern for a complete
forward palette lap before settling on the normally scheduled next color. For
example, `A → B` becomes `A → B → C → D → A → B` with four colors. Every hop
shares the same outer `durationSeconds`; enabling the lap does not lengthen the
transition or reroll the parent cell's pattern.
Slide moves a same-sized circle diagonally from the top-left over the outgoing
circle during snake, diamond, and row patterns. A circular clip contains both faces without
painting background-colored mask geometry. This keeps alpha exports genuinely
transparent. Every visible circle remains an independent recursive control.
Clicking a circle replaces only that circle with four children, and every child
can be clicked and split again. Click a gap (or Shift-click anywhere in the
cell) to resume cycling the outer cell's base size. Right-click a circle, grid,
or gap to set that parent cell directly to its empty state. The interactive
composition has no per-size behavior assignments and no flock input.

Parent-cell visibility and base scale are stored in `sessionStorage`. Reloading
the same browser tab restores those settings, while another tab keeps an
independent session. Recursive circle splits, hover/focus state, and transition
rolls are intentionally not persisted.

## Switching compositions

Edit `GLOBAL_CONFIG.composition.active` in `config/global.js`:

```js
composition: {
  active: "voronoi", // or one of the compositions below
  // Legacy native fallbacks; flock still reads this path.
  startWithCircle: true,
  startWithCircleDurationSeconds: 2,
  endWithCircle: true,
  endWithCircleDurationSeconds: 2,
  circleSubdivision: 1,
  circleEndpoints: {
    // Structured settings override the legacy end enablement above.
    end: { enabled: true, mode: "dijkstra" },
    modes: {
      dijkstra: {
        trailLength: 1,
        cleanupAcceleration: 2,
      },
    },
  },
},
```

The global end endpoint is `dijkstra` for every finite non-flock composition.
Every visible parent cell in the final scene starts a concurrent route toward
the centre. When routes merge, each shared parent cell is rendered once and
cleaned once rather than stacking duplicate circles or cleanup work. A
composition may still override the shared path, blink, cleanup, and hold
settings beside its other options. The resolver in `src/composition-endpoints/`
layers those values without mutating either config.

`endWithCircle` is not dead code: it remains the native enablement fallback and
still controls flock. The structured `circleEndpoints.end.enabled` value is the
authoritative switch for migrated finite compositions.

The route plan freezes when an endpoint first prepares and stays fixed through
the outro. Most compositions prepare it on their first outro frame. Voronoi has
an authored handoff: its commit and settle body window retains one far-edge
source per territory and animates the Dijkstra loading state at each source. The
exclusive outro resumes that loading state, then runs the actual path reveal,
blink, cleanup, and centre hold.

A custom endpoint owns its outro phase exclusively. While Dijkstra runs, the
text phase overlay receives no outro frame and the matching generator-owned
outro is suppressed, so neither can overlap the route. Flock remains the native
endpoint exemption and does not use the global Dijkstra selection.

`trailLength` is normalized over `0..1` and controls overlap in the subdivision
cleanup. `0` changes one path cell at a time, with no changing-cell trail; `1`
changes every removable path cell together. Intermediate values remap to that
proportion of simultaneously changing cells. It does not shorten the visible
path or the blink. Cleanup duration and `cleanupAcceleration` still control the
overall pace, so a separate delay setting is not required.

Endpoint durations wrap the unchanged intermediate timeline. A positive number
is an explicit duration in seconds. `"auto"` takes the already-resolved duration
of the matching phase: the start endpoint takes `intro.durationSeconds`, and the
end endpoint takes `outro.durationSeconds`. Endpoint timing never consults a
live generator or flicker mode for a non-flock composition. The legacy flat
`startWithCircleDurationSeconds` and `endWithCircleDurationSeconds` fallbacks use
the same matching anchors. Native `circleSubdivision` values `1`, `2`, `4`, `8`,
and `16` produce 1, 4, 16, 64, and 256 child cells. Continuous flock simulations
stay on their native endpoint path and have no finite final frame for a Dijkstra
end state.

### Timing and `"auto"` durations

Every canonical non-flock composition recipe owns one explicit timing root:

```js
compositionDefinitions: {
  "game-of-life": {
    rule: "sequence",
    timing: {
      bodyDurationSeconds: 24,
      beatCount: 12,
    },
    steps: [{ use: "gameOfLifeAutomaton" }],
  },
}
```

Both values are required: `bodyDurationSeconds` is a finite positive number and
must never be `"auto"`; `beatCount` is a positive integer. Their quotient defines
the composition beat:

```text
beatSeconds = bodyDurationSeconds / beatCount
```

Legacy generator fields such as `cycleSeconds`, `tokenSeconds`,
`previewSeconds`, and their pass-count partners may still appear in standalone
fixtures. When a recipe timing root is present they must match it; a conflicting
second clock is a startup error.

Automatic durations form a fixed dependency graph. Each field has exactly one
anchor:

| Authored field | Sole `"auto"` anchor |
| --- | --- |
| `timing.bodyDurationSeconds` | None; keep this root explicit. |
| `flicker.modes.<mode>.cycleSeconds` | `beatSeconds` |
| `intro.durationSeconds`, `outro.durationSeconds` | `beatSeconds` |
| `intro/outro.modes.text.visibleSeconds` | 60% hold window of its resolved phase |
| `cellTransitions.durationSeconds` | The shortest hold between body state changes |
| `circleEndpoints.start/end.durationSeconds` | The matching resolved intro/outro duration |
| `interactiveGrid.colorTransition.durationSeconds` | `beatSeconds`; interactive-grid keeps `beatCount` equal to the palette size, so one beat is one palette step |

An explicit number bypasses automatic resolution. The duration fields above
require a positive value except `text.visibleSeconds`, which also accepts zero
and caps any requested hold at 60% of its phase. `"auto"` takes the field's
anchor, while `"calc(auto * n)"` multiplies that same anchor by a positive `n`;
the text hold applies its cap afterward. No field searches other durations for
a fallback. A missing anchor is a startup error that names the composition and
field.

The composition-level graph resolves once during startup into numeric settings.
`text.visibleSeconds` resolves when its phase plan is created, because the same
text mode may run in a normal intro and in a shorter explicit endpoint; the
plan's already-numeric phase duration is its sole timing anchor. Config-resolved
child durations are not recalculated when a sequence step or active generator
changes. The resolved phase and endpoint durations stay fixed, but the director
still asks the active generator for the core `animationDuration()`; that legacy
value can include generator-owned intro/outro events and still determines total
export duration. Consolidating that second clock remains Stage 3 work in
`REFACTOR_PLAN.md`. Other nested mode timings such as `flipSeconds`,
`staggerSeconds`, and `blendSeconds` remain explicit numbers unless that exact
field is documented as supporting automatic duration syntax. A public alias
recipe inherits the timing of its canonical recipe instead of declaring a
second root.

For quick comparisons, the same choice can be made without editing:

```text
http://localhost:8000/?composition=inference-loop
http://localhost:8000/?composition=thinking
http://localhost:8000/?composition=context-window
http://localhost:8000/?composition=tool-loop
http://localhost:8000/?composition=voronoi
http://localhost:8000/?composition=l-tree
http://localhost:8000/?composition=game-of-life
http://localhost:8000/?composition=base
```

`inference-loop` is the canonical public ID. `thinking` remains a supported
legacy alias, so saved URLs continue to select the same configured generator.
The other existing public composition IDs are unchanged.

Or switch a running sketch from the browser console:

```js
circleGridApp.list();
circleGridApp.use("inference-loop");
```

The `flock` composition uses the static circle subdivision renderer.
`flock-circles` remains as a compatibility composition ID for the same live
flock/grid generator.

Set `FLOCK_GRID_CONFIG.settings.typography.textLockup` in
`config/compositions/flock-grid.js` to `true` to create a safe zone around the
typography. Each grid dot (and optional visible boid) is hidden when its current
rendered footprint reaches that zone; dots elsewhere remain visible.
Subdivision, dot margin, and active transforms are included in the conservative
footprint test.

## Export suite

The panel in the upper-right uses the application's Canvas2D generators for
both preview and export; it never records the screen or a real-time animation.
A fresh session starts on the default delivery format: MP4 motion at 1080p,
1920x1080 horizontal, 30 fps, with project state embedded.
Static exports are PNG and standalone SVG. Motion exports are MP4, transparent
WebM, and a numbered PNG sequence. Resolution and aspect presets update the
authoritative width and height fields, and video dimensions are rounded down to
even values when necessary.

Motion export pauses the p5 loop, locks canvas/UI input, and advances a separate
generator session on fixed 60 Hz simulation steps. Output frames are sampled at
exactly `i / fps`, so encoding speed cannot change animation timing and the
cycle endpoint is not duplicated. The discrete and interactive compositions
export their configured complete cycle. Flock compositions are continuous
simulations without a finite seamless cycle, so their motion export reports a
clear error; PNG and SVG still work.

Transparent PNG stills, PNG sequences, and WebM frames are cleared to zero
alpha. Opaque formats fill the output frame with the configured canvas
background. Artwork bounds are contain-fitted and centered without cropping.
Because this project is native
Canvas2D rather than WebGL, export quality comes from drawing the same analytic
arcs and rounded paths directly at output size. SVG uses a Canvas2D-compatible
vector recorder and does not include a page-background rectangle or interaction
guides.

When **Embed state** is enabled, PNG, MP4, SVG, and every PNG-sequence frame
carry a `CIRCLEGRIDPARAMS1` project payload. Drop one of those PNG, MP4, or SVG files
onto the app to restore recognized state; the restore is one undoable action
(`Cmd/Ctrl+Z`). WebM remains unstamped. PNG sequences stream directly into a
chosen folder when the File System Access API is available, otherwise the app
downloads one store-only ZIP. Video export requires a browser with a compatible
WebCodecs encoder and reports a browser-support error when none is available.

### Console commands

Every export control is also reachable from the browser console. The global
`cg` accepts a command line either as a tagged template or as a plain string,
because `export` is a reserved word and cannot be a global of its own:

```js
cg`export --all --mp4`
cg("export --all --mp4")
```

`cg`help`` prints the full reference. The commands are `help`, `list`,
`status`, `use <composition>`, `export [flags]`, and `panel show|hide|toggle`
(`ui` and `tab` are aliases of `panel`).

Export flags set the same state the panel edits, so the panel stays in sync
after a console run: `--png`, `--svg`, `--mp4`, `--webm`, `--png-sequence`, or
`--format <name>` choose the format and switch the workflow between static and
motion; `--aspect`, `--resolution`, `--width`, and `--height` set the output
frame; `--fps` applies to motion formats; `--transparent` and `--embed-state`
take a `--no-` prefix to clear them. Values also accept `--flag=value`.

`--all` exports every canonical composition in turn, skipping legacy aliases,
and returns to the composition that was live when the command started.
`--preview-flicker` exports the `base` composition once for every registered
flicker mode in both `canvas` and `cell` scope. Motion previews replay three
times by default; `--repeats N` changes that count. Each pass uses the palette,
amount, stagger, and per-mode values assembled from `GLOBAL_CONFIG.flicker`.
For any motion export, `--cycles N` repeats the composition's complete cycle N
times in one file. In flicker previews, the duration combines both controls:
`repeats × cycles` flicker cycles.
Filenames start with the scope and mode, for example
`OAI_canvas_radar-arc_0814-120000.mp4`.
`--composition a,b` (short `-c`) exports a named subset. A composition that
cannot produce the requested format — a continuous simulation asked for motion,
for instance — is reported in the returned summary instead of raising an alert
dialog, and the remaining compositions still run. `--dry-run` applies the
settings and returns the plan without exporting.

Each command resolves to a result object (`{ ok, compositions, results, … }`),
so a failed batch can be inspected in the console. `panel show` and `panel
hide` mount and unmount the export panel at runtime; the checked-in default
comes from `ui.showExportPanel` in `config/global.js`.

## Architecture

```text
p5js/
├── config.js                     public facade and assembled compatibility exports
├── config/
│   ├── global.js                 canvas, default composition, palette, and palettes
│   ├── shared.js                 compatibility namespace for shared settings
│   └── compositions/
│       ├── inference-loop.js     inference-loop settings, instance, and recipes
│       ├── context-window.js     causal-horizon settings and recipe
│       ├── tool-loop.js          observe-act settings and recipe
│       ├── voronoi.js            influence-field settings and recipe
│       ├── l-tree.js             branch-prune settings and recipe
│       ├── game-of-life.js       cellular-automaton settings and recipe
│       ├── interactive-grid.js   interactive settings, generator, and recipe
│       └── flock-grid.js         flock-grid settings, generator, and recipes
├── sketch.js                     stable browser entry point
├── src/
│   ├── sketch.js                 p5 instance lifecycle only
│   ├── catalog.js                implementation registrations
│   ├── core/
│   │   ├── cubic-bezier.js
│   │   ├── registry.js
│   │   └── composition-director.js
│   ├── compositions/
│   │   ├── circle-endpoints.js   legacy native endpoint controller
│   │   └── sequence-rule.js
│   ├── composition-endpoints/
│   │   ├── index.js              per-composition endpoint resolver/registry
│   │   └── dijkstra.js           parent-grid search and cleanup
│   ├── generators/
│   │   ├── circle-grid-scene-generator.js
│   │   ├── grid-scene-strategies.js
│   │   ├── inference-grid-generator.js
│   │   ├── procedural-topology-generator.js
│   │   ├── cellular-automata-generator.js
│   │   ├── wave-field-generator.js
│   │   ├── wave-field-strategies.js
│   │   ├── pathfinding-generator.js
│   │   ├── pathfinding-strategies.js
│   │   ├── flock-grid-generator.js
│   │   ├── interactive-grid-generator.js
│   │   ├── flock.js
│   │   └── spatial-hash.js       flock proximity helper, not a generator type
│   ├── fields/
│   │   ├── grid-field.js
│   │   ├── flock-field-source.js
│   │   ├── type-mask-field-source.js
│   │   └── type-field.js
│   ├── grid/
│   │   ├── circle-grid.js
│   │   └── subdivision-policy.js
│   ├── timeline/
│   │   └── timeline-settings.js  startup timing resolver; single clock pending
│   ├── cell-transitions/
│   │   ├── cell-state-buffer.js
│   │   ├── cell-state-transition.js
│   │   ├── index.js
│   │   ├── state-plan.js
│   │   ├── transition-settings.js
│   │   ├── sort-selection.js
│   │   └── none.js
│   ├── scene-transitions/         intro/outro lifecycle controllers
│   │   ├── scene-transition.js
│   │   └── transition-settings.js
│   └── shapes/
│       └── rounded-rect.js
└── test/
    ├── architecture.test.js
    ├── grid-scene-generators.test.js
    ├── extensible-generators.test.js
    ├── config.test.js
    └── interactive-grid.test.js
```

`timeline-settings.js` is the settings half of the timeline refactor. It
resolves recipe roots and config-level automatic durations at startup, but the
Stage 3 consolidation of the existing phase and generator clocks has not landed
yet.

### The five configuration layers

The names have different jobs and are deliberately kept in separate fields:

1. **Composition ID** is the public name selected through
   `?composition=...` or `circleGridApp.use(...)`.
2. **Generator instance ID** is the configured instance named by a composition's
   `steps[].use` entry.
3. **Generator type** is the registered implementation factory in
   `src/catalog.js`.
4. **Settings key** is the editable settings object selected by a generator
   definition's `settingsKey`.
5. **Strategy** is the optional algorithm selected inside a shared generator
   engine. A visual variant that uses the same state, update, and rendering
   engine should be a strategy rather than a new generator type.

The discrete public compositions map through those layers as follows:

| Composition ID | Generator instance ID | Generator type | Settings key | Strategy |
| --- | --- | --- | --- | --- |
| `thinking` (legacy alias) + `inference-loop` | `inferenceLoopGrid` | `inference-grid` | `inferenceLoop` | `inference-loop` |
| `context-window` | `contextWindowGrid` | `inference-grid` | `contextWindow` | `context-window` |
| `tool-loop` | `toolLoopGrid` | `inference-grid` | `toolLoop` | `tool-loop` |
| `voronoi` | `voronoiGrid` | `procedural-topology` | `voronoi` | `voronoi` |
| `l-tree` | `lTreeGrid` | `procedural-topology` | `lTree` | `l-tree` |
| `game-of-life` | `gameOfLifeAutomaton` | `cellular-automata` | `gameOfLife` | `life-like` |

`interactive-grid` and the three flock recipes keep their existing dedicated
engines. The flock recipes share the `flockGrid` instance and select different
cell-transition strategies, so changing between them does not restart the
simulation.

Configuration is authored at its narrowest scope. `GLOBAL_CONFIG.canvas`,
`GLOBAL_CONFIG.composition`, `GLOBAL_CONFIG.cellTransitions`,
`GLOBAL_CONFIG.intro`, `GLOBAL_CONFIG.flicker`, `GLOBAL_CONFIG.palette`, and
`GLOBAL_CONFIG.palettes` contain app-wide values.
`GLOBAL_CONFIG.palette` names the palette every composition uses; a composition
overrides it only by authoring its own `palette` in its settings group.
`GLOBAL_CONFIG.cellTransitions` contains reusable between-state motion presets,
while the flock settings live with the flock-grid family in
`config/compositions/flock-grid.js`. `SHARED_CONFIG` remains as an empty
compatibility namespace.
Every public composition's editable values, configured instance, and recipe
live together in its clearly named file under `config/compositions/`.

Root `config.js` collects those files in `COMPOSITION_BUNDLES` and assembles
`SETTINGS`, `PALETTES`, `GENERATOR_DEFINITIONS`, and
`COMPOSITION_DEFINITIONS`. `COMPOSITION_CONFIGS` and `THINKING_CONFIG` remain as
compatibility exports; new code should use `COMPOSITION_BUNDLES` and
`INFERENCE_LOOP_CONFIG`.

### Generator responsibilities

- `inference-grid` owns the inference-specific `inference-loop`,
  `context-window`, and `tool-loop` strategies.
- `procedural-topology` owns the deterministic `voronoi` and `l-tree`
  strategies. They share a discrete grid-scene lifecycle and renderer while
  retaining separate algorithms and settings files.
- `cellular-automata` owns `life-like` and is the extension point for future
  fixed-grid neighbour-rule systems. Each generation reads the fixed eight-cell
  neighbourhood directly and applies the configured rule simultaneously.
- `wave-field` is registered for future ripple, interference, oscillation, and
  signal-propagation compositions. Its strategies are `ripple`,
  `interference`, `oscillation`, and `signal-propagation`.
- `pathfinding` is registered for future frontier animations using `bfs`,
  `dijkstra`, and `a-star`.
- `flock-grid` owns flocking, typography, field sources, its circle grid, and
  their draw order. `interactive-grid` owns authored cell states, exact palette
  colors, and recursive subdivisions.

`wave-field` and `pathfinding` intentionally have no public compositions yet.
Their factories and strategies can be reused by a future composition without
expanding the public URL/API surface or inventing another catch-all type.

`CircleGridSceneGenerator` contains the shared fixed-grid layout, palette,
blank-hinge transition, circle rendering, responsive resize, and lifecycle
plumbing used by the discrete scene engines. Algorithm selection remains in
the typed generator wrappers and their strategies.

`SpatialHash` in `src/generators/spatial-hash.js` is only a performance helper
for finding nearby freely moving flock objects. It is not registered in the
catalog, is not a visual generator, and is never used by Game of Life or the
`cellular-automata` engine.

Composition rules and cell transitions remain separate extension points.
Composition rules return render plans and choose configured instances. Cell
transitions own between-state glyph motion; `none` also provides the static
renderer-facing cell pose used by flock. Whole-scene algorithm changes still
belong to a generator strategy.

### Inspection metadata

Inspection reports each layer explicitly instead of overloading a generic
`representation` name:

```js
circleGridApp.use("inference-loop");
const state = circleGridApp.inspect();

state.compositionId; // "inference-loop"
state.renderPlan; // [{ use: "inferenceLoopGrid" }]
state.generators.inferenceLoopGrid.generatorInstanceId; // "inferenceLoopGrid"
state.generators.inferenceLoopGrid.generatorType; // "inference-grid"
state.generators.inferenceLoopGrid.settingsKey; // "inferenceLoop"
state.generators.inferenceLoopGrid.strategy; // "inference-loop"
```

## Configuring a generator

Factories receive
`{ name, definition, settingsKey, options, settings, runtime, director }`.
The director resolves `options` from `SETTINGS[settingsKey]` before creating the
instance. Generator lifecycle methods receive the frame and relevant render-plan
metadata:

```js
class CircleSignalGenerator {
  constructor({ options, runtime }) {}
  enter(frame, planEntries) {}
  update(frame, planEntries) {}
  draw(frame, planEntry, context) {}
  resize(viewport) {}
  exit(frame, planEntries) {}
  dispose() {}
}
```

To configure a future ripple composition with the already registered
`wave-field` type, keep its settings, instance definition, and recipe together
in `config/compositions/ripple-field.js`:

```js
export const RIPPLE_FIELD_CONFIG = {
  settings: {
    rippleField: {
      longSideCells: 9,
      // Omit `palette` to inherit GLOBAL_CONFIG.palette.
      palette: "green",
      cycleSeconds: 2.4,
      stepCount: 8,
      wavelengthInCells: 3.6,
    },
  },
  generatorDefinitions: {
    rippleFieldGrid: {
      type: "wave-field",
      settingsKey: "rippleField",
      strategy: "ripple",
    },
  },
  compositionDefinitions: {
    "ripple-field": {
      rule: "sequence",
      steps: [{ use: "rippleFieldGrid" }],
    },
  },
};
```

Import the bundle in root `config.js` and add it once to
`COMPOSITION_BUNDLES`. Only create and register a new type in `src/catalog.js`
when the state/update/rendering engine is genuinely different; otherwise add a
strategy to the appropriate existing type.

The director creates generator instances lazily, supplies an initial resize,
calls `enter`/`exit` when the active set changes, updates an active instance
once per frame, and draws in plan order. `opacity` on a plan entry is inherited
Canvas draw alpha. Discrete circle-face state changes still use the blank hinge;
they do not crossfade outgoing and incoming patterns. Generators that share a
render plan should draw without clearing the main canvas themselves.

## Flicker modes

Flickering is the per-dot palette agitation every discrete circle-grid
composition uses. It is split into three parts that change independently:

1. **The mode** decides what each dot does. A mode owns one field —
   `sampleAt(x, y, time)` returning a normalized `0..1` intensity — plus the
   settings that field needs. Modes live in `src/visuals/flicker/` and are
   registered in `src/visuals/flicker/index.js`. **The scope** decides where that
   field is addressed: `"canvas"` runs one pattern across the whole board, so
   each cell shows only its own slice of it; `"cell"` restarts the pattern inside
   every cell, so each cell plays the whole thing and all cells play it
   identically. A mode never sees the scope — the renderer chooses which
   coordinates reach `sampleAt`, and hands the field a one-cell grid extent under
   cell scope. Because every cell then reads the same field, cell scope also
   offsets each cell's clock by a deterministic slice of `cellStaggerSeconds`, or
   the whole board pulses in unison; set it to `0` to keep the cells in step.
2. **The scene mask and envelope** decide which cells flicker this frame and how
   strongly. Each strategy in `src/generators/grid-scene-strategies.js` returns
   that as its `paletteMotion` entry, using its own envelope fractions.
3. **Palette snapping** turns a sample into one authored swatch.
   `FlickerPalette` does this for every mode, so colors still snap and never
   ease between values.

### Registered modes

| Mode | Field | Ported from | Distribution |
| --- | --- | --- | --- |
| `noise` | One continuous 3D noise field, so neighboring dots agitate together in drifting clouds. | — | `auto` |
| `echo-ring` | Concentric diamond rings pulse outward from the field center, each ring trailing a softer echo. | `dotm-square-11` + `.dmx-ripple-echo` | `level` |
| `strobe-stack` | Columns stack upward on a per-column stagger, the full field blinks twice, then the columns drain downward. | `dotm-square-8` | `level` |
| `block-drop` | Frames drop and pile up from the bottom, then two row-clear beats flash the field before it empties. | `dotm-square-7` | `level` |
| `prism-bloom` | A symmetric kaleidoscope breathes out through four radial motifs and back, crossfading between them. | `dotm-square-14` | `level` |
| `crt-glide` | A scanline steps down the field; passed rows keep a decaying phosphor trail with a column-wise warp. | `dotm-square-10` | `level` |
| `radar-arc` | A rotating arm sweeps the field with a bright beam front, a soft wake, and a faint perimeter ring echo. | `dotm-circular-4` | `level` |

Every ported loader is authored against a fixed 5x5 matrix. `FieldGeometry` in
`src/visuals/flicker/field-geometry.js` maps a dot's position into that space, so
a motif keeps its shape whether the field is the whole board or a single cell.
Modes that read a literal frame mask (`block-drop`, `prism-bloom`) sample the
nearest of five virtual rows and columns; `radar-arc` uses the loader's centered
`-2..2` space. Each mode's geometry and micro timings — stagger, decay, beam
width — come from the loader. `cycleSeconds` may instead follow the composition
beat through the automatic-duration table above. Only `baseIntensity` is
normally worth retuning, since it sets which swatch an unlit dot rests on.

`echo-ring` keeps the loader's own numbers: rings are Manhattan bands around the
center, each ring lags `ringDelayFraction` (0.14) of a cycle, odd rings lag
`echoDelayFraction` (0.03) more, and the pulse follows the loader's four
`ease-in-out` keyframes. `ringCount` (5, as in the loader's 5x5 matrix) is the
number of bands spanning the field from its center to its furthest corner. Ring
width is derived from whatever field the mode was handed, so the same value reads
the same whether that field is the whole board or a single cell — a ring width
fixed in dots would put an entire cell in one ring under cell scope and flatten
the pattern.

One authored block controls all of it. App-wide defaults live in
`GLOBAL_CONFIG.flicker`; a composition overrides only what it needs:

```js
flicker: {
  enabled: true,
  mode: "noise",      // which field agitates the dots
  scope: "canvas",    // one board-wide pattern, or one pattern per cell
  amount: 0.9,        // how far a dot may leave its base palette step
  cellStaggerSeconds: 0.9, // cell scope: spread cell starts so they desynchronize
  modes: {            // settings owned by each mode, kept side by side so
    noise: {          // swapping `mode` does not lose the other tunings
      speed: 0.55,
      spatialScale: 0.24,
    },
  },
  envelope: {         // this composition's own fade and ramp fractions
    leadFraction: 0.18,
    spreadFraction: 0.6,
    rampFraction: 0.22,
  },
}
```

Root `config.js` merges the global block into every settings group that declares
`flicker`, so `SETTINGS` — not the composition file alone — is the resolved
authoring result. Settings for every registered mode are validated when a
generator is built, which lets `generator.useFlickerMode(name)` swap the field
mid-composition without an authoring error surfacing at that moment. A legacy
per-composition block (`candidateFlicker`, `layerFlicker`, `birthFlicker`,
`highDensityFlicker`, `finalSnapshotFlicker`, `regionFlicker`) still resolves to
the same shape.

To add a mode, export a descriptor and register it:

```js
export const SWEEP_FLICKER_MODE = Object.freeze({
  name: "sweep",
  // "level" maps the sample straight onto the palette as a brightness, which is
  // what pattern fields want; "value" bands it so a continuous signal still
  // revisits every swatch; "rank" spreads a cell's dots evenly across the
  // palette by sample order; "auto" ranks only while a cell holds at least one
  // dot per swatch.
  distribution: "level",
  defaults: Object.freeze({ columnsPerSecond: 2, softness: 0.25 }),
  normalize(settings) {
    // Throw on invalid authored values.
    return { ...SWEEP_FLICKER_MODE.defaults, ...settings };
  },
  createField({ settings, grid, noiseFunction }) {
    return {
      sampleAt(x, y, time) { /* return 0..1 */ },
      resize(nextGrid) {},              // optional: grid extent changed
      beginFrame({ time, progress, cycleIndex }) {}, // optional: once per update
    };
  },
});
```

A field must be deterministic — the same arguments always return the same
sample — so exported frames match the live canvas. Coordinates arrive in finest
subdivision units across the whole board, and `grid` carries `columns`, `rows`,
`cellSize`, and `dotsPerCellAxis` for fields that place a sweep, ripple, or route
across the board. Modes never see palettes, cell masks, or envelopes, so any
registered mode drops into any composition by name alone.

## Adding a composition rule

A rule owns composition timing and returns a render-plan array. It does not
know how a generator is implemented:

```js
class OverlayRule {
  constructor(definition) {
    this.plan = definition.plan;
  }
  update(frame) {
    return this.plan; // [{ use: "cells", opacity: 0.5 }, ...]
  }
  dispose() {}
}
```

Register it in `src/catalog.js`, then select it with `rule: "overlay"` in a
composition definition. Extra plan-entry fields reach generator `update` and
`draw`, so a rule can coordinate generator-specific modes without coupling to
their classes.

Frames expose capped `dt` for stable simulation and uncapped `compositionDt`
plus `time` for wall-clock composition timing. `SequenceRule` uses
`compositionDt`, so a six-second step remains six seconds at a low frame rate.

## Configuring transitions

`cellTransitions` and `intro`/`outro` have separate jobs:

- `cellTransitions` animates changes between scene states while the cycle clock
  continues to advance.
- `intro` and `outro` run only at cycle boundaries. Their wall-clock phases
  pause the cycle and are included in export duration.

The app-wide between-state selection lives in `GLOBAL_CONFIG`:

```js
cellTransitions: {
  enabled: true,
  mode: "sort-selection",
  durationSeconds: "auto",
  modes: {
    none: { baseKind: "circle" },
    "sort-selection": {
      seed: 173,
      revealFraction: 0.16,
      arcHeightInCells: 0.32,
      staggerSeconds: 0.02,
      timingCurve: [0.65, 0, 0.35, 1],
    },
  },
}
```

`mode` selects the between-state behavior used by discrete scene generators.
`none` switches immediately, while `sort-selection` rearranges the complete
glyph set. The `none` block also configures flock's static circle renderer.

`sort-selection` treats every visible circle as an item, including circles
inside subdivided cells. On a state change, the previous state's real glyph
positions and sizes become the next plan's source slots. Selection-sort swaps
then move them into row-major destinations on paired opposite arcs. The
transition does not replay the intro or extend `animationDuration()`.

`staggerSeconds` requests spacing between selection movements while
`durationSeconds` remains the complete transition duration. Dense plans compress
movement and delay proportionally. Here `"auto"` takes the shortest hold between
body state changes. `timingCurve: [x1, y1, x2, y2]` uses CSS cubic-bezier
semantics; `[0, 0, 1, 1]` is linear.

Lifecycle settings contain no `state`/`cycle` trigger. Intro and outro select
phase-capable modes such as `fade` and `text`; `sort-selection` is state-only:

```js
intro: {
  enabled: true,
  mode: "fade",
  durationSeconds: "auto",
  modes: {
    fade: {
      revealFraction: 0.6,
      timingCurve: [0.65, 0, 0.35, 1],
    },
  },
},
outro: {
  enabled: true,
  mode: "text",
  durationSeconds: "calc(auto * 2)",
  modes: {
    text: {
      text: "Open AI // Cyber",
      visibleSeconds: 0.8,
    },
  },
},
```

When a composition omits a local `outro`, it inherits `GLOBAL_CONFIG.outro`.
Only when that app-wide block is absent does outro fall back to intro. A
composition can override `cellTransitions`, `intro`, or `outro` field by field
in its own settings group.

## Adding a circle animation

A cell transition owns any persistent animation state and writes the shared buffer:

```js
class StretchTransition {
  resize(cellCount) {}
  enter(frame) {}
  updateCell(index, cell, cellState, frame) {
    cellState.level[index] = 0; // choose a subdivision level
    cellState.roundness[index] = 1;
    cellState.scaleX[index] = 1.4;
    cellState.scaleY[index] = 0.7;
    cellState.rotation[index] = 0;
    cellState.offsetX[index] = 0;
    cellState.offsetY[index] = 0;
    // These are applied around every visible dot's own center.
    cellState.glyphScaleX[index] = 1;
    cellState.glyphScaleY[index] = 0.7;
    cellState.glyphScaleAxis[index] = Math.PI / 4;
    cellState.glyphRotation[index] = 0;
    cellState.glyphOffsetX[index] = 0;
    cellState.glyphOffsetY[index] = 0;
    cellState.opacity[index] = 1;
  }
  exit(frame) {}
  dispose() {}
}
```

The grid resets every output cell to circle/identity defaults before
`updateCell`, so a transition only needs to overwrite the properties it uses.
Persistent timing or spring state should live inside the transition instance.

Use `scaleX`/`scaleY` to transform a whole parent cell, or
`glyphScaleX`/`glyphScaleY` when every subdivided dot should move about its own
center. A transition may also set `paletteValue` from `0` to `1` to hold a face
color; leaving it at `-1` keeps the grid's live energy color.

Register the factory in `src/cell-transitions/index.js` and add its shared options under
`GLOBAL_CONFIG.cellTransitions.modes` in `config/global.js`. It can be the
generator default or a composition-step override:

```js
cellTransition: { type: "stretch", options: "stretch" }
```

Changing only `cellTransition` keeps the same flock/grid generator alive; it does
not allocate or restart the 4,000-boid simulation.

Subdivision selection is separately owned by `FourLevelSubdivisionPolicy`, so
a future animation may reuse the current 1/2/4/8 grid logic or replace it.

## Current rendering pipeline

The flock-grid generator keeps the original order:

1. Update flock life, births, forces, and positions.
2. Write flock splats and optional typography coverage into `GridField`.
3. Compress density, apply rise/fall smoothing, and resolve subdivisions.
4. Apply the selected cell transition.
5. Draw boids, then the circle grid, then typography.

`GridField` is generator-neutral: future systems can contribute points or
direct cell values without `CircleGrid` reaching into their internals.

## Run, test, and build locally

```bash
cd p5js
python3 -m http.server 8000
```

Open <http://localhost:8000/>.

The complete test suite has no browser dependency:

```bash
cd p5js
npm test
```

Regenerate the checked-in `dist` mirror only through the local build command:

```bash
cd p5js
npm run build
```

The build removes the old `dist` tree and copies the current source,
configuration, static assets, and worker into a fresh local output. Never
hand-edit files under `dist`; make changes in the source files and rebuild.
Keep this workflow local—do not upload, publish, or send project files online.
