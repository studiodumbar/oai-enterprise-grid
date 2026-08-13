# Circle Grid — p5.js

A real-time generative circle grid with inference, direct cell interaction,
and flocking-driven compositions. Composition timing, visual generators, and
per-cell transitions can evolve independently.

## Discrete circle-grid compositions

The project contains six distinct operational schematics. The inference scenes
do not claim to show private chain-of-thought, exact internal telemetry, or
literal model layer, head, or token counts. Voronoi, L-tree, and Game of Life
are separate procedural systems rather than inference representations.

All six share the same strict circle-face renderer and flip-dot grammar. A
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
confidence. The strongest basin survives a consensus face and resolves to one
committed circle. This is a weighted-Voronoi metaphor for distributed competing
evidence, not a map extracted from a model request.

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
duration regardless of the number of dots in the cell. Its editable
`timingCurve: [x1, y1, x2, y2]` applies CSS-style cubic-bezier acceleration.
Durations longer than one palette step are rejected because the next color
would otherwise begin before the current pattern could finish.
Set `cycleThroughPalette: true` to replay the chosen pattern for a complete
forward palette lap before settling on the normally scheduled next color. For
example, `A → B` becomes `A → B → C → D → A → B` with four colors. Every hop
shares the same outer `durationSeconds`; enabling the lap does not lengthen the
transition or reroll the parent cell's pattern.
The `mode` setting selects either `"flip-dot"` or `"slide"` as the dot-face
motion within snake, diamond, and row patterns. Flip-dot folds every circle
edge-on, changes color while hidden, and unfolds with the existing mechanical
bounce. Slide moves a same-sized circle diagonally from the top-left over the
outgoing circle. In slide mode, a circular clip contains both faces without
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
},
```

For quick comparisons, the same choice can be made without editing:

```text
http://localhost:8000/?composition=inference-loop
http://localhost:8000/?composition=thinking
http://localhost:8000/?composition=context-window
http://localhost:8000/?composition=tool-loop
http://localhost:8000/?composition=voronoi
http://localhost:8000/?composition=l-tree
http://localhost:8000/?composition=game-of-life
```

`inference-loop` is the canonical public ID. `thinking` remains a supported
legacy alias, so saved URLs continue to select the same configured generator.
The other existing public composition IDs are unchanged.

Or switch a running sketch from the browser console:

```js
circleGridApp.list();
circleGridApp.use("inference-loop");
```

The `flock` composition preserves the existing squarifying animation.
`flock-circles` is the same generator using the `none` cell-transition strategy;
`flock-flip-dots` folds each dot edge-on, swaps subdivision while hidden, and
unfolds the new face with a small cubic-bezier bounce. All three modes reuse the
same live flock/grid generator rather than restarting the simulation.

Set `FLOCK_GRID_CONFIG.settings.typography.textLockup` in
`config/compositions/flock-grid.js` to `true` to create a safe zone around the
typography. Each grid dot (and optional visible boid) is hidden when its current
rendered footprint reaches that zone; dots elsewhere remain visible.
Subdivision, dot margin, and active transforms are included in the conservative
footprint test.

## Export suite

The panel in the upper-right uses the application's Canvas2D generators for
both preview and export; it never records the screen or a real-time animation.
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

## Architecture

```text
p5js/
├── config.js                     public facade and assembled compatibility exports
├── config/
│   ├── global.js                 canvas, default composition, and palettes
│   ├── shared.js                 settings reused across composition families
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
│   │   ├── registry.js
│   │   └── composition-director.js
│   ├── compositions/
│   │   └── sequence-rule.js
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
│   ├── cell-transitions/
│   │   ├── cell-state-buffer.js
│   │   ├── squarify.js
│   │   ├── flip-dot.js
│   │   └── none.js
│   └── shapes/
│       └── rounded-rect.js
└── test/
    ├── architecture.test.js
    ├── grid-scene-generators.test.js
    ├── extensible-generators.test.js
    ├── config.test.js
    └── interactive-grid.test.js
```

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
`GLOBAL_CONFIG.composition`, and `GLOBAL_CONFIG.palettes` contain app-wide
values. `SHARED_CONFIG.settings.cellTransitions` contains reusable motion
presets, while the flock settings live with the flock-grid family in
`config/compositions/flock-grid.js`.
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
Composition rules return render plans and choose configured instances;
cell transitions update per-cell drawing state. Whole-scene algorithm changes
belong to a generator strategy, while a flip applied to each rendered circle
belongs to a cell-transition strategy.

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
color; leaving it at `-1` keeps the grid's live energy color. `flip-dot` uses
both glyph-local transforms and quantized face colors. Its brightness mapping is deliberately
reversible: rising energy traverses one 180-degree face swap, and falling energy
traverses the same poses backward as -180 degrees instead of continuing to 360.
Set `axisDegrees` to `"auto"` to align every hinge with the flock's dominant
travel axis. Numeric values still select a fixed angle: 0 is horizontal and 90
is vertical.

Register the factory in `src/catalog.js` and add its shared options under
`SHARED_CONFIG.settings.cellTransitions` in `config/shared.js`. It can be the
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
