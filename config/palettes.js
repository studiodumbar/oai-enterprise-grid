const PALETTE_VARIANT_STEPS = Object.freeze({
  flicker: Object.freeze([1, 4, 2, 3, 0]),
  snake: Object.freeze([2, 3, 4]),
  countdown: Object.freeze([1, 2, 4, "#ffffff"]),
});

function requireFiveColorPalette(name, palette) {
  if (!Array.isArray(palette) || palette.length !== 5) {
    throw new RangeError(`Palette "${name}" must contain exactly five colors.`);
  }
  for (const [index, color] of palette.entries()) {
    if (typeof color !== "string" || color.trim() === "") {
      throw new TypeError(`Palette "${name}" color ${index} must be a non-empty string.`);
    }
  }
}

// Effect palettes are views of one color family, so switching the family
// cannot leave countdown or snake carrying colors from the previous one.
export function populatePalettes(paletteFamilies, selectedFamily) {
  if (!paletteFamilies || typeof paletteFamilies !== "object" || Array.isArray(paletteFamilies)) {
    throw new TypeError("Palette families must be an object.");
  }
  for (const [name, palette] of Object.entries(paletteFamilies)) {
    requireFiveColorPalette(name, palette);
  }
  const selected = paletteFamilies[selectedFamily];
  if (selected === undefined) {
    throw new Error(
      `Unknown palette family "${selectedFamily}". Available families: `
      + `${Object.keys(paletteFamilies).join(", ")}.`,
    );
  }
  return {
    ...Object.fromEntries(
      Object.entries(paletteFamilies).map(([name, palette]) => [name, [...palette]]),
    ),
    ...Object.fromEntries(
      Object.entries(PALETTE_VARIANT_STEPS).map(([name, steps]) => [
        name,
        steps.map(step => Number.isInteger(step) ? selected[step] : step),
      ]),
    ),
  };
}
