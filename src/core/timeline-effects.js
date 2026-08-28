export const TIMELINE_EFFECTS = Object.freeze({
  RESTART_AT_INTRO: "restart-at-intro",
  RETURN_TO_AUTHORING_CORE: "return-to-authoring-core",
});

const TIMELINE_EFFECT_NAMES = Object.freeze(Object.values(TIMELINE_EFFECTS));

export function requireTimelineEffect(value, label = "Timeline effect") {
  if (!TIMELINE_EFFECT_NAMES.includes(value)) {
    throw new RangeError(
      `${label} must be one of ${TIMELINE_EFFECT_NAMES.join(", ")}.`,
    );
  }
  return value;
}
