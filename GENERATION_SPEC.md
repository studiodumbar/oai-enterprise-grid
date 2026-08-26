# Circle Grid — Generative Field System

Reference spec for reimplementing the generation pipeline of
`~/wip/openai/circle-grid-sandbox` (a single-file `index.html`, ~1580 lines)
inside a compartmentalized repo.

This document describes **what the system computes**, not how the monolith
happens to lay it out. Every constant, threshold and texture layout below is
load-bearing: they define the visual output and the determinism guarantees.

---

## 1. Model in one paragraph

A frame is a grid of square **parent cells**. Each parent cell is subdivided
into an `n × n` lattice of **circle slots**, where `n ∈ {1, 2, 4, 8, 16}`.
Four independent scalar fields, sampled from the same generator family but with
independent parameters, decide everything:

| Field          | Sampled at                                             | Decides                                                        |
|----------------|--------------------------------------------------------|----------------------------------------------------------------|
| **size**       | 4×4 taps per parent cell, averaged                     | which `n` the whole cell gets                                  |
| **color**      | 1 tap per parent cell                                  | the shared base palette position for every circle in that cell |
| **contrast**   | per circle slot (mip-averaged over the slot footprint) | additive modulation of that shared base, per circle            |
| **visibility** | per circle slot (mip-averaged)                         | binary keep/drop, per circle or per cell                       |

Circle color is quantized to exactly one entry of a 5–6 entry palette ramp — no
interpolation ever. Two independent **minimum-hold timers** (color, visibility)
prevent per-frame flicker.

---

## 2. Generator family (shared by all four fields)

One fragment shader (`NOISE_FS`) serves all four fields. Each field owns its own
`{type, scale, speed, contrast, seed}` and renders into its own offscreen
canvas at its own resolution.

### 2.1 Sample point

```glsl
vec2 uv     = gl_FragCoord.xy / uResolution;
float aspect = uResolution.x / max(1.0, uResolution.y);
vec2 p      = (uv - 0.5) * vec2(aspect, 1.0);       // aspect-corrected, centred
vec2 offset = uSeed * vec2(1.371, 2.113);           // seed decorrelates in XY
vec3 sp     = vec3(p * uScale + offset, uTime + uSeed * 0.173);   // z = time
```

Note `p` is aspect-corrected so cells stay visually square-isotropic, and the
seed shifts both space (`offset`) and the time axis (`+ uSeed * 0.173`).

### 2.2 Generator types

`SOURCE_TYPES = { simplex: 0, voronoi: 1, gradient: 2 }`, plus `life` (CPU/GPU
side path, color field only).

1. **simplex** (`uType < 0.5`) — standard Ashima/`webgl-noise` 3D simplex
   (`mod289`/`permute`/`taylorInvSqrt`, `42.0 * dot(m*m, …)`), remapped:
   `value = 0.5 + 0.5 * simplex3d(sp)`. A finite layer `speed` moves it through
   Z, but 3D simplex is not periodic there; motion is deterministic while the
   composition endpoint does not match its start exactly.
2. **voronoi** (`uType < 1.5`) — 3×3×3 neighbourhood nearest-feature-point
   distance with `hash33(p) = fract((p.xxy + p.yxx) * p.zyx)` after
   `p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33)`.
   `value = 1.0 - clamp(voronoi3d(sp), 0.0, 1.0)`.
3. **gradient ramp** (else) — not noise. Direction from the seed via the golden
   angle: `angle = uSeed * 2.39996323`. `rampCoord = dot(p, dir) * uScale +
   uTime + uSeed * 0.173`, then a mirrored triangle wave
   `value = 1.0 - abs(mod(rampCoord, 2.0) - 1.0)` → repeating `0 → 1 → 0`.
4. **Conway's Game of Life texture** — only offered on the **color** field.
   Separate module (`shared-lib/src/life-texture.js`), see §2.5.

### 2.3 Common post-chain (identical for all types)

```glsl
value = clamp((value - 0.5) * uContrast + 0.5, 0.0, 1.0);   // contrast around 0.5
value = smoothstep(0.0, 1.0, value);                        // fixed S-curve, always on
```

Then, only when `uBinarize` (visibility preview) is set:

```glsl
band = uSoftness > 0.0001
  ? clamp((value - uThreshold + uSoftness) / (2.0 * uSoftness), 0.0, 1.0)
  : step(uThreshold, value);
```

Then, only when `uColorize` (color preview) is set, `snapPalette(value)` —
`floor(clamp(value, 0, 0.999999) * uPalCount)` indexed into `uPal0..uPal5`.
The `0.999999` clamp is what keeps index `== count` unreachable.

### 2.4 Speed is an integrated rate, not a multiplier

`uTime` is **not** `t * speed`. It is

```js
motionTime = timeline.integrate(prefix + 'Speed', 0, t, speed)
```

i.e. the definite integral of the (possibly keyframed) speed track from `0` to
`t`, falling back to `speed * (t - 0)` when the track is off. Consequence:
animating a positive speed *downwards* slows the field instead of rewinding its
accumulated phase. Integration is piecewise over keyframes with an eased-area
term per segment (`curveArea(ease, p)`), constant extrapolation before the
first and after the last key. **Reimplement this or fields will jump when speed
is keyframed.**

The current canonical composition treats numeric `speed` as signed field units
per second and makes it mutually exclusive with non-zero `cyclesPerLoop`. This
matches an unkeyframed legacy rate exactly, so `diogonisator` can translate it
without guessing a beat count. Keyframed integration remains part of the
deferred settings/keyframe UI milestone.

### 2.5 Game of Life generator (color field only)

Fixed-size automaton, display-scaled:

- Simulation grid: `height = 64`, `width = clamp(round(64 * aspect), 8, 512)`.
  Fixed size makes animated `scale` cheap — scale is a *display* zoom
  (`fract((uv - 0.5) * max(0.01, scale / 5) + 0.5)`), not a resample of the sim.
- Seeded init: integer hash per cell
  (`imul(x+1, 374761393) ^ imul(y+1, 668265263) ^ seedKey`, then
  `imul(h ^ h>>>13, 1274126177)`, `(h ^ h>>>16) >>> 0`), alive if
  `hash / 2^32 < 0.28`. `seedKey(seed) = round(seed * 1000) | 0`.
- Rules B3/S23 with wrap-around. `R` channel = exact binary state; `G` =
  quantized age in generations (`+1/255` per generation while dead, reset to 0
  on birth) so a `trail` display term can decay without touching the automaton.
- Generation clock: `target = floor(max(0, time) * abs(speed) * 30 + 1e-7)`.
  Rules aren't reversible, so **either sign of speed advances**; speed `0`
  freezes at the seeded generation. Passed `time = abs(motionTime)`, `speed = 1`
  from the caller (the integrator already applied speed).
- Reset condition: sim size changed, seed changed, or `target < generation`
  (i.e. time went backwards — export restart / loop wrap).
- GPU path: two ping-pong `NEAREST`/`CLAMP_TO_EDGE` textures + framebuffer,
  `while (generation < target) advance()`. CPU fallback reproduces the same
  seed, the same rules and the same generation clock.

### 2.6 CPU fallback for the main generator

If WebGL is unavailable: `gradient` is reproduced exactly in JS (same triangle
wave, same contrast, same `v*v*(3-2v)` smoothstep, same binarize). `simplex` and
`voronoi` degrade to an animated radial gradient — deliberately *not*
pixel-equal; it exists only so the tool still runs.

---

## 3. Grid geometry

```js
lc    = min(31, max(3, 2 * round((longCells - 1) / 2) + 1))   // snap to ODD
cell  = max(w, h) / lc                                        // square cells
fit   = px => max(1, floor(px / cell + 1e-6))
cols  = w >= h ? lc : fit(w)
rows  = w >= h ? fit(h) : lc
pw, ph = cols * cell, rows * cell                             // pattern rect
```

- The **long side** always gets exactly `lc` cells; odd-snapping guarantees a
  centre cell exists (keyframe interpolation can hand any in-between value).
- The short side takes as many whole cells as fit; the remainder stays as an
  even background gap.
- `frameMargin` is a **post scale**, never a sampling change: `m = clamp(round
  (frameMargin), 0, lc - 1)`, `s = (lc - m) / lc`, and the finished pattern is
  scaled by `s` toward the centre. One slider step = half a cell of the long
  side per side. The circles themselves never change when margin animates.

---

## 4. Sampling resolutions and the mip atlas

Per frame, for grid `cols × rows`:

| Field | Render size | Why |
|---|---|---|
| size | `cols*4 × rows*4` | 4× supersample; 16 taps averaged → one level per cell |
| color | `cols × rows` | exactly one sample per parent cell |
| contrast | `cols*16 × rows*16` | finest circle lattice |
| visibility | `cols*16 × rows*16` | finest circle lattice |

**contrast and visibility are then turned into a mip atlas** so that a circle at
level `n` reads the field *averaged over its own footprint* — a 1×1 circle gets
its cell's mean, not one centre tap. Without this the pattern stops reading
consistently across levels at high `scale`.

Atlas layout — canvas `cols*16 × rows*31`:

```
level 16 → rows*16 tall, row offset rows*0      (= rows*(32 - 2*16))
level  8 → rows*8  tall, row offset rows*16
level  4 → rows*4  tall, row offset rows*24
level  2 → rows*2  tall, row offset rows*28
level  1 → rows*1  tall, row offset rows*30
```

General form: **level `n` sits at row offset `rows * (32 - 2n)` and is
`cols*n × rows*n` texels.** Total height `16+8+4+2+1 = 31` cell-rows.

Built by successive exact 2× box downscales with `imageSmoothingEnabled = true`,
each step reading the atlas region written by the previous step:

```js
mip.width = cols * 16; mip.height = rows * 31;
ctx.drawImage(src, 0, 0);
let srcY = 0, srcW = cols*16, srcH = rows*16, dstY = rows*16;
while (srcW > cols) {
  const dstW = srcW / 2, dstH = srcH / 2;
  ctx.drawImage(mip, 0, srcY, srcW, srcH, 0, dstY, dstW, dstH);
  srcY = dstY; srcW = dstW; srcH = dstH; dstY += dstH;
}
```

Shader-side lookup for slot `sub` inside cell `cell` at level `n`:

```glsl
vec2 slot = cell * n + sub + 0.5;
vec2 uv   = vec2(slot.x / (uCells.x * 16.0),
                 (uCells.y * (32.0 - 2.0 * n) + slot.y) / (uCells.y * 31.0));
```

---

## 5. The four layers in detail

### 5.1 Size → subdivision level

Shader averages the cell's 16 alpha-weighted taps, then:

```glsl
float covered = step(0.03, aSum / 16.0);        // source coverage gate
vec3  avg     = sum / max(aSum, 1e-4);
covered      *= step(uEmpty, dot(avg, LW));     // `emptyBelow`, on RAW luminance
float v = pow(dot(avg, LW), uGamma);
v = mix(1.0 - v, v, uInvert);                   // default (invert=0): dark → fine
float n = exp2(floor(clamp(v, 0.0, 0.999) * 5.0));   // 1/2/4/8/16
```

`LW = vec3(0.2126, 0.7152, 0.0722)` (Rec.709). `emptyBelow` is tested on raw
luminance before the tone curve so `gamma` can't shift the cutoff; default `0`
keeps every covered cell because `step(0.0, 0.0) == 1`.

### 5.2 Color → one shared base per cell, quantized

- One sample per parent cell (`cols × rows` canvas), red channel.
- Every circle in the cell — including all 256 of a 16×16 cell — starts from
  that same base.
- Palette index: `min(palN - 1, floor(v * palN))`.
- Palettes (`COLOR_RAMPS`) are ordered **dark → light**, 5 entries, except
  `green` which has 6 (the extra dark step eases the jump to a black
  background). The pipeline reads `ramp.length` — do not hardcode 5.
  Sets: `green, blue, orange, pink, yellow, purple`.

### 5.3 Contrast → per-circle modulation of that base

Purely **additive around the midpoint**, so it creates internal light/dark
separation inside a cell without replacing the color field:

```js
v    = clamp(base + influence * (contrastMip[slot] / 255 - 0.5), 0, 1)
want = min(palN - 1, floor(v * palN))
```

`contrastInfluence ∈ [0,1]` fades the modulation from off to full.

### 5.4 Visibility → binary keep/drop

Two regimes, switched by the **grey zone** (`maskSoftness`):

- `softness <= 0.0001` — **per-cell** hard gate. Reads the *level-1* atlas block
  (`row offset rows*30`) once per cell: `want = mask >= threshold ? 1 : 0`.
  The whole cell renders or the whole cell disappears.
- `softness > 0.0001` — **per-circle** stochastic fill. For each slot:

```js
fill = clamp((m - threshold + softness) / (2 * softness), 0, 1)
rnd  = frac(sin((gx*n + sx + 0.5) * 127.1
            + (gy*n + sy + 0.5) * 311.7
            + n * 74.7) * 43758.5453)
want = rnd * 0.999999 <= fill ? 1 : 0
```

The hash is **stable per slot and per level** (`n` is in it), so boundary cells
lose *individual* circles gradually instead of popping whole. The preview
shader's `band` term reproduces this fill fraction as a grey ramp.

---

## 6. Minimum-hold timers (the anti-flicker rule)

Two independent CPU passes, same shape, both writing an `ImageData` atlas
uploaded as a texture. State is **per slot at every level** (`Uint8Array cur`,
`Float32Array changedAt`, both `cols*16 × rows*31`).

```js
seeding = lastT < 0 || t < lastT          // first frame / loop wrap / export restart
if (seeding) { cur[s] = want; changedAt[s] = t - hold; }   // seed starts UNLOCKED
else if (want !== cur[s] && t - changedAt[s] >= hold) { cur[s] = want; changedAt[s] = t; }
```

- `colorHold` (default `0.2 s`) — a circle can't jump palette entries on
  consecutive frames. Extra guard: `if (cur[s] >= palN) cur[s] = palN - 1` for
  when the ramp shrinks on a `colorSet` switch.
- `maskHold` (default `0.2 s`) — a circle can't strobe in/out.
- Encoding for the shader: color writes `round((cur + 0.5) / palN * 255)` so
  `floor(r * N)` decodes exactly; visibility writes `cur * 255`.
- `0` disables the hold (a change is always allowed).

The seed being *unlocked* (`changedAt = t - hold`) matters: it makes the first
post-seed frame free to change, so exports don't start with a frozen field.

---

## 7. Optional animated level transitions (`animate`)

When on, the size field no longer drives `n` directly in the shader; a CPU state
machine per cell does, and the shader reads a `cols × rows` state texture
(`R` = level index `0..4` as `cur/4*255`, `G` = radius scale).

Per cell state: `lum` (smoothed), `cur`, `tgt`, `phase`, `p`.

1. **Temporal smoothing** — frame-rate independent exponential:
   `k = 1 - pow(clamp(smoothing, 0, 0.99), dt * 60)`; `lum += (lum_now - lum) * k`.
2. **Banding with a Schmitt trigger** — `want = min(4, floor(clamp(v,0,0.999999) * 5))`
   then a deadband so a cell hovering on a threshold can't chatter:
   `if (want > cur && v < 0.2*(cur+1) + hy) want = cur;`
   `if (want < cur && v > 0.2*cur - hy) want = cur;` (`hy = hysteresis`, def `0.03`).
3. **Phase machine** `idle(0) → shrink(1) → grow(2)`, `p += dt / animDur`
   (`animDur` def `0.23 s` per half; a full swap is 2×). The grid swaps at
   **zero radius**. With `cascade` on, the swap steps one level
   (`cur += sign(tgt - cur)`), so 1×1 → 16×16 plays `1 → 2 → 4 → 8 → 16`,
   growing between steps; with it off it jumps straight to `tgt`.
4. **Radius curves** — two 8-entry tables, linearly interpolated
   (`easeAt(curve, p)`), preserving the original After Effects timing:

```js
EASE_DOWN = [0, 0.0069, 0.0297, 0.0734, 0.1459, 0.2622, 0.4607, 1]  // radiusScale = 1 - easeAt(...)
EASE_UP   = [0, 0.5385, 0.7443, 0.8602, 0.9305, 0.9721, 0.9936, 1]  // radiusScale = easeAt(...)
```

`dt = min(0.25, t - lastT)` clamps hitches. Color and visibility stay
independently live during transitions — only the size field is animated.

---

## 8. Composite and determinism

Per frame, in order:

```
t = t % max(0.1, duration)          // one pass; preview wraps, exports step one pass
compute cols/rows/cell/margin
updateNoiseSamples(cols, rows, t)   // render all four fields + build both mip atlases
updateColorHold(cols, rows, t)      // per-slot snapped index + hold
updateMaskHold(cols, rows, t)       // per-slot 0/1 verdict + hold
if (animate) updateCellAnim(cols, rows, t, sizeTaps, 4)
render (GL, or the 2D fallback) into the pattern rect
draw the pattern rect scaled by `s`, centred
```

Circle coverage in the shader is analytic: `dd = length(sl) - radius` with
`cov = (1 - smoothstep(-1, 1, dd)) * covered * maskVis * step(0.001, radiusScale)`,
so a ~1px anti-aliased edge. `radius = min(subPx.x, subPx.y) * 0.5 * (1 -
dotMargin) * radiusScale`.

**Determinism rules that must survive the port:**

- Every stateful pass (`anim`, `colorHold`, `maskHold`) re-seeds when
  `t < lastT` or when `cols`/`rows` change. `resetAnim()` zeroes all three and
  is called **before every export** so frame 0 is reproducible.
- Exporters run their own clock (`t = i / fps`), apply the timeline at that
  exact `t`, and call the *same* draw function as the preview. The live preview
  loop must be **paused** for the duration of a video export — the animation
  state is shared, and a preview draw at a much later clock makes the export see
  time jump backwards every frame and re-seed, so transitions never play.
- In the legacy sandbox, all params lived in one flat, JSON-serializable object
  (`PARAMS`). That shape is import data only in this repository.
- The 2D fallback (`draw2D`) reads **the same hold atlases at the same slot
  indices** as the shader, so it stays pixel-equivalent in banding, color and
  visibility.

---

## 9. Parameter reference

> UI status: the legacy settings data model and import migration are supported,
> but the editable controls/keyframe interface is intentionally not exposed in
> the current app. Reimplement that UI as a separate milestone. The existing
> “Noise fields” panel remains a read-only diagnostic preview.
>
> Import boundary: `src/export/diogonisator.js` detects the old flat parameter
> names and translates them once into canonical composition settings. The
> `noise-grid` config and generator never read legacy names such as `bgColor`,
> `colorSet`, `longCells`, or `maskType`. Native project snapshots store the
> canonical settings and bypass the converter.
>
> All four canonical fields move continuously. Color and visibility additionally
> accept `holdSeconds`, matching the legacy per-glyph minimum-change timer: `0`
> disables the timer, an explicit number preserves a legacy value, `"auto"`
> resolves to one composition beat, and `"calc(auto * n)"` scales that beat.
> The timer holds only each glyph's final palette index or visibility verdict;
> it never freezes or beat-quantizes the underlying noise field. Absolute seek
> reconstructs those small state buffers through fixed 1/60-second steps.
>
> Canonical loop motion uses the same beat root: `cyclesPerLoop: "auto"` means
> one repeat per beat and therefore resolves to the composition's `beatCount`.
> `"calc(auto * 0.5)"` resolves to half as many repeats. The result must be a
> whole number accepted by the selected loopable mode. Use `cyclesPerLoop: 0`
> plus numeric `speed` for free drift, including deliberately non-looping
> simplex. Authoring both motion systems on one layer is an error.

Per field `X ∈ {size, color, contrast, mask}`: `XType`, `XScale` (0.2–50),
`XSpeed` (−1..1), `XContrast` (0.2–3), `XSeed` (0–100 int).

Field-specific: `contrastInfluence` (0–1), `maskThreshold` (0–1),
`maskSoftness` (0–0.5), `maskHold` (0–2 s), `colorHold` (0–2 s).

Defaults as shipped:

```
size:     simplex, scale 2.4, speed  0.12, contrast 1.15, seed  1
color:    simplex, scale 5.2, speed -0.08, contrast 1.10, seed 17,  hold 0.2
contrast: simplex, scale 2.1, speed  0.05, contrast 1.00, seed 43,  influence 1
mask:     simplex, scale 1.6, speed  0.07, contrast 1.20, seed 29,
          threshold 0.5, softness 0.1, hold 0.2
```

Pattern / dev: `longCells` 9 (3–31, odd), `frameMargin` 1, `dotMargin` 0,
`gamma` 1, `invert` false, `emptyBelow` 0, `hysteresis` 0.03, `smoothing` 0.5,
`animate` false, `animDur` 0.23, `cascade` true, `colorSet` green,
`bgColor` #ffffff.

Every numeric visual control is keyframable, and the four `XSpeed` tracks are
consumed through the **integrator**, not sampled (see §2.4).

---

# Part II — Porting into `circle-grid-p5` (`~/wip/openai/p5js`)

The target repo is **canvas-2D only** (`p.createCanvas(w, h)` with no renderer
arg, `src/sketch.js:282`; a repo-wide grep for `webgl|shader|glsl|.frag|.vert`
outside `node_modules`/`matrix`/`dist` returns **zero hits**). It also has **no
keyframe system**, **no simplex noise**, and a **4-level** subdivision policy.
So this is not a copy — four things must be redesigned. Everything else maps
cleanly onto existing conventions.

## 10. The four hard conflicts (decide these before writing code)

### 10.1 Hybrid field input backend (supersedes the original CPU-only decision)

The shipped design may evaluate field inputs on one reusable WebGL2 surface in
the browser, rendering the four logical layers sequentially and copying each
RGBA8 result before reuse. Circles are still drawn as Canvas2D/vector paths.
Headless runs and every export use the CPU sampler, so deterministic and SVG
output never depend on a GPU. `auto` falls back once for the complete sampler;
explicit `shader` fails loudly when WebGL2 is unavailable or readback breaks.

The CPU-only text below records the earlier design constraint; it no longer
forbids this input-only hybrid backend.

Two target-repo invariants forbid the shader path:

- Export goes through `src/export/svg-recording-context.js`, a Canvas2D-shaped
  recorder that emits SVG. A WebGL blit is one opaque `<image>` — SVG export
  dies.
- `test/golden-traces.test.js` runs 900 frames headless in Node via
  `src/debug/headless.js`. There is no GL context there.

**Decision: evaluate all four fields on the CPU, per slot, in JS.** The fields
are tiny — at `longSideCells = 9` on 16:9 you get `9 × 5 = 45` cells, so the
16×16 lattice is `144 × 80 = 11,520` samples for contrast and the same for
visibility. That is cheap enough per frame, and it is the only version that is
Node-testable and SVG-exportable.

Consequence: **the mip atlas (§4) disappears.** Its whole purpose was to get a
footprint-average out of a GPU texture. On the CPU, compute the average
directly — for a circle at level `n`, average `k × k` field taps over that
slot's footprint (`k = 16 / n`, i.e. 1 tap at level 16, 16×16 taps at level 1).
That is *the same arithmetic the box-downscale chain performed*, expressed
directly. Keep the identity: **level `n`'s value is the mean of the 16×16-grid
taps inside that slot.** Do not substitute a centre tap — see §4 for why.

Practical shape: sample the field once into a `Float32Array(cols*16, rows*16)`
per frame, then build the four coarser levels by in-place 2× box reduction into
one flat `Float32Array` of length `cols*rows*(256+64+16+4+1)` — the atlas layout
of §4 minus the RGBA/8-bit quantization. Keep the `rows * (32 - 2n)` offset
formula if you want the port to stay diff-readable against the original; a
plainer per-level offset table is equally fine since nothing samples it as a
texture any more.

### 10.2 8-bit quantization is now a choice, not a constraint

The original passed everything to the shader through `UNSIGNED_BYTE` textures,
which is why you see `round((cur + 0.5) / palN * 255)` and `cur * 255`
encodings. On the CPU, store the palette index as an integer and the verdict as
`0 | 1`. **But be aware this changes output**: the GPU version's field values
were 8-bit quantized *before* palette snapping and *before* the visibility
compare. If you want a visual match, quantize deliberately
(`Math.round(v * 255) / 255`) at the same points. If you want a clean
reimplementation, don't — and record that decision, because the two will differ
on boundary slots.

### 10.3 No keyframes → speed is a constant, but keep the seam

Target repo has zero keyframe/track/curve structures. Time-varying behavior is
one timing root per composition (`timing: { bodyDurationSeconds, beatCount }` →
`beatSeconds`) plus fixed phase-fraction tables and `timingCurve` beziers.

With a constant speed, the integral of §2.4 collapses:

```js
fieldTime(field, t) = speed * t
```

Two rules:

- **Keep it behind a function.** Write `fieldTime(fieldName, t)` even though the
  body is a multiply. It is the single seam where a future track integrator
  drops in, and it documents that `uTime` is a *phase*, not `t * rate`.
- **`CONFIG_ARCHITECTURE.md:239` forbids competing clocks.** A raw
  `speed: 0.12` in seconds⁻¹ is an independent clock. Express field speed as
  **cycles per beat** and derive `speed = cyclesPerBeat / beatSeconds` at
  compile time, or declare it with the automatic-duration vocabulary
  (`"auto"` / `"calc(auto * n)"`, `src/core/automatic-duration.js`) anchored to
  `beatSeconds`. Same for `colorHold` and `maskHold` — those are durations, and
  `"calc(auto * 0.25)"` off `beatSeconds` is the idiomatic authoring.

### 10.4 Hold timers vs. `seek()` determinism — the real problem

This is the one thing that will silently break if ported literally.

The original hold passes are **frame-history dependent**: `changedAt[s]` is
whatever wall-clock the last accepted change happened at, so the state at time
`t` depends on the sequence of `dt`s that led there. The target repo requires
the opposite (AGENTS.md §6, `test/grid-scene-generators.test.js:1190`):

> two fresh generators `seek(cycleSeconds * 3.35)` → identical `cycleIndex`,
> `cycleProgress` within `1e-9`, identical `sceneKey`, `levels`, `flipProgress`

and export builds a **fresh director from `snapshotProjectState()`**.

The implementation uses the second option because matching the original
per-glyph behavior is more important than making the field itself step:

1. **Quantize the hold to a tick grid.** Define
   `tick = holdSeconds` (or `beatSeconds / k`) and evaluate the field only at
   `tickIndex = floor(t / tick)`. A slot's value is then a pure function of
   `(tickIndex, slot)` — no accumulated state, `seek()` is exact, golden traces
   are stable, and the *visual* guarantee is preserved (nothing changes faster
   than `tick`). It also matches the target repo's existing idiom: discrete
   phase tables and `steppedIndexAt(time, cycleSeconds, steps)`
   (`src/visuals/flicker/field-geometry.js:53`).
   Cost: changes land on a shared grid, so the field pulses in lockstep instead
   of per-slot. If that reads badly, offset each slot's tick phase by a stable
   per-slot hash — still pure, still seekable.
2. **Replay from `t = 0` on seek (selected).** The field stays continuous and
   only each glyph's final palette/visibility state observes its minimum hold.
   The generator uses the framework's established fixed 1/60-second replay,
   resets the small state buffers on resize and loop wrap, and keeps them out
   of snapshots. This is O(frames), but the bounded five-resolution buffers
   preserve the legacy look and deterministic fresh-instance seek.
3. **Put the hold state in `snapshotProjectState()`.** Round-trips for export
   but does *not* satisfy the two-fresh-generators `seek` test. Don't.

The equivalent already-solved case in the target repo is `aurora.js:7` —
"a small ordered-dither threshold map turns a continuous decay into a stable
pattern". Same trick, same reason.

## 11. Subdivision, palette-step and face-shape mismatches

| Concept | Source (sandbox) | Target (`circle-grid-p5`) | Action |
|---|---|---|---|
| Levels | 5 — `1,2,4,8,16` (`n = exp2(floor(v*5))`) | 4 — `MAX_SUBDIVISION_LEVEL = 3`, `FOUR_LEVEL_COUNT = 4` (`src/grid/subdivision-policy.js`) | Either drop to 4 levels, or raise `MAX_GRID_FACE_LEVEL` to 4 |
| Glyph scratch | — | `1 << (MAX_GRID_FACE_LEVEL * 2)` = 64 (`circle-grid-scene-generator.js:481`) | 5 levels ⇒ 256; the scratch arrays must grow |
| Face `level` | 0..4 | `Int8Array`, `-1` blank, `0..3` | range widens to `0..4` |
| Palette steps | `ramp.length` = 5 or 6, read dynamically | `GRID_FACE_PALETTE_STEP_COUNT = 4`, `paletteStep` clamped `0..3`, asserted by test | genuine conflict — see below |
| Palette source | 6 named ramps in the tool | 8 named ramps in `GLOBAL_CONFIG.palettes` | reuse target's palettes |

**Recommendation: go to 5 levels and widen the palette-step range.** Dropping to
4 levels loses the 16×16 cell, which is the signature of this pattern — a 16×16
cell is 256 circles sharing one base color, and that is the effect. Widening
means touching `subdivision-policy.js`, `MAX_GRID_FACE_LEVEL`, the scratch
sizing, and the two tests that assert `0 <= level <= 3` and
`0 <= paletteStep <= 3` (`test/extensible-generators.test.js:84-91`).

Note the palette conflict is *structural*, not cosmetic: this system's whole
color model is "quantize to exactly one of N ramp entries, never interpolate",
with N read from the ramp (`ramp.length`, 5 or 6). A hardcoded 4 breaks it. If
widening `GRID_FACE_PALETTE_STEP_COUNT` is unacceptable, this generator must own
its own palette-index channel rather than reuse `paletteStep` — decide before
writing the face type.

## 12. Where each piece goes

Following the target repo's layout and `CONFIG_ARCHITECTURE.md`:

```
src/noise-fields/
  index.js                 registry + createNoiseFieldRegistry()   ← copy the shape of
                           src/visuals/flicker/flicker-mode-registry.js (AGENTS.md:155
                           calls it "the cleanest registry in the repo")
  simplex-mode.js          3D simplex — NEW CODE, does not exist in the target repo
  voronoi-mode.js          3D nearest-point — the target's "voronoi" is a scene
                           strategy (grid-scene-strategies.js:874), NOT this
  gradient-mode.js         mirrored directional ramp
  life-mode.js             B3/S23 texture (color field only)
  value-mode.js            optional: wrap the EXISTING valueNoise3D
                           (src/visuals/flicker/value-noise.js) as a 5th generator —
                           free, p5-free, already tested
  field-sampler.js         per-frame evaluation + level reduction (§10.1)

src/generators/
  noise-circle-grid-generator.js    the generator type

config/compositions/noise-grid.js   settings + generatorDefinitions + compositionDefinitions
```

- **Registry, not a switch.** Register **descriptor objects**, not bare
  factories, exactly like `FlickerModeRegistry`: `{ name, createField, normalize,
  defaults }`, frozen on register. `CONFIG_ARCHITECTURE.md:253` requires
  mode-owned defaults and normalization, and requires the compiler to validate
  **every registered mode, not only the active one** — so a later
  `sizeType: "voronoi"` switch can't surface a delayed config error.
- **Registry kind string** for `FactoryRegistry` if you use it instead:
  `new FactoryRegistry("noise field")` — the kind appears in every error message
  (`src/core/registry.js:16`).
- **Do not** put these in `src/fields/`. That directory's `write(field, frame)`
  contract (`FlockFieldSource`, `TypeMaskFieldSource`) targets `GridField`, a
  **per-cell** density/direct accumulator resolved through
  `resolveCell(index) = max(1 - exp(-density*gain), direct)`. This system needs
  **per-slot** values at five resolutions with no gain compression. Different
  concept, different directory. (If a *cell-resolution* variant is ever wanted,
  `NoiseFieldSource implements write(field, frame)` calling `field.maxCell` is
  the natural bridge — but that is not this feature.)
- **Generator type id** `noise-circle-grid`, registered in `src/catalog.js`
  alongside the others as
  `creationContext => new NoiseCircleGridGenerator({ ...creationContext, palettes, shapeRenderer, sceneTransitionTypes, noiseFieldTypes })`.
- **No `export default`** in new files (AGENTS.md §7.5). **No barrel files
  without a consumer** (§7.4).

## 13. Config bundle shape

`config/compositions/noise-grid.js`, three top-level sections, exactly like
`config/compositions/game-of-life.js`:

```js
export const NOISE_GRID_CONFIG = {
  settings: {
    noiseGrid: {
      longSideCells: 9,          // odd-snapped at runtime, 3..31
      frameMargin: 1,            // half-cells of the long side, POST scale
      dotMargin: 0,
      gamma: 1,
      invert: false,
      emptyBelow: 0,
      colorSet: "green",         // or reuse GLOBAL_CONFIG.palettes ids

      size:     { mode: "simplex", scale: 2.4, cyclesPerBeat: …, contrast: 1.15, seed: 1 },
      color:    { mode: "simplex", scale: 5.2, cyclesPerBeat: …, contrast: 1.10, seed: 17,
                  holdSeconds: "calc(auto * 0.25)" },
      contrast: { mode: "simplex", scale: 2.1, cyclesPerBeat: …, contrast: 1.00, seed: 43,
                  influence: 1 },
      visibility: { mode: "simplex", scale: 1.6, cyclesPerBeat: …, contrast: 1.20, seed: 29,
                    threshold: 0.5, softness: 0.1, holdSeconds: "calc(auto * 0.25)" },

      // per-mode settings tables, mode-owned defaults merged by the compiler
      modes: { simplex: {…}, voronoi: {…}, gradient: {…}, life: {…} },

      cellTransitions: { … },    // if the animated level transitions of §7 are ported
      flicker: { … },            // optional; note the OVERLAP warning below
    },
  },
  generatorDefinitions: {
    noiseCircleGrid: { type: "noise-circle-grid", settingsKey: "noiseGrid" },
  },
  compositionDefinitions: {
    "noise-grid": {
      timing: { bodyDurationSeconds: 24, beatCount: 12 },
      rule: "sequence",
      steps: [{ use: "noiseCircleGrid" }],
    },
  },
};
```

Then import it in `config.js` and add it to `COMPOSITION_BUNDLES`. That single
step also enrols it in the golden-trace set automatically
(`test/golden-traces.test.js:30-33` derives subjects from
`COMPOSITION_DEFINITIONS`).

Rules from `CONFIG_ARCHITECTURE.md` that bite here:

- **Merge per subsystem, never a generic deep-merge** (`:152`). Scalars replace;
  the `modes` table merges by mode name then setting key; **arrays replace
  wholesale** — which matters for palette ramps (`[[r,g,b], …]` is one authored
  decision, not an index-wise merge).
- **`settingsKey` and a string `options` are mutually exclusive** — the compiler
  throws (`test/config.test.js:829`).
- Document every inherited control as a **commented block inside the same
  settings group**, per the house convention (`game-of-life.js:17-18`).
- One timing root; `bodyDurationSeconds` must be explicit and finite, never
  automatic.

**Overlap warning — flicker.** `src/visuals/flicker/` is already a per-glyph
palette-modulation system, and `NoiseFlickerField` already samples a 3D noise
field per glyph (`noise-mode.js:10-12`, offsets `17.173 / 41.719 / 73.481`).
The **contrast layer** of §5.3 is conceptually the same thing: per-circle
modulation of a per-cell base palette value. Before writing a new contrast
field, check whether a flicker mode with `scope`/`distribution` set to
`value`/`level` gives it. AGENTS.md §7.2 ("one concept, one implementation —
grep before adding a helper") points squarely at this. Two plausible outcomes:
the contrast layer *is* a flicker mode, or the contrast layer is distinct
(it is *spatially coherent* noise sampled at the slot footprint, whereas
flicker is per-glyph modulation with a stagger envelope) — but make that call
explicitly rather than by accident.

## 14. Generator contract to satisfy

`NoiseCircleGridGenerator` must pass the lifecycle test in
`test/extensible-generators.test.js:157-250`. Concretely:

- Director-enforced order `resize → enter → update → draw → exit → dispose`.
  `dispose()` **idempotent**; `enter()` after `dispose()` throws `/disposed/`.
- `draw(frame, planEntry, context)` on the raw `CanvasRenderingContext2D`.
  `globalAlpha` is **multiplied, never assigned**, and always restored.
- `inspect()` returns `{ generatorType, generatorInstanceId, settingsKey, active,
  levels, layout, … }` — **JSON-serializable, typed arrays copied, never live
  buffers**.
- **Every arc is a full circle**: `radius > 0 && start === 0 && |end - 2π| < 1e-12`.
- **Every arc centre is a legal subdivision centre** — recomputed from
  `inspect().levels` + `subdivisionCentersForGridCell(layout, index, level)` and
  compared at `toFixed(6)`. The geometry of §3 must therefore be expressed
  through the existing layout helpers (`createCircleGridSceneLayout(viewport,
  longSideCells)`), not with a private `w/cols` computation. The `frameMargin`
  post-scale of §3 needs care here: a scale applied via `ctx.scale` changes
  where arcs land, so either fold the margin into the layout (so centres stay
  legal) or apply it as a transform the test's reconstruction also knows about.
- `resize()` to portrait → `layout.rows > layout.columns`, `levels.length ===
  columns * rows`.
- `seek(t)` deterministic to `1e-9` from two fresh instances (§10.4).
- `animationDuration()` in seconds or `null`.
- **Determinism:** no `Date.now()`, no `Math.random()` anywhere in the sample or
  draw path. Seeded only, from `runtime.projectSeed()`. The field seeds of §2.1
  and the visibility hash of §5.4 are already pure functions — keep them that
  way. Note the target repo has `hashUnit(a, b, c) -> 0..1`
  (`src/generators/grid-scene-strategies.js:82`); prefer it over re-adding a
  `fract(sin(…) * 43758.5453)` hash, which is a known-poor generator anyway.
- **Debug lines are mandatory** (AGENTS.md §3): one line per *state change*, not
  per frame, via `debug.<channel>(...)` with stable key order. Channels:
  `timeline, transition, plan, cells, draw, config, export`. Never a bare
  `console.log` in `src/`. This is exactly what makes the golden trace stable —
  a per-frame log makes the trace churn on every timing tweak.
- `snapshotProjectState()` / `restoreProjectState(state)` must round-trip.
  Export builds a **fresh** director from the snapshot: anything not in the
  snapshot does not exist during export.

## 15. Tests to add

1. **Field-mode determinism + range** — for every registered noise mode: same
   `(x, y, t, params)` → identical value; output within `[0, 1]` after the §2.3
   post-chain; unknown mode name throws `/Unknown noise field/`.
2. **Level reduction identity** — level `n`'s value equals the mean of its
   16×16-grid taps (§10.1). This is the invariant that replaces the mip atlas;
   assert it directly.
3. **Hold behavior** — with `holdSeconds` set, no slot changes palette index or
   visibility verdict in consecutive evaluations closer than the hold; with
   `holdSeconds: 0`, changes are unrestricted.
4. **Lifecycle** — the §14 contract, cloned from
   `test/extensible-generators.test.js:157`.
5. **Deterministic seek** — two fresh generators, `seek(cycleSeconds * 3.35)`,
   identical `levels` / palette indices / visibility verdicts.
6. **Golden trace** — automatic once the bundle is in `COMPOSITION_BUNDLES`.
   Generate the baseline with `UPDATE_GOLDEN=1 node --test
   test/golden-traces.test.js`, then read it before committing: a trace with
   `blankFrames` = 900 or a `firstDrawnFrame` of `-1` means nothing drew.
7. **Config resolution** — bundle appears once, ids unique, every
   `settingsKey`/`type` reference resolves, partial overrides preserve global
   defaults incl. the nested `modes` table, authored objects deep-equal
   unchanged after compile, `"calc(auto * n)"` hold durations resolve from
   `beatSeconds` and a missing anchor fails at startup.

Run: `node --test "test/*.test.js"`.

## 16. Suggested order of work

1. `src/noise-fields/` — the four modes + registry + a field-mode test. Pure
   functions, no p5, no generator. Ship this first; it is independently
   verifiable.
2. `field-sampler.js` — per-frame evaluation + level reduction, plus the
   reduction-identity test.
3. The hold decision (§10.4) implemented as a pure `(tickIndex, slot)` function,
   plus its test.
4. Resolve the level/palette-step conflicts of §11 — this touches shared files
   (`subdivision-policy.js`, `MAX_GRID_FACE_LEVEL`, two existing tests), so do
   it deliberately and in one commit.
5. `noise-circle-grid-generator.js` against the §14 contract.
6. `config/compositions/noise-grid.js` + `config.js` wiring; take the golden
   baseline.
7. Only then consider the animated level transitions of §7 — they are a
   `cell-transitions` mode, not generator code, and the system is complete
   without them.

## 17. What not to port

- The WebGL paths (`NOISE_FS`, `GL_FS`, the four texture units, NPOT/NEAREST
  setup) — §10.1.
- The mip atlas and its `rows * (32 - 2n)` texture layout as a *texture* — the
  averaging identity survives, the encoding does not.
- The 8-bit `ImageData` encodings of the hold atlases — §10.2.
- The canvas-2D emergency fallback (`draw2D`) — in the target repo, canvas 2D
  **is** the renderer, so there is one path, not two.
- The radial-gradient degradation for simplex/voronoi when GL is missing — no
  longer reachable.
- Tweakpane, the keyframe dope sheet, undo, and the signed-export plumbing — the
  target repo has its own export stack (`src/export/`, 19 modules) and no UI
  parameter schema at all (config is authored in files; the only runtime
  surfaces are the `cg` console CLI, `?debug=`, and `window.circleGridApp`).
- `shared-lib/` wholesale. Reuse only the *algorithms* documented in Part I.
