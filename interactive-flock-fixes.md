# Interactive Take UX and playback repair

Decision complete — estimated implementation: 8–10 engineering hours.

## Summary

- Add per-beat duration and independent simulation/flicker targets.
- Ease continuous values across each beat using the existing cubic-bezier implementation.
- Replace the flicker dropdown with an animated mode gallery built from the existing Base preview renderer.
- Improve launcher counts, active-beat highlighting, and app-exported MP4 restoration.

## Implementation changes

1. **Per-beat state and timing**
   - Add `durationSeconds` to every beat; the configured take beat length remains only the initial/default duration and intro/outro timing anchor.
   - Move “Beat seconds” from Take to the selected/new beat as “Duration.”
   - Store complete simulation and flicker targets per non-Flow beat. New beats copy the previous effective targets and duration; the first copies composition defaults.
   - Flow stores only its duration, emits nothing, changes no settings, and lets the existing simulation continue.

2. **Scheduling and value ramps**
   - Add one cumulative schedule utility for total duration, step boundaries, seeking, local progress, and fixed-step tick ranges.
   - Replace all `index * beatSeconds` calculations in the rule, generator, Picasso path, flicker clock, telemetry, and export duration.
   - Ease `alignment`, `cohesion`, `separation`, `perceptionRadius`, and flicker amount from the previous target across the whole beat with `[0.42, 0, 0.58, 1]`.
   - Event/discrete values—birth count, initial launch speed, Boom intensity, flicker enabled/mode—switch at the beat boundary. Flicker amount ramps without recreating its controller every tick.

3. **Flicker gallery and take strip**
   - Extract the canonical five-density Base preview into a reusable headless preview card, then make Base and the interactive gallery use it.
   - Replace the mode dropdown with a two-column radio-style gallery generated from the flicker registry. All cards animate at 15 fps using the selected beat’s palette, amount, scope, and duration.
   - Pause previews when hidden, exporting, disconnected, or under reduced-motion; reduced-motion shows a static representative frame.
   - Launcher cards show the actual start count: `min(boid capacity, launch count × births per pulse)`, plus an accessible description and duration badge.
   - During core playback, the active beat gets a full signal border, bright index, bottom progress track, `aria-current="step"`, and one-time auto-scroll. Intro/outro marks no beat active.

4. **MP4 reconstruction**
   - Keep exact import support for this app’s MP4 exports with Embed state enabled, plus the existing Diogonisator path.
   - Imported takes open frozen and editable at beat 1 with playback at zero; all beat order, gestures, paths, Boom geometry, Flow beats, durations, and settings remain intact.
   - Treat generator simulations and prefix caches as optional acceleration. Incompatible viewport/cache data resets and deterministically rebuilds instead of aborting the whole restore.
   - Apply saved viewport/export dimensions before restoring viewport-dependent state, and pass the rule’s migrated snapshot—not the raw legacy state—to generators.
   - Unsigned/arbitrary MP4s produce a specific “no embedded project state” message and leave the current project untouched.

5. **Observability**
   - Log schedule creation, beat boundaries, ramp start/completion, schema migration, cache reuse/fallback, import completion, and rollback through shared debug channels.
   - Never log per-frame ramp values or add bare `console.log` calls.

## Interfaces and migration

- Interactive-take snapshot becomes version 7 with `step.durationSeconds`, absolute per-beat settings, and `stagedDurationSeconds`.
- Versions 1–6 migrate by assigning the former global duration to each beat and materializing their effective cumulative settings; legacy `skip` remains migrated to `flow`.
- Interactive flock generator snapshots gain a schedule/viewport cache signature; version-1 caches remain accepted but are discarded when incompatible.
- Project-state parameters become version 2 with the actual authoring viewport and director timeline; version 1 and the MP4 signature envelope remain supported.
- Add named preview-card APIs for configure, resize, draw, inspect, and dispose; previews never enter project snapshots or exports.

## Test plan

1. Mixed-duration preview, sealed looping, seeking, reordering, duplication, deletion, telemetry, and summed export duration.
2. Independent beat targets, whole-beat easing, discrete boundary changes, Flow preservation, prefix invalidation, and deterministic replay.
3. All flicker modes in both scopes, Base parity, gallery selection/accessibility, throttling, reduced motion, and snapshot immutability.
4. Launcher birth badges and active-beat progress, including auto-scroll and no active card during endpoints.
5. Cross-aspect signed-MP4 restore into another composition, edit-ready normalization, versions 1–6 migration, cache fallback logs, Diogonisator regression, and unsigned-file rollback.

Verification: focused tests, `npm test`, and `npm run build`; the existing eight unrelated dirty-worktree failures must not increase.

