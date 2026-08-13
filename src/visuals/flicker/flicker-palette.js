// Palette mapping shared by every flicker mode. A mode only produces a
// normalized 0..1 sample; turning that sample into one of the composition's
// discrete swatches happens here, so colors still snap to the palette and never
// ease between values regardless of which mode is active.
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
}

function parsePalette(palette) {
  if (!Array.isArray(palette) || palette.length === 0) {
    throw new TypeError("Flicker requires a non-empty palette.");
  }

  return palette.map(color => {
    if (typeof color !== "string" || !/^#[\da-f]{6}$/i.test(color)) {
      throw new TypeError(
        `Flicker palette colors must use six-digit hex values; received "${color}".`,
      );
    }
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    return `rgb(${red} ${green} ${blue})`;
  });
}

export class FlickerPalette {
  constructor(palette) {
    this.paletteColors = parsePalette(palette);
  }

  baseColorAt(normalizedPosition) {
    requireFinite(normalizedPosition, "normalizedPosition");
    const lastIndex = this.paletteColors.length - 1;
    return this.paletteColors[Math.round(clamp01(normalizedPosition) * lastIndex)];
  }

  // Blend the base position toward a target position by `amount`, then snap to
  // the nearest swatch.
  paletteIndexFromSample(basePosition, sample, amount) {
    requireFinite(basePosition, "basePosition");
    requireFinite(sample, "sample");
    requireFinite(amount, "amount");
    const position = basePosition
      + (clamp01(sample) - basePosition) * clamp01(amount);
    return Math.round(clamp01(position) * (this.paletteColors.length - 1));
  }

  colorFromSample(basePosition, sample, amount) {
    return this.paletteColors[
      this.paletteIndexFromSample(basePosition, sample, amount)
    ];
  }

  // Bands the sample so a continuous field still lands on whole swatches and
  // revisits each of them, rather than hovering around the palette midpoint.
  paletteIndexFromNoise(basePosition, sample, amount) {
    requireFinite(sample, "sample");
    const paletteCount = this.paletteColors.length;
    const bandCount = paletteCount * 3 + 1;
    const bandIndex = Math.min(
      bandCount - 1,
      Math.floor(clamp01(sample) * bandCount),
    );
    const targetIndex = bandIndex % paletteCount;
    const targetPosition = targetIndex / Math.max(1, paletteCount - 1);
    return this.paletteIndexFromSample(basePosition, targetPosition, amount);
  }

  colorFromNoise(basePosition, sample, amount) {
    return this.paletteColors[
      this.paletteIndexFromNoise(basePosition, sample, amount)
    ];
  }
}

export default FlickerPalette;
