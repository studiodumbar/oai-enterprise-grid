# Smooth dot-matrix loader animations

This doc describes how we keep triangle (and similar) loaders **visually smooth**—the same ideas used in **Braille Beat** (`dotm-triangle-6`) and the smoothed path/wave loaders in this repo.

## 1. Drive opacity with a **continuous phase**

Use **`useCyclePhase`** when the loader only needs a normalized phase in `[0, 1)` over one loop.

- It advances with **`requestAnimationFrame`**, so opacity updates every frame instead of jumping on a coarse timer.
- **`useSteppedCycle`** quantizes time into `steps` buckets. That is fine for **intentionally discrete** UX (e.g. a stepped counter), but for “liquid” motion it often reads as **stair-steps** in opacity.

**Rule of thumb:** opacity-only motion → **`useCyclePhase`**. Discrete “cells per tick” → **`useSteppedCycle`** only if you really want pops.

```ts
const cyclePhase = useCyclePhase({
  active: cycleActive,
  cycleMsBase: 1800,
  speed
});
```

## 2. Use **smoothstep** ramps (Braille-style)

Braille Beat’s wave uses **`smoothstep01(edge0, edge1, x)`** so fills ramp gradually between 0 and 1 instead of hard thresholds.

- Reuse the same helper pattern as in `dotm-triangle-6` / `dotm-triangle-9`: map a raw signal (cosine, distance, etc.) through **`smoothstep01(low, high, value)`** so the **shoulders** of the curve ease in and out.

**Avoid:** squaring a cosine alone (`(0.5 + 0.5 * cos(u)) ** 2`) as the *only* shaper—it can still feel sharp at the wrong scales. Prefer **`smoothstep01` on the cosine** or combine with a wider falloff.

## 3. Path “snakes”: **float head + soft tail**

For a head moving along a closed path of `L` vertices:

1. **`s = phase * L`** — head position along the path in **continuous** arc-length (not `floor(phase * L)`).
2. For each vertex index **`i`**, compute **backward distance** along the loop from `s` to `i` (wrapping mod `L`).
3. Tail brightness: **`g = 1 - smoothstep01(0, TRAIL_SPAN, d)`** with `TRAIL_SPAN` around **3–4.5** path units for a long, soft tail.

See **`dotm-triangle-13`**, **`dotm-triangle-17`**, **`dotm-triangle-20`** for the `behindAlongPath` + `smoothstep01` pattern.

## 4. Waves on rows, columns, diagonals

- **Moving front:** prefer a **float** position (e.g. `front = 2.5 + 1.5 * cos(t)`) plus **Gaussian** or **`smoothstep` vs distance** to that front—not only integer row keyed cosines.
- **Pillars / beams:** replace `max(0, 1 - dist/k)` stacks with **`smoothstep` falloffs** vs `dist` so the beam has soft edges.
- **Diagonal harmonics:** **`smoothstep`** the primary (and optional harmonic) **before** mixing so bands don’t crunch.

## 5. Hub / corner blends

Avoid **`floor(phase * N)`** segment switches for crossfades unless you want obvious cuts.

- Prefer **continuous weights** (e.g. shifted cosines raised to a power) over several hubs, then **normalize** and blend falloffs—see **`dotm-triangle-15`** (tripod-style handoff).
- Hub distance falloff: **`1 - smoothstep01(0, D_MAX, manhattan)`** reads softer than `raw * raw` cutoffs.

## 6. Polar / wedge lights (e.g. pivot ray)

- Slightly **wider** Gaussian in angle space reduces shimmer.
- Run the final beam strength through **`smoothstep01`** so near-zero values don’t flicker from noise.

## 7. Reduced motion & idle

- When `matrixPhase === "idle"` or reduced motion is on, **freeze** `phase` at a stable constant so previews don’t jump.
- Keep **`useDotMatrixPhases`** for hover/play interaction; wire `active` on the cycle hook from the same idle/reduced-motion flags as existing loaders.

## 8. Registry / gallery

After changing a loader component:

1. Run **`pnpm registry:build`** so `public/r` and `registry.json` stay in sync.
2. If you add a new slug, update **`lib/registry-config.ts`**, **`loaders/index.ts`**, and **`components/loader-gallery.tsx`** (`componentMap` + `previewPropsMap`).

## Quick checklist

| Question | Prefer |
|----------|--------|
| Opacity animates smoothly over time? | `useCyclePhase` |
| Need soft ramps? | `smoothstep01` |
| Point moving on a path? | Float `s = phase * L` + `smoothstep` tail |
| Cosine “brightness”? | `smoothstep01` on cosine, or wider Gaussian |
| Handoff between regions? | Continuous weights, not `floor(phase * N)` |

Reference implementations: **`loaders/loaders/dotm-triangle-6.tsx`** (wave + smoothstep), **`dotm-triangle-9.tsx`** (cycle phase + smoothstep on ring wave), **`dotm-triangle-13.tsx`**, **`dotm-triangle-17.tsx`**, **`dotm-triangle-20.tsx`** (continuous path + soft tail).
