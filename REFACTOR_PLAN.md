# Refactor plan

Goal: make this codebase legible and safely modifiable by coding agents, and
make `intro`, `outro`, and arrangement transitions **correct by construction**
rather than patched per composition.

Status of this document: written before execution. Each stage is independently
shippable and must leave `npm test` green.

Decisions already taken by the project owner:

- `node_modules/` and `dist/` get untracked; a `.gitignore` is added.
- The 5 currently-failing tests are **regressions** — fix the config, not the
  tests.
- **flock is out of scope and must not be modified.**

---

## 1. Diagnosis

### 1.1 The core defect: three arrangement engines, one effect

The same `sort-selection` arrangement is driven by three independent objects
with three independent clocks:

| Driver | Clock owner | Constructed by |
|---|---|---|
| `SceneTransition` (intro / outro) | generator cycle | `base-composition-generator.js:122`, `circle-grid-scene-generator.js:341` |
| `NativeCircleEndpointTransition` | director endpoint clock | base, circle-grid, flock, interactive-grid |
| `CellStateTransition` (between states) | generator | `circle-grid-scene-generator.js:337`, flock |

They are kept apart by ad-hoc runtime guards — a `circleEndpointActive` boolean
and scattered `compositionEndpoint?.phase !== "start"` checks at
`base-composition-generator.js:168`, `circle-grid-scene-generator.js:606,723`.
No generator has all three. Which effects are available depends on which
generator a composition happens to use, which is exactly the composability
failure the owner reported.

### 1.2 Confirmed root causes, mapped to the diary matrix

| # | Defect | Evidence | Explains |
|---|---|---|---|
| 1 | **Outro is unreachable code.** `advanceCycle` gates the outro on `!outro.settings.fallbackToIntro`, but `config.js:99-101` sets `fallbackToIntro: true` for every composition that omits an `outro` block — and `config/global.js` has no `outro` block at all. `beginOutro` never fires; `this.outro.active` is permanently `false`. | `base-composition-generator.js:244`, `config.js:99-101`, `config/global.js` | the entire `[outro]` column |
| 2 | **Source set is smaller than the target set and falls back silently.** With `circleSubdivision: 1` there is exactly 1 circle source glyph. The base grid has 341 target glyphs. 340 of them hit the offscreen fallback and slide in from a canvas edge at full opacity instead of expanding from the circle. The *inverse* case is explicitly handled and tested; this case has neither guard nor test. | `sort-selection.js:220-224`, `circle-endpoints.js:264-271`, `test/circle-endpoints.test.js:152-158` | "dots overlap", "other things are also present somehow" |
| 3 | **The previous scene is still drawn during a transition.** `CircleGridSceneGenerator.draw` renders the previous face with `withIntro=false`, so its glyphs get identity presentations and sit at home position on top of the moving scene. Glyph ids present in one face but not the other hit the same identity fallback, which cannot distinguish "unknown id" from "transition finished". | `circle-grid-scene-generator.js:780-782`, `sort-selection.js:327-329` | "overlaps on top of existent dots" — l-tree, voronoi, tool-loop, game-of-life |
| 4 | **Two layers both decide the cycle restarts.** The director wraps on `floor(elapsed / totalDuration)` and jumps `coreTime`, delivering a nonzero 1/60 s `coreDt` while `phase === "start"` — landing exactly on the generator's own `advanceCycle` boundary. A generator outro therefore begins underneath the director's circle intro. | `circle-endpoints.js:155-166`, `base-composition-generator.js:237-259` | intro "weird"/glitchy across compositions |
| 5 | **Timeline length depends on mutable runtime state.** `endpointAutoDurations()` asks whichever *active* generator answers first. Because the endpoint timeline is re-derived statelessly from `elapsed` every frame, a change in the active set retroactively relocates the current phase and can move `coreTime` backwards — swallowed by `Math.max(0, …)`. Verified: `elapsed 5.0 / core 4` maps to phase `end` with durations `{1,1}` but phase `core` with `{2,2}`. | `composition-director.js:409-430,186` | non-reproducible glitches, export seam drift |
| 6 | **Not every generator has the wiring.** `FlockGridGenerator` and `InteractiveGridGenerator` construct no `SceneTransition` at all — only the circle endpoint. Config authors editing `intro` see no effect and get no warning. | `flock-grid-generator.js:76`, `interactive-grid-generator.js:855` | flock `[ ] [ ]`, interactive-grid |
| 7 | **Presentation is applied four different ways**, with different guards and — in `circle-grid.js` — inside an already-rotated parent transform, so world-space plan deltas get rotated and scaled. Latent, currently masked because the only production cell transition pins rotation to 0 and scale to 1. | `base-composition-generator.js:413`, `circle-grid.js:234-255`, `circle-grid-scene-generator.js:806-823`, `interactive-grid-generator.js:1539-1548` | inconsistent behavior per composition |
| 8 | **`seek()` diverges from playback.** Generator `seek()` replays with synthesized frames that omit `compositionEndpoint`, so the intro-suppression guard never fires during restore. `seek()` also never touches `SequenceRule.index`/`elapsedSeconds`. | `base-composition-generator.js:504-516`, `composition-director.js:445-469` | undo/restore showing a different image than playback |

The table records the pre-refactor evidence. The endpoint-duration half of cause
5 is now addressed for non-flock compositions by the deterministic settings
work documented under “Landed ahead of Stage 3”. The active generator still
supplies the legacy core/export duration, so the competing-clock half remains.

### 1.3 Measured, after Stage 1

The debug channels turned the diagnosis into measurement. Every number below is
read straight from `test/golden/<composition>.trace.txt`, produced headlessly by
`src/debug/headless.js`.

`unpaired` is how many target glyphs the endpoint transition could not pair with
a real source glyph — each one slides in from a canvas edge instead of expanding
from the circle. `blankFrames` is how many of 300 frames drew nothing at all.

| composition | unpaired | blank frames | diary said |
|---|---|---|---|
| base | 340 of 341 | 0 | intro broken |
| voronoi | 639 of 640 | 33 | intro + outro broken |
| interactive-grid | 954 | 0 | intro + outro broken |
| inference-loop | 114 | 60 | "BUG: intro is weird" |
| context-window | 63 | 96 | **marked working** |
| game-of-life | 0 | 120 | glitchy, overlaps |
| l-tree | 24 of 25 | 51 | intro?, outro broken |
| tool-loop | 24 of 25 | 33 | "other things are also present" |
| flock | 76 | 0 | needs a remake |

Three findings this produced that the static reading did not:

1. **Several compositions render nothing at all during the intro.** voronoi is
   blank for 33 frames, l-tree 51, game-of-life 120, context-window 96 — each
   figure matching that composition's intro duration in frames. The intro is not
   "glitchy" for these; it is an empty screen followed by a pop.
2. **game-of-life has `unpaired=0`** — no source shortage at all — yet 120 blank
   frames. Its failure is a different mechanism from the rest (cause 3, the
   previous-face double draw), which is why it looks like overlap rather than
   fly-in.
3. **context-window is marked working in the diary but is blank for 96 of 300
   frames.** Worth a look before Stage 4 treats it as a healthy baseline.

The clock collision of cause 4 is now directly observable rather than inferred.
From `test/golden/base.trace.txt`, at every cycle wrap:

```
[cg:timeline] f=0420 phase=start cycle=1 duration=1.000 paused=no
[cg:timeline] f=0421 phase=start cycle=1 duration=1.000 paused=yes
```

`paused=no` while `phase=start` means the director advanced the core simulation
by one frame *during* the circle intro — the generator's own cycle boundary
firing underneath the director's endpoint phase.

Cause 1 is confirmed exhaustively: across 20 seconds and three full cycles of
`base`, the trace contains **zero** `scene=outro` lines while `scene=intro`
appears twice per cycle. The outro is unreachable and the generator runs its own
intro at internal cycle boundaries, independently of the endpoint intro.

### 1.4 Why an agent could not have found this

Zero instrumentation. Five `console` calls in all of `src/`, none in a render
path. The director computes `this.endpointState` — the phase, progress,
cycleIndex and coreTime that *literally drive the circle intro* — every frame
and omits it from `inspect()`. `SequenceRule` and `NativeCircleEndpointTransition`,
the two other timeline owners, have no `inspect()` at all. `CircleGrid.inspect()`
returns live typed arrays by reference, so two snapshots alias the same memory
and cannot be diffed. `config/global.js:16` carries a hand-written
`// BUG: intro is weird` comment with nothing behind it.

That is the reason the debug mode is Stage 1 and not Stage 5.

### 1.4 Repository legibility

863 tracked files; roughly 120 are first-party source. `node_modules/` (188
files) and `dist/` (91 files) are committed with no `.gitignore`. Four vim
`.swp` files, one conflicted-copy settings file, and a stray root file literally
named `\` — a 177-line stale copy of `config/global.js` still carrying config
blocks for the deleted `squarify` and `flip-dot` modes — are all tracked. `npm test`
is unscoped and drags in `matrix/`'s TypeScript suites.

This is not only an aesthetic problem. Measured during this analysis, a single
`git diff HEAD -- <two config files>` did not complete within 60 seconds. Git is
walking 863 tracked files, many of them inside a Dropbox-synced `node_modules/`.
Every agent and every human pays that cost on every operation.

---

## 2. Target architecture

**One timeline. One arrangement port. One presentation helper. One registry shape.**

```
src/timeline/
  timeline.js              The single clock. Phases: intro | body | outro.
                           advance(dt) → { phase, progress, cycleIndex, bodyTime }.
                           Pure and testable; no generator, no p5.
  timeline-settings.js     LANDED EARLY: resolve + validate recipe roots and
                           config-level "auto" fields at startup.

src/transitions/
  index.js                 Mode registry, built on the flicker-registry shape:
                           frozen descriptors with name / defaults / normalize,
                           validated at registration, ALL modes normalized up
                           front so a runtime swap cannot surface an authoring error.
  transition-settings.js   ONE resolver (replaces the two duplicated copies).
  arrangement.js           The Arrangement port (see below).
  presentation.js          The ONE applyPresentation helper (replaces 4 copies).
  stage-presenter.js       Per-generator driver: holds settings + plan cache,
                           reads frame.stage, answers presentationFor(glyphId).
  modes/sort-selection.js
  modes/none.js

src/cell-state/            The OTHER port, renamed for what it actually is —
  cell-shaper.js           a per-cell buffer writer (resize/reset/updateCell).
                           It is not a transition and must not share a registry
                           with arrangements.

src/debug/
  index.js                 Channels, formatter, replaceable sink.
  headless.js              runFrames({ composition, frames, channels }) — drives
                           a director with a DOM-free context and returns the
                           log plus per-frame inspection snapshots.
```

### 2.1 The two ports, finally separated

The current `cell-transitions` registry holds two mutually incompatible
interfaces under one name, and `sort-selection` is registered under the *same
string* in two registries backed by two different files:

- **Arrangement port** — `createPlan(event) → plan`,
  `presentationAt(plan, glyphId, progress) → { offsetX, offsetY, opacity, scale }`.
  Used identically by intro, outro, and between-state motion.
- **CellShaper port** — `resize(length, buffer)`, `reset(buffer)`,
  `updateCell(index, sample, buffer)`. Writes the `CellStateBuffer`.

`NoneTransition` currently straddles both to satisfy both registries. It gets
split.

### 2.2 One driver, one code path

Generators stop owning transition clocks. The director owns the timeline and
puts `frame.stage = { phase, progress, cycleIndex }` on the frame. A generator's
draw loop becomes:

```js
const presentation = this.stage.presentationFor(glyphId);
```

Intro, outro, and between-state motion differ only in `phase` and in which item
sets are source and target. One plan cache, one interpolation path, one place to
fix a bug.

### 2.3 Plan totality — the fix for the overlap class of bugs

A plan must pair **every** target with **some** source. No silent fallbacks.

- Source count < target count: sources are expanded deterministically. The
  inverse case is already handled this way; this makes the rule symmetric.
- Ids present in one scene and not the other take an **explicit policy** —
  `enter`, `exit`, or `hold` — instead of resolving to an identity presentation
  that is indistinguishable from "transition finished".
- A plan that cannot pair everything **throws at plan-creation time**, naming
  the counts.

Draw becomes single-pass: one glyph set where each glyph carries a source and a
target, interpolated by the arrangement. The "draw the previous face too" pass
is deleted.

### 2.4 Capability contract

A generator declares which stages it supports. A composition that configures an
unsupported combination **fails at startup** with a message naming the
composition, the generator, the effect, and the valid alternatives — instead of
rendering something glitchy at frame 4000.

---

## 3. Stages

Every stage ends with `npm test` green. Stages 2 onward additionally require the
Stage 1 golden snapshots to be **byte-identical** unless the stage explicitly
changes behavior, in which case the diff is reviewed and re-baselined.

### Stage 0 — Green baseline and repo hygiene — **DONE**

Result: 159/159 green (from 154/159 plus 5 unrunnable `matrix/` suites).
Tracked files 863 → 579, of which 116 are first-party and 463 are the `matrix/`
reference project. The untracking is **staged but not committed**.

Both failures were regressions and were fixed in config, as decided:

- `config/compositions/inference-loop.js` had lost its `flicker` block,
  including the `envelope` timings three tests read. Restored from the older
  copy in `.claude/worktrees/global-palette`.
- `src/generators/procedural-topology-generator.js:53` had been widened by hand
  from `>= 0.7` to `>= 1.0` (trailing whitespace and all) so that
  `boundaryWhitespace: 0.99` would load. Bound and message restored.
- `boundaryWhitespace` set to **0.25**, not the original 0.08. Probing the
  shipped 5×3 grid showed the working window is 0.12–0.25: below 0.12 the blank
  count never varies between passes, and above ~0.3 the boundary swallows every
  territory interior so the region palette motion has nothing to animate. 0.25
  is the top of that window, closest to the evident intent of more whitespace.

Note that the validator's 0.7 ceiling is far more permissive than the real
behavioral limit, which is grid-dependent. Stage 4's startup validation should
check that the region interior is non-empty rather than trusting a fixed number.

#### Original Stage 0 scope

No behavior change.

- Add `.gitignore`; `git rm -r --cached node_modules dist`.
- Delete tracked junk: the root file named `\`, four `.swp` files, the
  conflicted-copy settings file.
- Scope the test script: `"test": "node --test test/*.test.js"`.
- Fix the 5 failing tests **as regressions**: restore the `flicker` block on
  `config/compositions/inference-loop.js` (3 failures) and bring
  `voronoi.boundaryWhitespace` back within the validator's bound (2 failures).

**Verify:** 159/159 green. `git ls-files | wc -l` drops from 863 to roughly 580.

**Risk:** low. The only judgement call is whether the voronoi validator bound or
the authored value is right — the validator and the tests currently disagree in
opposite directions, so this gets reported explicitly rather than guessed.

### Stage 1 — Agent files and debug mode — **DONE**

Result: 172/172 green, 13 new tests, 10 golden traces committed.

Landed:

- `AGENTS.md`, `CLAUDE.md`, this plan.
- `src/debug/index.js` — seven channels, printf formatter, per-channel rate
  limiting (`change` / every-N-frames), replaceable sink, hermetic
  `captureDebug`, and channel selectors that throw on a typo rather than
  silently never emitting.
- `src/debug/plain.js` — `toPlainState` copies typed arrays and survives cycles,
  so two inspections can finally be diffed; `diffPlainState` reports changed
  paths.
- `src/debug/headless.js` — `runFrames()` drives any composition with no
  browser, no canvas and no p5, returning the log, JSON-safe per-frame
  snapshots, per-frame draw counts, and a field-level change list. The counting
  context also answers "did this frame draw anything", which is how the blank
  intro frames in §1.3 were found.
- Instrumentation at the three blind spots: the director's endpoint phase, the
  endpoint plan's target/source pairing, and `SceneTransition.begin`.
- `director.inspect()` now reports `timeline`, and `SequenceRule` and
  `NativeCircleEndpointTransition` have `inspect()` for the first time.
- `cg\`debug <channels|all|off>\`` console command; `?debug=` URL parameter;
  `GLOBAL_CONFIG.debug.channels`.
- `test/golden-traces.test.js` plus `test/golden/*.trace.txt`.

Two pinned invariants were deliberately updated, as anticipated:
`architecture.test.js` asserted the exact four-field shape of
`director.inspect()` with `deepEqual`, and `config.test.js` pinned the
`GLOBAL_CONFIG` key list.

Deferred out of Stage 1, carried into Stage 2: normalizing the three divergent
generator `inspect()` shapes into one record. `toPlainState` at the debug
boundary covers the JSON-safety half of that item, but `CircleGrid.inspect()`
still hands live typed arrays to any other caller.

#### Original Stage 1 scope

Additive. Nothing existing changes behavior.

- `AGENTS.md`, `CLAUDE.md` (done).
- `src/debug/index.js`: channels, `%s/%d/%.3f` formatter, replaceable sink,
  URL-param + config + console-command enabling, per-channel rate limiting.
- `src/debug/headless.js`: `runFrames()` driving a director with a DOM-free
  context. Reuse `src/export/svg-recording-context.js` — it is already a tested,
  Canvas2D-compatible recorder.
- Add a `debug` command to the `cg` console.
- **Normalize `inspect()` to one record shape** across all generators. Today
  there are three incompatible shapes: the full timeline+flicker record, a
  near-match with a hardcoded `generatorType`, and a legacy `{ type }` blob.
- **Make `inspect()` JSON-safe** — copy typed arrays instead of returning live
  buffers, so two snapshots can be diffed.
- **Expose the timeline**: add `endpointState` to `director.inspect()`, and add
  `inspect()` to `SequenceRule` and `NativeCircleEndpointTransition`.

**Verify:** new tests for the debug sink and the headless driver. Record a
120-frame golden snapshot per composition — these become the regression net for
every later stage.

**Risk:** low. `director.inspect()`'s four-field shape is pinned by
`architecture.test.js:129`; extend it additively.

### Landed ahead of Stage 2 — the shared arrangement pool

Pulled forward because the intro/outro effects had to become authorable before
the timeline work, and because `sort-selection` was the only registered mode:

- `src/transitions/` exists: `index.js` (the pool — one registry, per-mode
  `phases` capability declaration, per-mode `defaults`), `fade.js`,
  `arrangement-items.js` (the one item normalizer), `presentations.js` (the
  multi-pose port).
- `fade` is the new intro/outro mode: reveal the centered parent cell over
  `revealFraction` of the phase, then crossfade into the composition. Its plan
  is total — every source is carried by some target, every target fades in, no
  offscreen fallback — and duplicate destination poses are drawn once.
- `sort-selection` declares `phases: ["state"]`. An intro or outro that asks for
  it throws at startup naming the phase and the alternatives. Both registries
  now come from the same pool, so `scene-transitions/sort-selection.js` (the
  duplicate registration under one name, §2.1) is deleted.
- Mode defaults live in the pool descriptor; both settings resolvers merge that
  one table instead of carrying their own copies.
- `CircleGridSceneGenerator.applyScene` no longer starts the native flip hinge
  while the endpoint intro owns the entrance. That hinge froze half-open because
  the core clock is paused during the phase, which is the blank-intro finding in
  §1.3. Measured over 300 frames: game-of-life 45 blank frames → 2, l-tree 51 →
  3, context-window 96 → 0, voronoi 33 → 2, inference-loop 60 → 1.
- Golden traces re-baselined; the endpoint transition line now carries `mode=`.
- A second port landed with the `text` mode: `drawOverlay(plan, progress,
  context)` for phase content that is in no scene — its ladder of subdivided
  cells and its centered string. Because a mode may now spend part of a phase in
  absolute seconds (`visibleSeconds`), overlay plans are keyed by phase length
  and rebuilt when it changes. The driver (`createPhaseOverlay`) hangs off the
  **director**, not the generators, so the overlay reaches every composition
  including those with no transition wiring (§1.2, cause 6) and draws exactly
  once per frame. `director.inspect()` reports it, and the `transition` channel
  logs each overlay phase change.
- The global finite non-flock end endpoint now selects `dijkstra`; flock keeps
  its native exemption. Every visible final parent cell routes concurrently to
  the centre, while merged route cells render and clean up once. A custom
  endpoint owns the outro phase exclusively, so the director withholds the text
  overlay and the matching generator-owned outro timing cannot run underneath
  it. Voronoi prepares one far-edge source per territory during its commit and
  settle body window, where all sources show the loading state; the frozen plan
  starts pathfinding only when the exclusive Dijkstra outro begins.

Still owed by Stage 2: merging the two settings resolvers, splitting the
CellShaper port out of the cell-transition registry, the one
`applyPresentation` helper, and the dead-code sweep.

### Stage 2 — Unify the arrangement subsystem

Mechanical and behavior-preserving.

- Merge `scene-transitions/transition-settings.js` and
  `cell-transitions/transition-settings.js` into one resolver. They are
  near-verbatim clones differing only in error-label strings, `fallbackToIntro`,
  and a trigger guard.
- One registry with descriptor validation and up-front normalization of *all*
  modes, copying `flicker-mode-registry.js`.
- Split the CellShaper port out of the transition registry.
- One `applyPresentation` helper; delete the four divergent copies. Fix the
  coordinate-space bug in `circle-grid.js` while there is exactly one copy to fix.
- Delete confirmed dead code: 14 unreferenced exports, the unimported
  `src/export/index.js` barrel, 32 unused `export default`s, `NoneCellTransition`,
  `createNoneTransition`, the `scene-transitions/sort-selection.js` shim,
  `THINKING_CONFIG`, `COMPOSITION_CONFIGS`, `statePlanItem`,
  `clampTransitionProgress`, `searchGridPath`/`findGridPath`,
  `circle-grid.js`'s write-only `previousEnergy`.
- Extract `clamp01` / `hashUnit` / `smoothstep01` to one shared math module.
  `clamp01` currently exists in 12 files.

**Verify:** existing tests plus byte-identical Stage 1 golden snapshots.

**Risk:** medium. `test/architecture.test.js` asserts several invariants against
`Object.create(Class.prototype)` with hand-attached fields, which pins private
field names as public contract — renames will break it without any behavior
change. Those assertions get rewritten to go through constructors.

### Landed ahead of Stage 3 — deterministic timing settings

The settings half of Stage 3 landed without claiming that the clocks have been
unified:

- Every canonical non-flock composition recipe declares
  `timing: { bodyDurationSeconds, beatCount }`. The body duration is an explicit
  positive number, the beat count is a positive integer, and
  `beatSeconds = bodyDurationSeconds / beatCount`. Alias recipes inherit their
  canonical recipe's root.
- `src/timeline/timeline-settings.js` validates the recipe root and resolves a
  field against its single named anchor. Config assembly compiles phase and
  endpoint durations, injects the resolved recipe timing into its generators,
  and the director stores the endpoint result once. Generator-specific flicker
  and state-hold anchors resolve once when those generators are constructed.
  Changing the active generator cannot change those resolved settings, but it
  can still change the legacy core/export duration until Stage 3.
- Migrated endpoint `"auto"` durations reuse the matching resolved intro/outro
  duration and never ask a live generator. Flock retains its exempt legacy path,
  but resolves that path once rather than on every frame.
- An explicit number bypasses automatic resolution. `"auto"` uses a field's sole
  anchor and `"calc(auto * n)"` scales only that anchor. A missing anchor throws
  during startup. Nested micro timings remain explicit unless their field
  documents automatic syntax. Text `visibleSeconds` is the exception: it
  resolves when its phase plan is built and caps every request at the 60% hold
  window, because an explicit endpoint can be shorter than the intro whose mode
  it uses.

The dependency table is:

| Field | Sole `"auto"` anchor |
|---|---|
| flicker `cycleSeconds` | composition `beatSeconds` |
| intro/outro `durationSeconds` | composition `beatSeconds` |
| text `visibleSeconds` | 60% hold window of its resolved phase |
| cell-transition `durationSeconds` | shortest body-state hold |
| start/end endpoint `durationSeconds` | matching resolved intro/outro |
| interactive color-transition `durationSeconds` | `beatSeconds`; one palette step |

`timeline.js`, one cycle definition, and removal of the competing generator
clocks remain Stage 3 work.

### Stage 3 — Single timeline owner

- Finish `src/timeline/` with `timeline.js`. One clock, phases
  `intro | body | outro`, one definition of a cycle. The settings resolver above
  is only the first half.
- The director owns it and publishes `frame.stage`. Generators own no transition
  clock.
- Keep `timeline-settings.js` as the composition-root and config-level duration
  resolver, with `automatic-duration.js` as the shared syntax parser. The unified
  runtime clock must consume resolved timing instead of deriving it from active
  generator state.
- Delete the dead `frame.endpointDt` field and the four divergent
  `endpointAutoDuration` implementations.
- Fix `seek()`: restore `SequenceRule` position, and replay with frames that
  carry the stage so restore matches playback.

**Verify:** the integration test `refactor.md` has been asking for — an enabled
start/end endpoint combined with a looping, timed, multi-step `SequenceRule`.
Plus new tests pinning the export seam invariants that currently have none:
draw-before-advance ordering, frame 0 at t=0, last frame at `duration - 1/fps`,
and the `exportFrameIndex`/`exportFrameCount` handshake that forces the closing
frame.

**Risk:** high. This is the stage that can break export. It is why Stage 1's
golden snapshots and the new export-seam tests come first.

### Stage 4 — Correct-by-construction intro/outro

- Make outro a real phase of the timeline; delete the `fallbackToIntro` gate
  that makes it unreachable.
- Enforce plan totality; delete the silent offscreen fallback; add the explicit
  `enter`/`exit`/`hold` policy.
- Single-pass draw; delete the previous-face second pass.
- Add the capability contract and startup validation.

**Verify:** golden snapshots show a real intro and a real outro for every
migrated composition. An architecture test asserts every generator except flock
implements the stage contract.

**Risk:** medium. Behavior changes here by design — snapshots get re-baselined
and reviewed visually.

### Stage 5 — Composability and docs

- Matrix test: instantiate every (composition × arrangement mode × phase)
  combination headlessly, assert no throw and full plan pairing. This is the
  test that would have caught every bug in §1.2.
- Rewrite the stale parts of `README.md`: it describes "six compositions" while
  seven ship, and its architecture tree omits `src/export/`, all of
  `src/visuals/`, `src/compositions/circle-endpoints.js`, and
  `src/generators/base-composition-generator.js`. It also documents
  `python3 -m http.server` while the repo ships vite.

**Risk:** low.

---

## 4. Explicit non-goals

- **flock.** Not touched. It keeps `NativeCircleEndpointTransition`, which
  therefore survives Stage 3 as a flock-only legacy path. This preserves one
  instance of the duplication the refactor otherwise removes — an accepted cost
  of the owner's decision. Note that flock is the currently-active composition
  in `config/global.js:22`, so the default view will not show the new behavior
  until that is changed.
- **`matrix/`.** Reference material for porting dot-matrix loaders. Excluded
  from the test runner, otherwise untouched.
- **Rewriting the large generators.** `interactive-grid-generator.js` (1989
  lines) and `grid-scene-strategies.js` (1668 lines) get contract conformance
  and dead-code removal, not restructuring.
- **New visual features.** No new compositions, modes, or effects until Stage 5
  lands.

---

## 5. Known issues noted but not scheduled

Recorded here so they stop living as source comments with nothing behind them.
Each needs a debug channel before it can be diagnosed, so none is scheduled
before Stage 1.

- `config/compositions/voronoi.js:28` — `// BUG: doesnt work with canvas` on the
  `strobe-stack` flicker mode. Flicker `scope: "canvas"` and the strobe-stack
  field appear to disagree.
- `config/global.js:16` — `// BUG: intro is weird` on inference-loop. Covered by
  §1.2 causes 2 and 4; verify against the golden snapshot after Stage 4.
- `config/global.js:128` — `// kinda looks like ass` on the `radar-arc` flicker
  mode. Aesthetic, not structural.
- `config/compositions/inference-loop.js:11` — stray indentation left by the
  removed `flicker` block; fixed incidentally in Stage 0.

---

## 6. Open questions for the owner

1. **Voronoi bound.** `boundaryWhitespace: 0.99` ships, but the validator and
   two tests disagree in opposite directions — one asserts `0.8` must throw, the
   other assumes a non-empty region interior. Which is the intended ceiling?
2. **`dist/` deployment.** Untracking it assumes deploys build from source. If
   something pulls `dist/` straight from git, say so before Stage 0.
3. **Timing curve authoring.** Should arrangement modes keep per-mode
   `timingCurve` control points, or should the timeline own easing so that any
   mode can be re-timed without editing the mode?
