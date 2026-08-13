const TAU = Math.PI * 2;
const QUARTER_TURN = Math.PI / 2;
const KAPPA = 4 * (Math.SQRT2 - 1) / 3;
const POINT_EPSILON = 1e-9;

const IDENTITY_MATRIX = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
});

const VALID_TEXT_ALIGN = new Set(["start", "end", "left", "right", "center"]);
const VALID_TEXT_BASELINE = new Set([
  "top",
  "hanging",
  "middle",
  "alphabetic",
  "ideographic",
  "bottom",
]);
const VALID_LINE_CAP = new Set(["butt", "round", "square"]);
const VALID_LINE_JOIN = new Set(["round", "bevel", "miter"]);

function cloneMatrix(matrix) {
  return { ...matrix };
}

function multiplyMatrices(left, right) {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function transformPoint(matrix, x, y) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function finiteArguments(...values) {
  return values.every(isFiniteNumber);
}

function formatNumber(value) {
  const rounded = Math.abs(value) < 5e-10 ? 0 : Number(value.toFixed(6));
  return String(rounded);
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function samePoint(left, right) {
  return left !== null
    && right !== null
    && Math.abs(left.x - right.x) <= POINT_EPSILON
    && Math.abs(left.y - right.y) <= POINT_EPSILON;
}

function pathData(commands) {
  return commands.map(command => {
    switch (command.type) {
      case "M":
      case "L":
        return `${command.type}${formatNumber(command.x)} ${formatNumber(command.y)}`;
      case "Q":
        return `Q${formatNumber(command.cpx)} ${formatNumber(command.cpy)} ${formatNumber(command.x)} ${formatNumber(command.y)}`;
      case "C":
        return `C${formatNumber(command.cp1x)} ${formatNumber(command.cp1y)} ${formatNumber(command.cp2x)} ${formatNumber(command.cp2y)} ${formatNumber(command.x)} ${formatNumber(command.y)}`;
      case "Z":
        return "Z";
      default:
        throw new Error(`Unknown recorded path command "${command.type}".`);
    }
  }).join(" ");
}

function normalizedFillRule(value) {
  const rule = value ?? "nonzero";
  if (rule !== "nonzero" && rule !== "evenodd") {
    throw new TypeError(`Unsupported fill rule "${rule}".`);
  }
  return rule;
}

function normalizedArcSweep(startAngle, endAngle, counterclockwise) {
  const rawSweep = endAngle - startAngle;
  if (!counterclockwise) {
    if (rawSweep >= TAU) return TAU;
    const sweep = ((rawSweep % TAU) + TAU) % TAU;
    return Math.abs(sweep - TAU) < POINT_EPSILON ? 0 : sweep;
  }

  if (-rawSweep >= TAU) return -TAU;
  const clockwiseSweep = ((rawSweep % TAU) + TAU) % TAU;
  if (clockwiseSweep < POINT_EPSILON || Math.abs(clockwiseSweep - TAU) < POINT_EPSILON) {
    return 0;
  }
  return clockwiseSweep - TAU;
}

function radiusPoint(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new RangeError("Round-rect radii must be finite and non-negative.");
    return { x: value, y: value };
  }

  if (value && typeof value === "object") {
    const x = Number(value.x);
    const y = Number(value.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      throw new RangeError("Round-rect radii must be finite and non-negative.");
    }
    return { x, y };
  }

  throw new TypeError("A round-rect radius must be a number or an {x, y} point.");
}

function expandedRadii(radii) {
  let values;
  if (Array.isArray(radii)) {
    values = radii;
  } else if (
    radii
    && typeof radii !== "string"
    && typeof radii !== "number"
    && typeof radii[Symbol.iterator] === "function"
    && !("x" in radii && "y" in radii)
  ) {
    values = [...radii];
  } else {
    values = [radii];
  }

  if (values.length < 1 || values.length > 4) {
    throw new RangeError("roundRect() requires between one and four radii.");
  }

  const parsed = values.map(radiusPoint);
  if (parsed.length === 1) return [parsed[0], parsed[0], parsed[0], parsed[0]].map(value => ({ ...value }));
  if (parsed.length === 2) return [parsed[0], parsed[1], parsed[0], parsed[1]].map(value => ({ ...value }));
  if (parsed.length === 3) return [parsed[0], parsed[1], parsed[2], parsed[1]].map(value => ({ ...value }));
  return parsed.map(value => ({ ...value }));
}

function fittedRadii(radii, width, height) {
  const [topLeft, topRight, bottomRight, bottomLeft] = radii;
  const factors = [1];
  const addFactor = (size, sum) => {
    if (sum > 0) factors.push(size / sum);
  };

  addFactor(width, topLeft.x + topRight.x);
  addFactor(width, bottomLeft.x + bottomRight.x);
  addFactor(height, topLeft.y + bottomLeft.y);
  addFactor(height, topRight.y + bottomRight.y);
  const factor = Math.min(...factors);
  return radii.map(radius => ({
    x: radius.x * factor,
    y: radius.y * factor,
  }));
}

function isIdentity(matrix) {
  return matrix.a === 1
    && matrix.b === 0
    && matrix.c === 0
    && matrix.d === 1
    && matrix.e === 0
    && matrix.f === 0;
}

function matrixAttribute(matrix) {
  return `matrix(${[
    matrix.a,
    matrix.b,
    matrix.c,
    matrix.d,
    matrix.e,
    matrix.f,
  ].map(formatNumber).join(" ")})`;
}

function cloneState(state) {
  return {
    ...state,
    transform: cloneMatrix(state.transform),
    clips: [...state.clips],
  };
}

function initialState() {
  return {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    transform: cloneMatrix(IDENTITY_MATRIX),
    clips: [],
  };
}

function positiveDimension(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

/**
 * A small CanvasRenderingContext2D-compatible recorder for this application's
 * vector drawing operations. Path coordinates are transformed when each path
 * command is issued, matching Canvas2D and allowing one compound path to hold
 * subpaths constructed under different transforms.
 */
export class SVGRecordingContext {
  constructor(width = 300, height = 150) {
    if (width && typeof width === "object") {
      height = width.height ?? 150;
      width = width.width ?? 300;
    }

    this.canvas = {
      width: positiveDimension(width, 300),
      height: positiveDimension(height, 150),
    };
    this._state = initialState();
    this._stack = [];
    this._commands = [];
    this._currentPoint = null;
    this._subpathStart = null;
    this._elements = [];
    this._clipDefinitions = [];
  }

  get width() {
    return this.canvas.width;
  }

  get height() {
    return this.canvas.height;
  }

  get fillStyle() {
    return this._state.fillStyle;
  }

  set fillStyle(value) {
    if (typeof value === "string" && value.length > 0) this._state.fillStyle = value;
  }

  get strokeStyle() {
    return this._state.strokeStyle;
  }

  set strokeStyle(value) {
    if (typeof value === "string" && value.length > 0) this._state.strokeStyle = value;
  }

  get globalAlpha() {
    return this._state.globalAlpha;
  }

  set globalAlpha(value) {
    const alpha = Number(value);
    if (Number.isFinite(alpha) && alpha >= 0 && alpha <= 1) this._state.globalAlpha = alpha;
  }

  get lineWidth() {
    return this._state.lineWidth;
  }

  set lineWidth(value) {
    const width = Number(value);
    if (Number.isFinite(width) && width > 0) this._state.lineWidth = width;
  }

  get lineCap() {
    return this._state.lineCap;
  }

  set lineCap(value) {
    if (VALID_LINE_CAP.has(value)) this._state.lineCap = value;
  }

  get lineJoin() {
    return this._state.lineJoin;
  }

  set lineJoin(value) {
    if (VALID_LINE_JOIN.has(value)) this._state.lineJoin = value;
  }

  get miterLimit() {
    return this._state.miterLimit;
  }

  set miterLimit(value) {
    const limit = Number(value);
    if (Number.isFinite(limit) && limit > 0) this._state.miterLimit = limit;
  }

  get font() {
    return this._state.font;
  }

  set font(value) {
    if (typeof value === "string" && value.trim().length > 0) this._state.font = value;
  }

  get textAlign() {
    return this._state.textAlign;
  }

  set textAlign(value) {
    if (VALID_TEXT_ALIGN.has(value)) this._state.textAlign = value;
  }

  get textBaseline() {
    return this._state.textBaseline;
  }

  set textBaseline(value) {
    if (VALID_TEXT_BASELINE.has(value)) this._state.textBaseline = value;
  }

  save() {
    this._stack.push(cloneState(this._state));
  }

  restore() {
    const restored = this._stack.pop();
    if (restored) this._state = restored;
  }

  translate(x, y) {
    if (!finiteArguments(x, y)) return;
    this.transform(1, 0, 0, 1, Number(x), Number(y));
  }

  scale(x, y = x) {
    if (!finiteArguments(x, y)) return;
    this.transform(Number(x), 0, 0, Number(y), 0, 0);
  }

  rotate(angle) {
    if (!isFiniteNumber(angle)) return;
    const cosine = Math.cos(Number(angle));
    const sine = Math.sin(Number(angle));
    this.transform(cosine, sine, -sine, cosine, 0, 0);
  }

  transform(a, b, c, d, e, f) {
    if (!finiteArguments(a, b, c, d, e, f)) return;
    this._state.transform = multiplyMatrices(this._state.transform, {
      a: Number(a),
      b: Number(b),
      c: Number(c),
      d: Number(d),
      e: Number(e),
      f: Number(f),
    });
  }

  setTransform(a, b, c, d, e, f) {
    let matrix;
    if (a && typeof a === "object") {
      matrix = {
        a: Number(a.a ?? a.m11 ?? 1),
        b: Number(a.b ?? a.m12 ?? 0),
        c: Number(a.c ?? a.m21 ?? 0),
        d: Number(a.d ?? a.m22 ?? 1),
        e: Number(a.e ?? a.m41 ?? 0),
        f: Number(a.f ?? a.m42 ?? 0),
      };
    } else {
      matrix = {
        a: Number(a),
        b: Number(b),
        c: Number(c),
        d: Number(d),
        e: Number(e),
        f: Number(f),
      };
    }

    if (!finiteArguments(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f)) return;
    this._state.transform = matrix;
  }

  resetTransform() {
    this._state.transform = cloneMatrix(IDENTITY_MATRIX);
  }

  getTransform() {
    return {
      ...this._state.transform,
      is2D: true,
      toString() {
        return matrixAttribute(this);
      },
    };
  }

  beginPath() {
    this._commands = [];
    this._currentPoint = null;
    this._subpathStart = null;
  }

  moveTo(x, y) {
    if (!finiteArguments(x, y)) return;
    const point = transformPoint(this._state.transform, Number(x), Number(y));
    this._moveToPoint(point);
  }

  lineTo(x, y) {
    if (!finiteArguments(x, y)) return;
    const point = transformPoint(this._state.transform, Number(x), Number(y));
    this._lineToPoint(point);
  }

  quadraticCurveTo(cpx, cpy, x, y) {
    if (!finiteArguments(cpx, cpy, x, y)) return;
    const control = transformPoint(this._state.transform, Number(cpx), Number(cpy));
    const point = transformPoint(this._state.transform, Number(x), Number(y));
    if (this._currentPoint === null) this._moveToPoint(control);
    this._commands.push({
      type: "Q",
      cpx: control.x,
      cpy: control.y,
      x: point.x,
      y: point.y,
    });
    this._currentPoint = point;
  }

  bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
    if (!finiteArguments(cp1x, cp1y, cp2x, cp2y, x, y)) return;
    const cp1 = transformPoint(this._state.transform, Number(cp1x), Number(cp1y));
    const cp2 = transformPoint(this._state.transform, Number(cp2x), Number(cp2y));
    const point = transformPoint(this._state.transform, Number(x), Number(y));
    if (this._currentPoint === null) this._moveToPoint(cp1);
    this._cubicToPoints(cp1, cp2, point);
  }

  closePath() {
    if (this._subpathStart === null || this._currentPoint === null) return;
    this._commands.push({ type: "Z" });
    this._currentPoint = { ...this._subpathStart };
  }

  rect(x, y, width, height) {
    if (!finiteArguments(x, y, width, height)) return;
    const numericX = Number(x);
    const numericY = Number(y);
    const numericWidth = Number(width);
    const numericHeight = Number(height);
    const matrix = this._state.transform;
    const points = [
      transformPoint(matrix, numericX, numericY),
      transformPoint(matrix, numericX + numericWidth, numericY),
      transformPoint(matrix, numericX + numericWidth, numericY + numericHeight),
      transformPoint(matrix, numericX, numericY + numericHeight),
    ];
    this._moveToPoint(points[0]);
    this._lineToPoint(points[1]);
    this._lineToPoint(points[2]);
    this._lineToPoint(points[3]);
    this.closePath();
  }

  roundRect(x, y, width, height, radii = 0) {
    if (!finiteArguments(x, y, width, height)) return;
    const numericX = Number(x);
    const numericY = Number(y);
    const numericWidth = Number(width);
    const numericHeight = Number(height);
    let corners = expandedRadii(radii);

    if (numericWidth < 0) {
      corners = [corners[1], corners[0], corners[3], corners[2]];
    }
    if (numericHeight < 0) {
      corners = [corners[3], corners[2], corners[1], corners[0]];
    }

    const left = Math.min(numericX, numericX + numericWidth);
    const right = Math.max(numericX, numericX + numericWidth);
    const top = Math.min(numericY, numericY + numericHeight);
    const bottom = Math.max(numericY, numericY + numericHeight);
    const [topLeft, topRight, bottomRight, bottomLeft] = fittedRadii(
      corners,
      right - left,
      bottom - top,
    );

    if ([topLeft, topRight, bottomRight, bottomLeft].every(
      radius => radius.x === 0 && radius.y === 0,
    )) {
      this.rect(numericX, numericY, numericWidth, numericHeight);
      return;
    }

    const matrix = this._state.transform;
    const localPoint = (pointX, pointY) => transformPoint(matrix, pointX, pointY);
    this._moveToPoint(localPoint(left + topLeft.x, top));
    this._lineToPoint(localPoint(right - topRight.x, top));
    this._roundedCorner(
      localPoint(right - topRight.x, top),
      localPoint(right - topRight.x + topRight.x * KAPPA, top),
      localPoint(right, top + topRight.y - topRight.y * KAPPA),
      localPoint(right, top + topRight.y),
    );
    this._lineToPoint(localPoint(right, bottom - bottomRight.y));
    this._roundedCorner(
      localPoint(right, bottom - bottomRight.y),
      localPoint(right, bottom - bottomRight.y + bottomRight.y * KAPPA),
      localPoint(right - bottomRight.x + bottomRight.x * KAPPA, bottom),
      localPoint(right - bottomRight.x, bottom),
    );
    this._lineToPoint(localPoint(left + bottomLeft.x, bottom));
    this._roundedCorner(
      localPoint(left + bottomLeft.x, bottom),
      localPoint(left + bottomLeft.x - bottomLeft.x * KAPPA, bottom),
      localPoint(left, bottom - bottomLeft.y + bottomLeft.y * KAPPA),
      localPoint(left, bottom - bottomLeft.y),
    );
    this._lineToPoint(localPoint(left, top + topLeft.y));
    this._roundedCorner(
      localPoint(left, top + topLeft.y),
      localPoint(left, top + topLeft.y - topLeft.y * KAPPA),
      localPoint(left + topLeft.x - topLeft.x * KAPPA, top),
      localPoint(left + topLeft.x, top),
    );
    this.closePath();
  }

  arc(x, y, radius, startAngle, endAngle, counterclockwise = false) {
    if (!finiteArguments(x, y, radius, startAngle, endAngle)) return;
    const numericRadius = Number(radius);
    if (numericRadius < 0) throw new RangeError("arc() radius must be non-negative.");

    const centerX = Number(x);
    const centerY = Number(y);
    const start = Number(startAngle);
    const sweep = normalizedArcSweep(start, Number(endAngle), Boolean(counterclockwise));
    const matrix = this._state.transform;
    const localPoint = angle => transformPoint(
      matrix,
      centerX + Math.cos(angle) * numericRadius,
      centerY + Math.sin(angle) * numericRadius,
    );
    const startPoint = localPoint(start);
    if (this._currentPoint === null) this._moveToPoint(startPoint);
    else if (!samePoint(this._currentPoint, startPoint)) this._lineToPoint(startPoint);

    if (numericRadius === 0 || Math.abs(sweep) < POINT_EPSILON) return;
    const segmentCount = Math.max(1, Math.ceil(Math.abs(sweep) / QUARTER_TURN));
    const segmentSweep = sweep / segmentCount;
    let angle = start;

    for (let index = 0; index < segmentCount; index += 1) {
      const nextAngle = angle + segmentSweep;
      const tangentScale = 4 / 3 * Math.tan(segmentSweep / 4) * numericRadius;
      const cp1 = transformPoint(
        matrix,
        centerX + Math.cos(angle) * numericRadius - Math.sin(angle) * tangentScale,
        centerY + Math.sin(angle) * numericRadius + Math.cos(angle) * tangentScale,
      );
      const cp2 = transformPoint(
        matrix,
        centerX + Math.cos(nextAngle) * numericRadius + Math.sin(nextAngle) * tangentScale,
        centerY + Math.sin(nextAngle) * numericRadius - Math.cos(nextAngle) * tangentScale,
      );
      const endPoint = localPoint(nextAngle);
      this._cubicToPoints(cp1, cp2, endPoint);
      angle = nextAngle;
    }
  }

  fill(fillRule = "nonzero") {
    if (this._commands.length === 0) return;
    const rule = normalizedFillRule(fillRule);
    const attributes = [
      `d="${pathData(this._commands)}"`,
      `fill="${escapeAttribute(this._state.fillStyle)}"`,
      `fill-rule="${rule}"`,
      'stroke="none"',
    ];
    if (this._state.globalAlpha !== 1) {
      attributes.push(`fill-opacity="${formatNumber(this._state.globalAlpha)}"`);
    }
    this._recordElement(`<path ${attributes.join(" ")}/>`);
  }

  stroke() {
    if (this._commands.length === 0) return;
    this._recordElement(`<path ${this._strokeAttributes(pathData(this._commands)).join(" ")}/>`);
  }

  fillRect(x, y, width, height) {
    if (!finiteArguments(x, y, width, height) || Number(width) === 0 || Number(height) === 0) return;
    const commands = this._rectangleCommands(Number(x), Number(y), Number(width), Number(height));
    const attributes = [
      `d="${pathData(commands)}"`,
      `fill="${escapeAttribute(this._state.fillStyle)}"`,
      'fill-rule="nonzero"',
      'stroke="none"',
    ];
    if (this._state.globalAlpha !== 1) {
      attributes.push(`fill-opacity="${formatNumber(this._state.globalAlpha)}"`);
    }
    this._recordElement(`<path ${attributes.join(" ")}/>`);
  }

  strokeRect(x, y, width, height) {
    if (!finiteArguments(x, y, width, height)) return;
    const commands = this._rectangleCommands(Number(x), Number(y), Number(width), Number(height));
    this._recordElement(`<path ${this._strokeAttributes(pathData(commands)).join(" ")}/>`);
  }

  clip(fillRule = "nonzero") {
    const rule = normalizedFillRule(fillRule);
    const id = `svg-clip-${this._clipDefinitions.length + 1}`;
    this._clipDefinitions.push({
      id,
      d: pathData(this._commands),
      rule,
    });
    this._state.clips.push(id);
  }

  fillText(text, x, y, maxWidth) {
    if (!finiteArguments(x, y)) return;
    const attributes = [
      `x="${formatNumber(Number(x))}"`,
      `y="${formatNumber(Number(y))}"`,
      `fill="${escapeAttribute(this._state.fillStyle)}"`,
      `text-anchor="${this._textAnchor()}"`,
      `dominant-baseline="${this._dominantBaseline()}"`,
      `style="font: ${escapeAttribute(this._state.font)}"`,
      'xml:space="preserve"',
    ];
    if (this._state.globalAlpha !== 1) {
      attributes.push(`fill-opacity="${formatNumber(this._state.globalAlpha)}"`);
    }
    if (!isIdentity(this._state.transform)) {
      attributes.push(`transform="${matrixAttribute(this._state.transform)}"`);
    }
    if (isFiniteNumber(maxWidth) && Number(maxWidth) > 0) {
      attributes.push(`textLength="${formatNumber(Number(maxWidth))}"`, 'lengthAdjust="spacingAndGlyphs"');
    }
    this._recordElement(`<text ${attributes.join(" ")}>${escapeText(text)}</text>`);
  }

  toSVG(options = {}) {
    const outputWidth = positiveDimension(options.width, this.canvas.width);
    const outputHeight = positiveDimension(options.height, this.canvas.height);
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(outputWidth)}" height="${formatNumber(outputHeight)}" viewBox="0 0 ${formatNumber(outputWidth)} ${formatNumber(outputHeight)}" overflow="visible">`,
    ];

    const metadata = this._metadataMarkup(options.metadata, options.metadataId);
    if (metadata) lines.push(`  ${metadata}`);

    if (this._clipDefinitions.length > 0) {
      lines.push("  <defs>");
      for (const clip of this._clipDefinitions) {
        lines.push(
          `    <clipPath id="${clip.id}" clipPathUnits="userSpaceOnUse"><path d="${clip.d}" fill-rule="${clip.rule}" clip-rule="${clip.rule}"/></clipPath>`,
        );
      }
      lines.push("  </defs>");
    }

    for (const element of this._elements) {
      lines.push(`  ${this._elementWithClips(element)}`);
    }
    lines.push("</svg>");
    return lines.join("\n");
  }

  serialize(options = {}) {
    return this.toSVG(options);
  }

  toString() {
    return this.toSVG();
  }

  _moveToPoint(point) {
    this._commands.push({ type: "M", x: point.x, y: point.y });
    this._currentPoint = point;
    this._subpathStart = point;
  }

  _lineToPoint(point) {
    if (this._currentPoint === null) {
      this._moveToPoint(point);
      return;
    }
    this._commands.push({ type: "L", x: point.x, y: point.y });
    this._currentPoint = point;
  }

  _cubicToPoints(cp1, cp2, point) {
    this._commands.push({
      type: "C",
      cp1x: cp1.x,
      cp1y: cp1.y,
      cp2x: cp2.x,
      cp2y: cp2.y,
      x: point.x,
      y: point.y,
    });
    this._currentPoint = point;
  }

  _roundedCorner(start, cp1, cp2, end) {
    if (samePoint(start, end)) return;
    if (samePoint(start, cp1) && samePoint(cp2, end)) {
      this._lineToPoint(end);
      return;
    }
    this._cubicToPoints(cp1, cp2, end);
  }

  _rectangleCommands(x, y, width, height) {
    const matrix = this._state.transform;
    const points = [
      transformPoint(matrix, x, y),
      transformPoint(matrix, x + width, y),
      transformPoint(matrix, x + width, y + height),
      transformPoint(matrix, x, y + height),
    ];
    return [
      { type: "M", ...points[0] },
      { type: "L", ...points[1] },
      { type: "L", ...points[2] },
      { type: "L", ...points[3] },
      { type: "Z" },
    ];
  }

  _strokeAttributes(d) {
    const attributes = [
      `d="${d}"`,
      'fill="none"',
      `stroke="${escapeAttribute(this._state.strokeStyle)}"`,
      `stroke-width="${formatNumber(this._state.lineWidth)}"`,
      `stroke-linecap="${this._state.lineCap}"`,
      `stroke-linejoin="${this._state.lineJoin}"`,
      `stroke-miterlimit="${formatNumber(this._state.miterLimit)}"`,
    ];
    if (this._state.globalAlpha !== 1) {
      attributes.push(`stroke-opacity="${formatNumber(this._state.globalAlpha)}"`);
    }
    return attributes;
  }

  _recordElement(markup) {
    this._elements.push({
      markup,
      clips: [...this._state.clips],
    });
  }

  _elementWithClips(element) {
    let markup = element.markup;
    for (let index = element.clips.length - 1; index >= 0; index -= 1) {
      markup = `<g clip-path="url(#${element.clips[index]})">${markup}</g>`;
    }
    return markup;
  }

  _textAnchor() {
    if (this._state.textAlign === "center") return "middle";
    if (this._state.textAlign === "right" || this._state.textAlign === "end") return "end";
    return "start";
  }

  _dominantBaseline() {
    switch (this._state.textBaseline) {
      case "top": return "text-before-edge";
      case "hanging": return "hanging";
      case "middle": return "central";
      case "ideographic": return "ideographic";
      case "bottom": return "text-after-edge";
      default: return "alphabetic";
    }
  }

  _metadataMarkup(metadata, metadataId = "circle-grid-params") {
    if (metadata === undefined || metadata === null || metadata === false) return "";
    let id = metadataId;
    let content = metadata;
    if (metadata && typeof metadata === "object") {
      if (Object.hasOwn(metadata, "content") || Object.hasOwn(metadata, "text")) {
        id = metadata.id ?? metadataId;
        content = metadata.content ?? metadata.text ?? "";
      } else {
        content = JSON.stringify(metadata);
      }
    }
    return `<metadata id="${escapeAttribute(id)}">${escapeText(content)}</metadata>`;
  }
}

export const SvgRecordingContext = SVGRecordingContext;

export function createSvgRecordingContext(width, height) {
  return new SVGRecordingContext(width, height);
}

export default SVGRecordingContext;
