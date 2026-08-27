# AGENTS.md

Entry point for any coding agent working in this repository. Read this file
before reading source. `CLAUDE.md` points here; this is the single source.

---

## 1. What this project is

A p5.js generative-art composer. It renders **discrete grids of dots** that
animate through named **compositions** (voronoi, l-tree, mold, game-of-life,
inference-loop, tool-loop, context-window, interactive-grid, base, flock) and
exports them as PNG, MP4, SVG, or PNG sequences with deterministic,
seam-perfect loops.

The point of the codebase is **composability**: any visual effect should be
combinable with any other to produce new results. Effects that only work in one
composition are bugs, not features.

Plain ES modules. No TypeScript. No build step for development — `vite` serves
`src/` directly, p5.js comes from a CDN in `index.html`. `dist/` is a build
output produced by `npm run build`; never hand-edit it.

---

## 2. Run, test, verify

```sh
npm run dev              # vite dev server
npm test                 # node --test test/*.test.js
npm run build            # regenerate dist/ from source
```

`npm test` must stay scoped to `test/*.test.js`. A bare `node --test` walks the
whole repo and tries to execute `matrix/`'s TypeScript files, which Node cannot
parse.

**`matrix/` is reference material, not part of this app.** It is a separate
Next.js project kept in-tree as a source of dot-matrix loader patterns that get
ported into `src/visuals/flicker/`. Never import from it, never edit it, never
let the test runner reach it.

---

## 3. Debugging rule (mandatory)

**Every subsystem must be observable through `console.log` without a browser.**

This is a standing rule, not a suggestion. `src/debug/` exists — channels, a
replaceable sink, and a headless frame driver. Instrument as you build; never
add a bare `console.log` and never defer the instrumentation to a later pass.

When you add or change behavior:

1. Emit a debug line on every **state transition** — phase change, plan
   creation, cycle boundary, scene commit, generator enter/exit, config
   resolution failure. Not on every frame; on every *change*.
2. Use the shared channel API. Never write a bare `console.log` into `src/`.

```js
import { debug } from "../debug/index.js";

debug.timeline("phase=%s progress=%.3f cycle=%d core=%.3f", phase, p, i, t);
debug.transition("plan created mode=%s targets=%d sources=%d", m, n, s);
```

3. One line per event, machine-parseable, stable key order, so two runs can be
   diffed:

```
[cg:timeline]   f=0142 phase=intro   p=0.412 cycle=0 core=0.000
[cg:transition] f=0142 mode=sort-selection targets=341 sources=341 paired=341
```

4. Channels: `timeline`, `transition`, `plan`, `cells`, `draw`, `config`,
   `export`. Enable with any of:
   - `?debug=timeline,transition` in the URL
   - `GLOBAL_CONFIG.debug.channels` in `config/global.js`
   - `` cg`debug timeline transition` `` in the browser console
5. Rate-limit by construction: `timeline` logs once per phase change, `cells`
   samples every N frames. A channel that floods is a broken channel.
6. Debug output must be capturable in Node. `debug.sink` is replaceable so
   tests can assert on the log stream itself.

**Why this rule exists:** an agent asked to fix "intro looks glitchy" currently
has no way to see the phase, the progress, the plan, or the pairing. It has to
guess. Guessing is how the current half-finished features got that way.

To debug a composition headlessly:

```sh
node --input-type=module -e "
  import { runFrames } from './src/debug/headless.js';
  const log = await runFrames({ composition: 'voronoi', frames: 240,
                                channels: ['timeline', 'transition'] });
  console.log(log);
"
```

---

## 4. Domain glossary

Use these words exactly. Most confusion in this codebase is vocabulary drift.

| Term | Meaning |
|---|---|
| **composition** | A named, user-selectable piece: `voronoi`, `l-tree`, … Defined in `config/compositions/`. |
| **composition rule** | Chooses which generators are on screen over time. Today only `SequenceRule`. |
| **render plan** | The array a rule returns each frame: `[{ use: "generatorId", opacity }]`. |
| **generator** | Owns simulation + drawing for one visual system. Lives in `src/generators/`. |
| **scene / face** | One discrete state of a grid — the dot pattern at one step. Generators animate *between* scenes. |
| **cell** | One parent grid square. Subdivides into 1, 4, 16, or 64 glyphs. |
| **glyph** | One drawn dot. Identified by a stable string id, e.g. `"3:12"` = cell 3, glyph 12. |
| **level** | Subdivision depth of a cell: 0, 1, 2, 3 → 1, 4, 16, 64 glyphs. |
| **energy** | Scalar field value per cell, drives level and palette. |
| **flicker** | Per-glyph palette modulation. A registry of modes in `src/visuals/flicker/`. |
| **palette** | Ordered color ramp. Global default, overridable per composition. |
| **arrangement** | A transition mode that moves glyphs from source positions to target positions. |
| **presentation** | What an arrangement returns per glyph: `{ offsetX, offsetY, opacity, scale }`. |
| **phase** | Where the timeline is: `intro`, `body`, or `outro`. |
| **endpoint** | Legacy name for the intro/outro circle. Being replaced by *phase*. |

---

## 5. Architecture map

```
index.html            p5 from CDN, mounts #sketch
sketch.js             2-line stable entry → src/sketch.js
src/sketch.js         Browser host ONLY. p5 lifecycle, canvas events, wall
                      clock, undo, drag-drop restore, window.circleGridApp,
                      window.cg. Nothing here is testable in Node — keep logic
                      out of it.

config.js             Public config facade. Assembles SETTINGS,
                      GENERATOR_DEFINITIONS, COMPOSITION_DEFINITIONS.
config/global.js      App-wide: canvas, palette, palettes, flicker, transitions,
                      active composition, debug.
config/shared.js      Cross-composition settings.
config/compositions/  One file per composition family. Each exports settings +
                      generatorDefinitions + compositionDefinitions.

src/core/
  composition-director.js  Owns composition selection, generator instances,
                           the render plan, and the timeline. No p5 dependency.
  registry.js              Strict name→factory registry.
  canvas-pointer-input.js  Pointer event → grid coordinate routing.
  cubic-bezier.js          CSS-style timing curves.

src/generators/       One class per visual system. See §6 for the contract.
src/grid/             CircleGrid (cell/glyph geometry) + subdivision policy.
src/fields/           Energy sources: grid field, type mask, flock field.
src/shapes/           Rounded-rect / circle renderer.
src/visuals/flicker/  Flicker mode registry + 7 modes. This is the cleanest
                      registry in the repo — copy its shape for new registries.
src/compositions/     Composition rules.
src/composition-endpoints/  Resolves global endpoint defaults with local
                      composition overrides. `dijkstra` searches and cleans up
                      on the parent-cell grid.
src/timeline/
  timeline-settings.js     Resolves recipe roots and config-level auto timings.
                           Settings only. There is still no single timeline
                           clock — see §8.
src/transitions/      The shared arrangement pool. index.js is the registry:
                      every mode declares which phases (intro | outro | state)
                      it supports, plus its defaults. fade.js and
                      text-reveal.js are the modes; arrangement-items.js
                      normalizes an event; presentations.js and overlay.js are
                      the two ports; phase-overlay.js is the director-side
                      driver for modes that draw content of their own.
                      This pool is the intended home for all arrangement work,
                      but two older settings resolvers and four
                      applyPresentation copies still live outside it — see §8.
src/export/           PNG / MP4 / SVG / ZIP export, project-state snapshot and
                      restore, the `cg` console CLI. Deterministic by design.

src/debug/            Debug channels, sink, headless frame driver.
src/scene-transitions/  The generator-side intro/outro driver (SceneTransition)
                      and its settings resolver. Only the base and circle-grid
                      scene generators construct one, and a composition
                      endpoint suppresses it — see §8.
src/cell-transitions/   The between-state driver, its settings resolver, and
                      cell-state-buffer.js, the per-cell buffer writer.
src/compositions/circle-endpoints.js  NativeCircleEndpointTransition plus the
                      endpoint timeline function every composition runs on. It
                      implements the `native` endpoint mode and is used by all
                      four generator families, not only flock.

test/                 node:test. 28 files plus test/golden/ traces.
                      architecture.test.js encodes the architectural
                      invariants — read it before changing shape.
```

---

## 6. Contracts you must not break

### Generator lifecycle

The director calls, in this order, and the architecture test pins it:

```
resize → enter → update → draw → exit → dispose
```

Every method is optional except that a generator that draws must implement
`draw(frame, planEntry, context)`. The director validates that any method
present is a function.

Optional capability methods:

| Method | Purpose |
|---|---|
| `inspect()` | Machine-readable state. Must be JSON-serializable — copy typed arrays, never return live buffers. |
| `animationDuration()` | Length of one loop in seconds, or `null` for continuous. Export depends on this. |
| `seek(time)` | Restore to a time. Return `false` to reject. |
| `snapshotProjectState()` / `restoreProjectState(state)` | Export / undo support. Must round-trip. |
| `contentBounds()` | Bounding box for export framing. |

### Determinism

Export must produce identical bytes for identical inputs.

- **No `Date.now()`, no `Math.random()` in any render or simulation path.**
  Seeded randomness only, from `runtime.projectSeed()`.
- Simulation advances in fixed steps; export drives the clock, the clock does
  not read wall time.
- Anything not captured by `snapshotProjectState()` does not exist during
  export — the export session builds a *fresh* director from a snapshot.

### Render plan

`rule.update(frame)` returns an array of `{ use, opacity? }`. The director
validates every entry: `use` must name a known generator, `opacity` must be in
`[0, 1]`. `globalAlpha` is multiplied, never assigned, and always restored.

### Config layering

Composition settings inherit app-wide defaults and override by key. Authored
config modules are never mutated — resolution produces new objects. A missing
`SETTINGS.<key>` referenced by a definition is a startup error, not a silent
default.

### Timing resolution

Every canonical composition recipe must declare timing beside its
rule and steps:

```js
compositionDefinitions: {
  example: {
    rule: "sequence",
    timing: { bodyDurationSeconds: 6, beatCount: 6 },
    steps: [{ use: "exampleGrid" }],
  },
}
```

`bodyDurationSeconds` is the explicit positive root and `beatCount` is a
positive integer. The resolver derives
`beatSeconds = bodyDurationSeconds / beatCount` once at startup, then resolves
each supported automatic field from one anchor:

Legacy generator clock aliases remain usable only when no recipe timing is
present or when they exactly match it. Conflicting duplicate clocks must throw
at startup.

| Field | `"auto"` anchor |
|---|---|
| flicker `cycleSeconds` | `beatSeconds` |
| intro/outro `durationSeconds` | `beatSeconds` |
| text `visibleSeconds` | 60% hold window of its resolved phase |
| cell-transition `durationSeconds` | shortest state hold |
| start/end endpoint `durationSeconds` | matching resolved intro/outro |
| interactive color-transition `durationSeconds` | `beatSeconds`, one palette step |

Explicit numbers bypass automatic resolution. The fields above require positive
values except text `visibleSeconds`, which also accepts zero and caps any request
at its 60% phase window. `"calc(auto * n)"` scales only that field's anchor by a
positive `n`; the text cap applies afterward, and no resolver searches a
fallback chain. A missing anchor throws at startup, naming the composition and
field. Shipped endpoint resolution never queries live generators; an
unreachable untimed-flock compatibility branch remains under §8. Interactive-grid keeps `beatCount`
aligned with the palette size. The composition-level graph resolves at startup;
text `visibleSeconds` resolves when its phase plan is created from that plan's
numeric duration. Resolved phase and endpoint durations stay fixed, but the
director's core/export duration still comes from the active generator's legacy
`animationDuration()`; see §8. Other nested micro timings such as
`flipSeconds`, `staggerSeconds`, and `blendSeconds` stay explicit unless that
exact field documents automatic syntax. Alias recipes inherit their canonical
recipe's timing instead of declaring another root.

## 7. House rules

1. **Read §8 before structural work.** It says what is deliberately
   mid-migration and what is doubled on purpose. `refactor.md` carries the
   open note on composition timing ownership.
2. **One concept, one implementation.** Before adding a helper, grep for it.
   `clamp01` currently exists in 18 files; do not make it 19.
3. **No compatibility aliases without a caller.** An alias whose only consumer
   is a test asserting the alias exists is dead code with a bodyguard.
4. **No barrel files unless something imports them.** `src/export/index.js`
   re-exports 29 symbols and is imported by nothing.
5. **No `export default`.** The repo has 32 of them and zero default imports.
   Named exports only.
6. **Fail loudly at startup, not silently at frame 4000.** An unsupported
   combination of composition + effect must throw during setup with a message
   naming both sides and listing valid alternatives.
7. **Never hand-edit `dist/`.** Run `npm run build`.
8. **Keep flock on the shared composition machinery.** Its field simulation is
   specialized; its timing, overlays, and endpoints are not.
9. Comment *why*, not *what*. Match the surrounding density — this codebase
   uses short prose comments above non-obvious blocks, not line-by-line noise.

---

## 8. Known exemptions and mid-migration state

**flock uses the shared composition lifecycle.** It runs resolved composition
timing (`flockLegacy=no` on the `config` channel), a native start endpoint, a
Dijkstra end endpoint, and the shared `text` intro. It differs only in that
`FlockGridGenerator` constructs no
`SceneTransition` of its own, so an authored `intro`/`outro` block reaches it
only through the composition endpoint and the overlay.

`resolveEndpointDurations()` still carries a legacy branch that asks the live
generator for a flock endpoint duration. It fires only for a flock composition
whose settings key declares no `timing`, which no shipped recipe does — it is
currently unreachable.

**Intro/outro status.** Two modes are authorable at the cycle boundaries.
`fade` reveals the centered parent cell over `revealFraction` of the phase, then
crossfades into the composition. `text` hides a centered string behind a mirrored ladder
of subdivided cells and takes the ladder apart to show it: expand outward from
one big centre dot, uncover centre-first, hold the text for `visibleSeconds`,
then collapse the ladder inward to the single centre dot again. Every change is a
cut — the mode never fades or slides, and the composition cuts in as the phase
ends. It is the one mode that draws through the overlay port, and the only one
that needs a palette (it remaps the composition's palette across the ladder's
levels, or across the dots inside each cell). `sort-selection` is `state`-only — driven from
one centered circle it degenerates into an offscreen slide-in. A generator's
per-cycle lifecycle still owns a boundary with no matching composition endpoint,
which remains Stage 3 clock work. An enabled composition endpoint suppresses the
matching generator lifecycle timing instead of running beside it.

Composition endpoints are configured separately in `circleEndpoints`. The
global end mode is `dijkstra`, including flock. Flock publishes its final visible
parent cells when the outro begins, then the shared endpoint freezes that set.
Every visible final parent cell searches concurrently across cardinal neighbors
toward the centre. Route cells shared by several paths are rendered once and
cleaned once. Most compositions freeze that source set on the first outro frame.
Voronoi deliberately prepares earlier: its commit and settle body window keeps
one far-edge level-0 parent cell per territory and animates a loader at every
source. The exclusive outro resumes that frozen loading state, then begins the
paths. The routes blink, then run a ramped subdivision cleanup ending at one
centre cell. `trailLength` maps `0..1` onto the computed cleanup set: zero
changes one cleanup cell at a time, while one overlaps subdivision across every
removable route cell. It does not alter pathfinding or blink visibility. A custom
endpoint owns its outro phase exclusively: the text overlay receives no frame
and the matching generator outro is suppressed. Shared mode defaults live under
`GLOBAL_CONFIG.composition.circleEndpoints`; composition values override them by
key.

**Who owns a cycle boundary.** One owner, decided at construction, not by a
runtime guard. When `circleEndpoints.<start|end>.enabled` is true,
`compositionEndpointOwnsLifecycle()` makes the generator's own `beginIntro` /
`beginOutro` return `false` and `transitionEventsPerCycle()` return 0, so the
suppressed transition is also excluded from `animationDuration()`. Headless
traces confirm it: no composition emits a single `scene=intro` or `scene=outro`
line. Keep it that way — express a phase restriction as a mode's `phases`
declaration, never as a per-composition guard.

**The one-frame core advance at a cycle wrap is deliberate.** The core clock is
paused during an endpoint by zeroing `coreDt`, and
`circleEndpointTimelineAt()` freezes `coreTime` at
`coreDuration - ENDPOINT_SAMPLE_HOLD_SECONDS` (1/60 s) for the whole `end`
phase so the last core sample holds still under the outro. That withheld frame
is delivered at the wrap, which is why every trace shows exactly one
`phase=start … paused=no` line per cycle, followed by `paused=yes`:

```
[cg:timeline] f=0240 phase=end   cycle=0 duration=0.500 paused=yes
[cg:timeline] f=0270 phase=start cycle=1 duration=2.000 paused=no
[cg:timeline] f=0271 phase=start cycle=1 duration=2.000 paused=yes
```

More than one such frame per wrap, or one outside a wrap, is a real defect.

**Latent: the loop length still comes from the active generator.** Phase and
endpoint durations resolve from config at startup, but
`CompositionDirector.coreAnimationDuration()` takes `max()` over the
`animationDuration()` of whichever generators are *active*, and the endpoint
timeline is re-derived from `elapsed` every frame. Every shipped composition has
exactly one untimed `SequenceRule` step, so that value is constant and the
current behavior is correct. It stops being correct the moment a sequence has
more than one timed step or a generator's duration varies at runtime — the
active set would then retroactively relocate the current phase. Add the
integration test in `refactor.md` before changing that shape. There is no
`src/timeline/timeline.js` and today nothing needs one.

**Cosmetic duplication.** `src/scene-transitions/transition-settings.js` and
`src/cell-transitions/transition-settings.js` are near-identical resolvers
(`requireSettingsObject`, `mergeModeSettings` copied verbatim). Both take their
mode defaults from the single `ARRANGEMENT_MODE_DEFAULTS` table, so there is one
source of truth — only the merge code is doubled.

---

## 9. Common tasks

**Add a flicker mode** → `src/visuals/flicker/<name>-mode.js`, register in
`flicker-mode-registry.js`, add defaults to `GLOBAL_CONFIG.flicker.modes`, add a
case to `test/flicker.test.js`. Follow `noise-mode.js` as the template.

**Add an arrangement (transition) mode** → `src/transitions/<name>.js`
implementing `createPlan(event)` and `presentationAt(plan, id, progress)`, then
add a descriptor to `ARRANGEMENT_MODES` in `src/transitions/index.js` with its
`phases` and `defaults`. Follow `fade.js` as the template, and normalize the
event with `normalizeArrangementItems` rather than reading it yourself.

Aim for all three phases — `intro`, `outro`, `state`. A mode that cannot express
one leaves it out of `phases`; every consumer then refuses that pairing at
startup, naming the mode, the phase, and the modes that do support it. That
declaration is the only sanctioned way to be phase-specific — never a runtime
guard in a generator.

A mode that needs more than one pose per glyph — a crossfade shows the source and
the target together — also implements
`presentationsAt(plan, id, progress) -> presentation[]`. Renderers read poses
through `presentationsFrom()`, so a single-pose mode needs nothing extra.

A mode whose phase owns content that is in no scene — `text` draws a ladder of
cells and a string — implements the overlay port as well:

```js
drawOverlay(plan, progress, context)   // once per frame, above the render plan
```

`createPhaseOverlay()` builds the driver from the composition's `intro`/`outro`
settings and the director calls it, so the overlay reaches every composition
including the ones whose generators carry no transition wiring. A mode without
`drawOverlay` produces no driver and costs nothing. The overlay is handed the
viewport, not a generator layout: it takes its cell size from the composition's
`longSideCells`, falling back to the mode's own setting.

**Add a composition** → new file in `config/compositions/`, export the three
blocks, import it in `config.js`. Reuse an existing generator type where
possible; a new generator type is a much larger commitment.

**Change timing** → use `src/timeline/timeline-settings.js` for recipe roots and
config-level automatic fields. A deliberately supported mode-local field reuses
`src/core/automatic-duration.js`; never add another clock or fallback chain.
§8 explains why the loop length still comes from the active generator, and what
would break that.

**Debug a visual glitch** → enable the relevant channels, run the headless
driver for the composition, diff the log across frames. Do not read pixels.
