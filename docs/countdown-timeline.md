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

## Default `clock → snake → bubbles` timing

Let `T = COUNT_FROM_SECONDS`. The two authored merge ranges are normalized to
the complete countdown, so changing only `T` stretches the whole preset.

| Item | Active window | Evolution window |
|---|---:|---:|
| clock track | `[0, T/6)` | `[T/6, T/3)` |
| clock→snake connector | `[T/6, T/3)` | same as active window |
| snake track | `[T/3, 2T/3)` | `[2T/3, 5T/6)` |
| snake→bubbles connector | `[2T/3, 5T/6)` | same as active window |
| bubbles track | `[5T/6, T)` | same as active window |

The five rows form one continuous, exclusive lane. After the clock handoff, the
snake grows only on `[T/3, 2T/3)`. Its final body freezes at merge start. During
`[2T/3, 5T/6)`, the first tail dot converts from level 0 to level 1 immediately,
then the remaining frozen body is consumed tail-first into bubbles. At `5T/6`,
the connector commits its converted trail into the bubbles track, and the
snake is gone.

For `T = 30`, the important boundaries are:

| Time | State |
|---:|---|
| 0 | clock begins |
| 5 | clock→snake merge begins |
| 10 | clock ends; snake begins growing at `00:20` |
| 20 | snake growth freezes; tail-first bubble merge begins at `00:10` |
| 25 | snake is fully consumed; bubble-only phase begins at `00:05` |
| 30 | loop returns to time 0 |

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
| snake→bubbles | `snake-to-bubbles` | Owns the bridge interval, freezes the grown snake, and consumes it tail-first into a trail committed to bubbles. |
| any unsupported pair | `hard-cut` | Shows the source through connection evolution and the target after that evolution finishes. |

Connector endpoint IDs refer to track `id`, never to effect `use`. Track and
connection IDs share one namespace and must all be unique. No track or
connection window may overlap any other timeline item.

Explicitly naming `clock-to-snake` or `snake-to-bubbles` for the wrong pair is a
startup error. Required semantic ports are also checked at startup.

## Layers and ownership

Outside an intentional gap, exactly one timeline item owns rendering. A normal
track produces its effect layer. A connector can produce several internal
layers—for example the snake→bubbles connector draws the frozen snake and its
converted trail—but those layers still belong to one connector state.

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
