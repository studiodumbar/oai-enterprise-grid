// Common export frame presets. `resW`/`resH` remain authoritative; the named
// resolution and aspect controls merely calculate new values for those fields.

export const RESOLUTION_PRESETS = Object.freeze({
  "1920x1080": Object.freeze([1920, 1080]),
  "1080x1920": Object.freeze([1080, 1920]),
  "1080x1350": Object.freeze([1080, 1350]),
  "1080x1080": Object.freeze([1080, 1080]),
  "3840x2160": Object.freeze([3840, 2160]),
});

export const LONG_EDGE_PRESETS = Object.freeze({
  "720p": 1280,
  "1080p": 1920,
  "1440p": 2560,
  "4K": 3840,
});

export const ASPECT_RATIO_PRESETS = Object.freeze([
  "16:9",
  "4:3",
  "3:2",
  "1:1",
  "4:5",
  "2:3",
  "9:16",
]);

function positiveFinite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }
  return number;
}

export function parseSize(value) {
  const match = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(String(value));
  if (!match) throw new TypeError(`Bad export size: ${value}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Bad export size: ${value}`);
  }
  return { width, height };
}

export function parseAspectRatio(value) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(
    String(value),
  );
  if (!match) throw new TypeError(`Bad aspect ratio: ${value}`);
  const width = positiveFinite(match[1], "Aspect width");
  const height = positiveFinite(match[2], "Aspect height");
  return { width, height, ratio: width / height };
}

// Compute dimensions whose longer side is fixed to the selected resolution.
export function sizeFromAspect(aspect, longEdge = 1920) {
  const { width: aspectWidth, height: aspectHeight } = parseAspectRatio(aspect);
  const edge = Math.max(1, Math.round(positiveFinite(longEdge, "Long edge")));
  if (aspectWidth >= aspectHeight) {
    return {
      width: edge,
      height: Math.max(1, Math.round(edge * aspectHeight / aspectWidth)),
    };
  }
  return {
    width: Math.max(1, Math.round(edge * aspectWidth / aspectHeight)),
    height: edge,
  };
}

export function sizeFromPresets(resolution, aspect) {
  const longEdge = typeof resolution === "string"
    && Object.hasOwn(LONG_EDGE_PRESETS, resolution)
    ? LONG_EDGE_PRESETS[resolution]
    : resolution;
  return sizeFromAspect(aspect, longEdge);
}

// H.264 and many other encoders require even dimensions. Values are rounded
// down, never up, so a video cannot exceed the authoritative output frame.
export function evenSize({ width, height }) {
  const evenDimension = (value, label) => {
    const integer = Math.floor(positiveFinite(value, label));
    if (integer < 2) throw new RangeError(`${label} must be at least 2 pixels.`);
    return integer - integer % 2;
  };
  return {
    width: evenDimension(width, "Width"),
    height: evenDimension(height, "Height"),
  };
}
