// One place that answers "what poses does this mode want drawn for this glyph".
//
// A mode may implement `presentationsAt` to place more than one pose per glyph
// — a crossfade needs the source and the target on screen together. Modes that
// place exactly one pose implement only `presentationAt`, and every renderer
// consumes the same array either way.
export function presentationsFrom(mode, plan, glyphId, progress) {
  if (typeof mode?.presentationsAt === "function") {
    return mode.presentationsAt(plan, glyphId, progress);
  }
  return [mode.presentationAt(plan, glyphId, progress)];
}
