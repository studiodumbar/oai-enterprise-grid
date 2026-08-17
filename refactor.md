# Refactor notes

## Composition timing ownership

`SequenceRule` predates the intro/outro work and was not overwritten. It
schedules generator entries using `compositionDt`; all current compositions
have one indefinite step, so it presently behaves as a generator selector.

The new start/end endpoint clock in `CompositionDirector` wraps and pauses that
same clock, while generators separately run intro/outro transitions at their
internal cycle boundaries. This is safe for the current one-step definitions,
but a future timed multi-step sequence could have conflicting duration and
lifecycle ownership because endpoint duration is derived from the active
generator rather than the complete sequence.

Before changing this architecture, add an integration test combining an
enabled start/end endpoint with a looping, timed, multi-step `SequenceRule`.
