# Noise Composition Takeover Plan

## Current checkpoint

- Editable noise controls and a visible import button are deferred. Keep the
  current field preview read-only; legacy metadata may still restore through
  drag-and-drop. `diogonisator` translates flat sandbox names at that boundary;
  authored config and native snapshots use canonical field components only.
  Reimplement the settings/keyframe UI in a later milestone.

- The pure foundation exists but is unconnected: four CPU modes (`value`, `voronoi`, `gradient`, `simplex`), a mode registry, settings resolution, and periodic value-noise support.
- These files are not imported by production code or tests. There is no sampler, shader, generator, composition bundle, catalog registration, or export integration yet.
- Correct the current draft before building upward: use 5 levels (`1×1` through `16×16`), restrict hold controls to color/visibility, and add a registry factory that registers all shipped modes.
- Current test baseline is 231/233. The two failures are unrelated transition/golden changes; preserve them without adding new failures or regenerating unrelated goldens.

## Implementation

1. **Finish the deterministic field core**
   - Add one shared sampling contract returning quantized scalar buffers for size, color, contrast, and visibility.
   - Apply the specified aspect-correct coordinates, seed offsets, contrast curve, smoothstep, and loop phase.
   - Sample size at `4×`, color at `1×`, and contrast/visibility at `16×`; reduce the latter two through exact 2× box averages.
   - Drive all four fields continuously. Color/visibility retain the original
     per-glyph minimum-change timer as `holdSeconds`; `0` disables it, while
     `"auto"` and `"calc(auto * n)"` resolve from the composition beat. Rebuild
     the timer state through the framework's fixed-step absolute seek.
   - `cyclesPerLoop: "auto"` means one repeat per composition beat for loopable
     modes. Numeric `speed` is signed field-units per second and opts into free
     drift; moving simplex is allowed and documented as deliberately non-looping.

2. **Add the offscreen p5.Shader backend**
   - Use one shared fragment shader on four `p5.Graphics(..., WEBGL)` surfaces; the main canvas remains Canvas2D.
   - Render RGBA8 field values, call `loadPixels()`, normalize WebGL Y orientation, and feed those CPU arrays into the same reduction and grid-state pipeline as the CPU sampler.
   - `backend: "auto"` uses shaders for browser preview when supported. Headless runs, all exports, and shader initialization/readback failures use the CPU backend.
   - Quantize both backends at the same post-chain boundary. Require fixture-level downstream agreement and scalar agreement within `1/255`; log backend selection or fallback once through `debug.config`.
   - Shaders generate field inputs only. Final circles remain Canvas2D vector paths, preserving SVG export.

3. **Build the standalone noise-grid generator**
   - Create a specialized generator that converts the four buffers into per-cell level and per-glyph palette/visibility state, then draws full circles through the raw Canvas2D context.
   - Size selects levels `0…4`; color selects one base palette entry per parent cell; contrast offsets each glyph’s base; visibility applies hard per-cell or soft deterministic per-glyph gating.
   - Extract reusable subdivision-centre geometry with an explicit maximum level. Existing generators remain capped at level 3; noise-grid alone opts into level 4.
   - Keep palette indexing local and dynamic from the selected palette length instead of widening the existing four-step face constants.
   - Implement the full lifecycle, deterministic `seek`, JSON-safe `inspect`, project-state round-trip, vector content bounds, shared intro/outro endpoint items, idempotent disposal, and transition-rate debug events.

4. **Wire the public composition**
   - Add global `noiseFields` defaults plus a `noiseGrid` settings group containing geometry, palette, backend, and four layer overrides.
   - Register `noise-circle-grid` in the catalog with the noise registry, palettes, shape renderer, and shared endpoint dependencies.
   - Add canonical composition `noise-grid` with one explicit timing root and one generator step.
   - Default to 5 levels, the existing target palette catalog, looping `value` fields, and shader-backed browser preview with transparent CPU fallback.
   - Keep Game of Life mode, animated shrink/grow level swaps, and noise layers on existing compositions out of this milestone.

## Public interfaces

- Noise mode descriptor: `{ name, defaults, loopable, normalize(settings), createField(context) }`.
- Field backend: `sample({ layout, progress, projectSeed, settings }) → { size, color, contrastLevels, visibilityLevels }`.
- Authored backend control: `"auto" | "cpu" | "shader"`; invalid names fail during config compilation.
- `inspect()` exposes the resolved backend, layout, cycle/tick indices, copied levels, palette indices, and visibility verdicts without exposing live typed arrays.
- Shader resources are runtime-only and are never serialized; project state contains only authored state and deterministic seed information.

## Verification and acceptance

1. Test every mode for deterministic range, normalization errors, unknown names, periodic seams, and simplex loop rejection.
2. Test sampling resolutions, post-chain quantization, reduction means, hold-tick boundaries, loop seams, and absolute-time seeking.
3. Test CPU/shader parity in a browser fixture, forced CPU fallback, WebGL resource resize/disposal, and no shader use during export.
4. Clone the generator lifecycle/geometry/export tests: legal `1×1…16×16` centres, full circles, alpha restoration, portrait resize, snapshot round-trip, and identical fresh-instance seeks.
5. Add config and headless coverage, review the new noise-grid golden trace, run `npm test`, and confirm only the two documented pre-existing failures remain until their unrelated branch is reconciled.

Assumptions: browser preview may use shader-generated field pixels, while deterministic/export output is CPU-generated from the same quantized contract. Exact cross-GPU float identity is not promised; exported bytes remain deterministic because exports always select CPU.

First action under two minutes: add `test/noise-fields.test.js` importing the existing four descriptors and registry so the current foundation becomes executable before further code is added.
