function finitePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`);
  }
  return number;
}

export function containFit(sourceBounds, outputWidth, outputHeight) {
  const x = Number(sourceBounds?.x ?? 0);
  const y = Number(sourceBounds?.y ?? 0);
  const width = finitePositive(sourceBounds?.width, "Source width");
  const height = finitePositive(sourceBounds?.height, "Source height");
  const outW = finitePositive(outputWidth, "Output width");
  const outH = finitePositive(outputHeight, "Output height");
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError("Source origin must be finite.");
  }
  const scale = Math.min(outW / width, outH / height);
  const fittedWidth = width * scale;
  const fittedHeight = height * scale;
  const dx = (outW - fittedWidth) * 0.5 - x * scale;
  const dy = (outH - fittedHeight) * 0.5 - y * scale;
  return {
    scale,
    dx,
    dy,
    width: fittedWidth,
    height: fittedHeight,
  };
}

export function withContainTransform(context, sourceBounds, outputWidth, outputHeight, draw) {
  const fit = containFit(sourceBounds, outputWidth, outputHeight);
  context.save();
  try {
    context.translate(fit.dx, fit.dy);
    context.scale(fit.scale, fit.scale);
    return draw(fit);
  } finally {
    context.restore();
  }
}

