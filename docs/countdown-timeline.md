# Countdown timeline maintainer guide

Use this guide for every `countdown-framed` timeline or merge change. The
countdown has its own small effect synth; it does not use the composition
sequence as its visual timeline.

## Start here

| Change | Authoritative location |
|---|---|
| Countdown length | `COUNT_FROM_SECONDS` in `config/compositions/countdown-framed.js` |
| Which visuals play, and their order | `COUNTDOWN_SYNTH_TRACKS` in the same config file |
| Default merge positions | `appearance.synth.defaultTiming.merges` in the same config file |
| Clock, snake, or bubble appearance | `CLOCK_SETTINGS`, `SNAKE_SETTINGS`, or `BUBBLES_SETTINGS` in the same config file |
| Connector layer ownership | `src/countdown-effect-synth/builtins.js` |
| Window resolution and validation | `src/countdown-effect-synth/scheduler.js` |
| Effect geometry and drawing | `src/countdown-appearance-effects/clock.js`, `snake.js`, and `frame.js` |
| Timer host and final render plan | `src/generators/countdown-framed-generator.js` |

For a schedule-only change, edit the composition config and tests. Do not edit
the generator's stage logic; the scheduler already resolves the timeline.

## Mental model

```text
COUNT_FROM_SECONDS
        │
        ├── composition body duration and beat count
        │
appearance.synth
        │
        └── tracks + connections ── exclusive timeline resolver
                                           │
                                           ▼
                                  one active item or gap
                                           │
                         effect/connector registry ── render layers
                                           │
                          behind-timer → timer once → above-timer
```

The generator remains the timer/text host. It owns the changing countdown
label, cell selection, text reveal, layout, safe-zone geometry, and the current
clock/snake/bubble visual engines. The synth decides which one track or
connector owns the current timeline interval and its render layers. A connector
may sample both endpoint engines internally, but those endpoint tracks are not
also active timeline states.

Timeline seconds are elapsed seconds from the start, not seconds remaining. If
the total is 30 seconds, timeline time `0` shows `00:30`, while timeline time
`15` shows `00:15`.

## Four window rules

| Rule | Result |
|---|---|
| Windows are half-open `[start, end)` | A track ending at 10 is inactive at exactly 10; one starting at 10 is active. |
| Time wraps modulo the total | At exactly `COUNT_FROM_SECONDS`, the synth resolves time 0 again. |
| Timeline items never overlap | At most one track or connection is active at any instant. Any overlap is a startup error. |
| A connection exactly bridges its endpoints | It starts when its source track ends and ends when its destination track starts. |

A track's `evolution` may fit inside its own active window or an adjacent
connector interval that the track owns. This lets an effect supply the data for
a handoff without making its track a second active state. A custom gap is valid
and renders only the timer.

An endpoint effect that should configure a connector without receiving its own
visible interval can use `anchor: true` with a zero-second track window at a
countdown boundary. Its positive evolution window must still fit inside
connector time owned by that endpoint.

## Default `clock → snake → bubbles` timing

Let `T = COUNT_FROM_SECONDS`. Clock→snake remains normalized to the complete
countdown. Snake→bubbles is an explicit three-second transition ending at the
bubbles boundary.

| Item | Active window | Evolution window |
|---|---:|---:|
| clock track | `[0, T/6)` | `[T/6, T/3)` |
| clock→snake connector | `[T/6, T/3)` | same as active window |
| snake track | `[T/3, 2T/3 - 3s)` | `[2T/3 - 3s, 2T/3)` |
| snake→bubbles connector | `[2T/3 - 3s, 2T/3)` | same as active window |
| bubbles track | `[2T/3, T)` | same as active window |

The five rows form one continuous, exclusive lane. During the snake→bubbles
connector, the snake follows one deterministic toroidal coverage cycle. It
wraps at canvas edges and passes behind the timer instead of diverting around
each new label. The tail advances normally between growth steps, but the head
may cross occupied body cells; a crossing is counted and never kills the snake.
Normal snake motion continues until the connector boundary; the three-second
connector is only the state transition. By its final half-beat the body occupies
every parent cell except a reserved level-0 meal. The meal appears beside the
head, completes full coverage, and pulses with the head while movement freezes
and the registered `strobe-stack` flicker runs across the body. At `2T/3`, the meal joins the complete body and that death snapshot is
atomically committed into the bubbles track's body-derived dot field. The connector
never exposes bubbles early.

For `T = 30`, the important boundaries are:

| Time | State |
|---:|---|
| 0 | clock begins |
| 5 | clock→snake merge begins |
| 10 | clock ends; snake begins growing at `00:20` |
| 17 | snake→bubbles transition begins at `00:13` |
| 20 | snake dies atomically; bubble-only phase begins at `00:10` |
| 30 | loop returns to time 0 |

### Current 180-second loop

The checked-in track list exposes the complete score: clock `[0, 30)`,
clock→snake `[30, 60)`, snake `[60, 117)`, snake→bubbles `[117, 120)`, and
bubbles `[120, 180)`. The death flicker occupies `[119.5, 120)`. The countdown
labels at those boundaries are `03:00`, `02:30`, `02:00`, `01:03`, and
`01:00`.

`BUBBLES_SETTINGS.debug.visualizeBubbles` enables a translucent diagnostic
overlay for every live timer-avoidance bubble. Each circle is drawn separately
with `debug.opacity`, so intersections accumulate opacity and remain easy to
spot. The overlay follows the actual emptying and refilling annulus and does not
change which production dots are visible.

The bubbles background uses `visibilityMap.field` with the registered
`ink-shards` mode. Its four-scale rectilinear matte exposes a denser field of
background squares and independently displaces the emptying and refilling
contours. New spots continue through nearly the complete track. One off-centre
wipe starts during the final 1.4 seconds and reaches full coverage only at the
exact loop boundary, so bubbles never sit on an empty hold. Set
`countdownFramed.ui.noisePreview` to a boolean to auto-open or close the shared
field panel; the shipped value is `false`. For this composition the panel previews the opacity matte, contour
displacement, and flicker color; `cg\`noise-preview toggle\`` remains the runtime
override.

## Choose one timing mode

### 1. One visual for the complete countdown

Leave one untimed track and no connections. It automatically fills `[0, T)`;
do not copy numeric durations into it.

```js
const COUNTDOWN_SYNTH_TRACKS = Object.freeze([
  Object.freeze({
    id: "clock-main",
    use: "clock",
    zIndex: 10,
    settings: CLOCK_SETTINGS,
  }),
]);
```

The existing `COUNTDOWN_SYNTH_CONNECTIONS` derivation becomes `[]` because the
track list is no longer exactly `clock > snake > bubbles`.

### 2. Reorder or remove visuals with equal hard-cut slices

Use two or more untimed tracks and no connections. Array order is playback
order, and every track receives an equal consecutive slice of the total.

```js
const COUNTDOWN_SYNTH_TRACKS = Object.freeze([
  Object.freeze({
    id: "bubbles-first",
    use: "bubbles",
    zIndex: 10,
    settings: BUBBLES_SETTINGS,
  }),
  Object.freeze({
    id: "clock-second",
    use: "clock",
    zIndex: 20,
    settings: CLOCK_SETTINGS,
  }),
]);
```

For a 30-second countdown, this produces bubbles on `[0, 15)` and clock on
`[15, 30)`. `zIndex` does not determine sequential playback order; the array
does.

### 3. Leave an intentional timer-only gap

A lone track may specify only `startSeconds` or only `durationSeconds`. Missing
time extends to the nearest countdown boundary.

```js
const COUNTDOWN_SYNTH_TRACKS = Object.freeze([
  Object.freeze({
    id: "snake-opening",
    use: "snake",
    durationSeconds: 8,
    zIndex: 10,
    settings: SNAKE_SETTINGS,
  }),
]);
```

This renders the snake on `[0, 8)` and only the timer on `[8, T)`.

### 4. Author a custom exclusive timeline

Once a custom multi-track schedule has any explicit timing, fully specify
`startSeconds`, `durationSeconds`, and `evolution` for every track and
connection. This avoids mixing custom seconds with the canonical normalized
defaults.

```js
const COUNTDOWN_SYNTH_TRACKS = Object.freeze([
  Object.freeze({
    id: "clock-main",
    use: "clock",
    startSeconds: 0,
    durationSeconds: 8,
    evolution: { startSeconds: 8, durationSeconds: 4 },
    zIndex: 10,
    settings: CLOCK_SETTINGS,
  }),
  Object.freeze({
    id: "snake-main",
    use: "snake",
    startSeconds: 12,
    durationSeconds: 6,
    evolution: { startSeconds: 18, durationSeconds: 6 },
    zIndex: 20,
    settings: SNAKE_SETTINGS,
  }),
  Object.freeze({
    id: "bubbles-main",
    use: "bubbles",
    startSeconds: 24,
    durationSeconds: 6,
    evolution: { startSeconds: 24, durationSeconds: 6 },
    zIndex: 30,
    settings: BUBBLES_SETTINGS,
  }),
]);

const COUNTDOWN_SYNTH_CONNECTIONS = Object.freeze([
  Object.freeze({
    id: "clock-snake",
    from: "clock-main",
    to: "snake-main",
    use: "auto",
    startSeconds: 8,
    durationSeconds: 4,
    evolution: { startSeconds: 8, durationSeconds: 4 },
  }),
  Object.freeze({
    id: "snake-bubbles",
    from: "snake-main",
    to: "bubbles-main",
    use: "auto",
    startSeconds: 18,
    durationSeconds: 6,
    evolution: { startSeconds: 18, durationSeconds: 6 },
  }),
]);
```

That example targets a 30-second countdown. It resolves to five adjacent items:
clock `[0, 8)`, clock→snake `[8, 12)`, snake `[12, 18)`, snake→bubbles
`[18, 24)`, and bubbles `[24, 30)`. The resolver rejects a connection unless it
starts exactly at its source track's end and ends exactly at its destination
track's start.

## Connection behavior

`use: "auto"` resolves by the endpoint effect types:

| Pair | Resolved connector | Behavior |
|---|---|---|
| clock→snake | `clock-to-snake` | Owns the bridge interval and draws the handcrafted clock handoff. |
| snake→bubbles | `snake-to-bubbles` | Owns the bridge interval, grows the living snake, runs its registered body flicker for the final half-beat, then atomically commits the complete body to bubbles. |
| any unsupported pair | `hard-cut` | Shows the source through connection evolution and the target after that evolution finishes. |

Connector endpoint IDs refer to track `id`, never to effect `use`. Track and
connection IDs share one namespace and must all be unique. No track or
connection window may overlap any other timeline item.

Explicitly naming `clock-to-snake` or `snake-to-bubbles` for the wrong pair is a
startup error. Required semantic ports are also checked at startup.

### Clock-to-snake birth ripple

`CLOCK_SETTINGS.birthRipple.startBeforeHandoffBeats` places the ripple relative
to the clock-to-snake boundary, so countdown length changes do not move it away
from the snake birth. The shipped value is `1`: the ripple begins at `00:21`,
the snake starts at the half-open `00:20` boundary, and the four-beat ripple
continues behind the snake through `00:18`. Connector and track ownership stay
exclusive; after handoff the active snake track owns both its main layer and the
decorative ripple layer.

The ripple uses parent-grid cells. Its primary crest expands from the snake's
handoff cell using `radialTimingCurve`; cells behind the narrow crest subdivide
through levels `0`, `1`, `2`, and `3`, then clear after `wakeDepthInCells`.
Ripple glyphs keep the snake's normal dot size. Subdivided cells mask their
glyph grid into a circle instead of filling the complete square; when a cell
reaches level `3` (`8x8`), a stable nested subset of the circular fill drops out
as wake distance grows. Existing glyphs never move, and direct seek reconstructs
the same subset.
The handoff cell stays at level `0` only until the snake takes ownership. The
radius continues one full wake depth beyond the farthest canvas cell, and its
timing curve retains positive exit velocity so the last level-3 cells do not
stall at the edge. `wakeFlicker` applies deterministic flashes only to passed
primary cells at levels `1`, `2`, and `3`; both flash probability and opacity
strength decay exponentially with distance from the birthplace. The first crest
cell intersecting the timer's safe zone starts one fixed-cell echo capped by
`secondaryRadiusInCells`. The echo source stays fixed while the countdown text
moves each beat.

## Layers and ownership

Outside an intentional gap, exactly one timeline item owns rendering. A normal
track produces its effect layer. A connector can produce several internal
layers, but the snake→bubbles connector deliberately draws only the living
snake; its bubble field does not exist until destination-track ownership begins.

The final stable sort inside that owner is:

```text
band → zIndex → authored track index → layer id
```

The host draws every `behind-timer` layer, draws the timer text exactly once,
then draws every `above-timer` layer. Clock can opt into `above-timer` with
`behindText: false`; the shipped effects otherwise draw behind the timer.

Endpoint tracks never need suppression because they are inactive throughout a
connector window. Changing `zIndex` can order an owner's internal layers; it
cannot create simultaneous timeline states.

## What not to edit

| Tempting field | Why not |
|---|---|
| `appearance.order.stages` or `src/countdown-appearance-effects/order.js` | Legacy migration/test path; neither owns the synth timeline. |
| `appearance.effects` | Migration fallback; configured track `settings` are authoritative. Edit the shared constants used by those settings. |
| `dist/` | Build output; regenerate it with `npm run build`. |
| Generator stage switches | Scheduling belongs in the synth resolver and connector plans. |
| `zIndex` to reorder untimed tracks | Array order controls time; `zIndex` only orders layers inside the active owner. |

Removing a visual means removing its track. Setting `enabled: false` leaves the
track in the schedule and can still affect connector resolution.

Repeated effect types may use distinct IDs and windows, but the current host
still resolves one visual settings object per effect `use`. Until each track
owns a fully independent visual engine, repeated `clock`, `snake`, or `bubbles`
tracks must use identical settings.

## Debugging without guessing

Every new state boundary must emit one rate-limited event through the shared
debug API. Never add a bare `console.log` to `src/`, and do not log every frame.

Start the app, use the terminal's displayed URL, and append:

```text
?composition=countdown-framed&debug=config,timeline,transition,plan,cells
```

The important stable events are:

| Channel | Evidence |
|---|---|
| `config` | Resolved track windows, connectors, duration, and startup failures |
| `timeline` | Track enter/exit and active effect phase changes |
| `transition` | Connector enter/exit and clock/snake/bubble transitions |
| `plan` | Effect plans and final connector-owned render layers |
| `cells` | Countdown tick, label, and selected timer cell |

Inspect current ownership from the browser console:

```js
const countdown = circleGridApp.inspect().generators.countdownFramedGrid;
countdown.appearance.synth.activeTrackIds;
countdown.appearance.synth.activeConnectionIds;
countdown.appearance.synth.renderLayers;
```

The first two arrays have a combined length of one in the shipped schedule and
zero only during an authored gap. The bottom-center canvas strip is driven from
those same IDs when the `timeline` channel is enabled.

For a complete headless pass, run:

```sh
node --input-type=module -e "
  import { SETTINGS } from './config.js';
  import { runFrames } from './src/debug/headless.js';
  const seconds = SETTINGS.countdownFramed.countFromSeconds;
  const run = await runFrames({
    composition: 'countdown-framed',
    frames: Math.ceil(seconds * 60) + 1,
    channels: ['config', 'timeline', 'transition', 'plan'],
  });
  console.log(run.lines.join('\n'));
"
```

## Test the boundaries you changed

Put pure resolver and validation cases in
`test/countdown-effect-synth.test.js`. Put geometry, layer ownership, direct
seek, resize, and draw-count cases in `test/countdown-framed.test.js`.

For every changed window, test one sample before its start, exactly at its
start, exactly at its midpoint when behavior changes there, and exactly at its
half-open end. Also compare sequential playback with a fresh direct seek when
the change affects generated signals or accumulated bubbles.

Run the bounded verification first:

```sh
node --test test/countdown-effect-synth.test.js test/countdown-framed.test.js
npm run build
```

Then run the repository suite before handoff:

```sh
npm test
```

The committed golden-trace test samples 900 frames, which is 15 seconds at 60
fps. It does not replace direct boundary tests for transitions later in a
longer countdown. `UPDATE_GOLDEN=1 node --test test/golden-traces.test.js`
rewrites every composition baseline, not only countdown; review every resulting
diff and keep only intentional changes.

When the synth contract changes, update this guide, the shorter README summary,
and AGENTS.md's countdown timing note in the same change.

## Adding an effect or connector

An effect descriptor registers `{ name, defaults, seedSalt, ports, normalize,
create }`. Its instance must implement `resize()`, `planAt()`, `sampleAt()`,
`drawLayer()`, `inspect()`, and `dispose()`.

The current built-ins delegate their instances back to the countdown host, so a
new effect requires these bounded changes:

1. Add deterministic visual math under `src/countdown-appearance-effects/`.
2. Register its descriptor, unique seed salt, and semantic ports in `builtins.js`.
3. Add settings, signal, layer, draw, inspect, and lifecycle support to the host.
4. Add a track settings constant and timeline entry in the countdown config.
5. Test registry validation, absolute-time seeking, resize, loop reset, and drawing.

A connector declares its supported `from`/`to` effect types and required ports.
Its plan returns ordered connector-owned render layers. Keep connector geometry
in the connector/host path, make its window exactly bridge the endpoint tracks,
and test every ownership boundary.
