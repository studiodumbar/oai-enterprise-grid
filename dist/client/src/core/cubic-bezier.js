export const DEFAULT_CUBIC_BEZIER_CURVE = Object.freeze([0.42, 0, 0.58, 1]);

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function cubicCoordinate(t, firstControl, secondControl) {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * firstControl
    + 3 * inverse * t * t * secondControl
    + t * t * t;
}

function cubicDerivative(t, firstControl, secondControl) {
  const inverse = 1 - t;
  return 3 * inverse * inverse * firstControl
    + 6 * inverse * t * (secondControl - firstControl)
    + 3 * t * t * (1 - secondControl);
}

export function normalizeBezierCurve(curve, label = "Bezier curve") {
  if (!Array.isArray(curve) || curve.length !== 4) {
    throw new TypeError(`${label} must be an array of four numbers.`);
  }
  const values = curve.map(Number);
  if (!values.every(Number.isFinite)) {
    throw new TypeError(`${label} values must be finite numbers.`);
  }
  if (values[0] < 0 || values[0] > 1 || values[2] < 0 || values[2] > 1) {
    throw new RangeError(`${label} X control points must be between 0 and 1.`);
  }
  return values;
}

/** CSS-style cubic-bezier evaluation: solve X, then sample Y. */
export function cubicBezierAt(
  progress,
  curve = DEFAULT_CUBIC_BEZIER_CURVE,
) {
  const x = clamp01(Number(progress) || 0);
  const [x1, y1, x2, y2] = normalizeBezierCurve(curve);
  if (x === 0 || x === 1) return x;
  let parameter = x;
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const difference = cubicCoordinate(parameter, x1, x2) - x;
    const derivative = cubicDerivative(parameter, x1, x2);
    if (Math.abs(difference) < 1e-7 || Math.abs(derivative) < 1e-7) break;
    parameter = clamp01(parameter - difference / derivative);
  }

  if (Math.abs(cubicCoordinate(parameter, x1, x2) - x) > 1e-6) {
    let lower = 0;
    let upper = 1;
    for (let iteration = 0; iteration < 20; iteration += 1) {
      parameter = (lower + upper) * 0.5;
      if (cubicCoordinate(parameter, x1, x2) < x) lower = parameter;
      else upper = parameter;
    }
  }

  return cubicCoordinate(parameter, y1, y2);
}
