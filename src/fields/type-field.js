// Typography is a reusable service for the flock-grid generator. It owns a
// crisp mask for births/grid coverage and a soft halo for steering forces.
const MASK_SAFE_ZONE_PIXELS = 1;

export class TypeField {
  constructor(p5Instance, options, viewport) {
    this.p = p5Instance;
    this.options = options;
    this.scale = 0.25;
    this.resize(viewport);
  }

  resize({ width, height }) {
    this.mask?.remove();
    this.halo?.remove();

    this.width = width;
    this.height = height;
    this.fieldWidth = Math.max(2, Math.ceil(width * this.scale));
    this.fieldHeight = Math.max(2, Math.ceil(height * this.scale));
    this.mask = this.p.createGraphics(this.fieldWidth, this.fieldHeight);
    this.halo = this.p.createGraphics(this.fieldWidth, this.fieldHeight);
    this.mask.pixelDensity(1);
    this.halo.pixelDensity(1);
    this.rebuild();
  }

  rebuild() {
    this.renderInto(this.mask, false);
    this.renderInto(this.halo, true);
    this.mask.loadPixels();
    this.halo.loadPixels();
    this.buildCoverageIntegral();
    this.collectSpawnPoints();
  }

  buildCoverageIntegral() {
    const stride = this.fieldWidth + 1;
    this.coverageIntegral = new Uint32Array(
      stride * (this.fieldHeight + 1),
    );

    for (let y = 0; y < this.fieldHeight; y += 1) {
      let rowTotal = 0;
      for (let x = 0; x < this.fieldWidth; x += 1) {
        const pixel = (y * this.fieldWidth + x) * 4;
        if (this.mask.pixels[pixel] > 0) rowTotal += 1;
        const output = (y + 1) * stride + x + 1;
        this.coverageIntegral[output] = this.coverageIntegral[output - stride]
          + rowTotal;
      }
    }
  }

  collectSpawnPoints() {
    let count = 0;
    for (let index = 0; index < this.mask.pixels.length; index += 4) {
      if (this.mask.pixels[index] > 96) count += 1;
    }

    this.spawnPoints = new Float32Array(count * 2);
    let output = 0;
    for (let y = 0; y < this.fieldHeight; y += 1) {
      for (let x = 0; x < this.fieldWidth; x += 1) {
        const pixel = (y * this.fieldWidth + x) * 4;
        if (this.mask.pixels[pixel] <= 96) continue;
        this.spawnPoints[output] = (x + 0.5) / this.scale;
        this.spawnPoints[output + 1] = (y + 0.5) / this.scale;
        output += 2;
      }
    }
  }

  spawnPointAt(index) {
    const count = this.spawnPoints.length / 2;
    if (count === 0) return { x: this.width * 0.5, y: this.height * 0.5 };

    const sequence = (index * 0.618033988749895) % 1;
    const point = Math.min(count - 1, Math.floor(sequence * count)) * 2;
    return { x: this.spawnPoints[point], y: this.spawnPoints[point + 1] };
  }

  renderInto(target, blurred) {
    target.background(0);
    const context = target.drawingContext;
    const fontSize = this.options.sizeInCanvasHeights * this.height * this.scale;
    context.save();
    context.fillStyle = "white";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${this.options.weight} ${fontSize}px ${this.options.fontFamily}`;
    if (blurred) {
      context.shadowColor = "white";
      context.shadowBlur = this.options.halo * this.scale;
    }
    // Use the exact scaled canvas centre rather than the rounded-up buffer
    // centre. This keeps the mask aligned for viewport sizes not divisible by
    // the field scale denominator.
    context.fillText(
      this.options.text,
      this.width * this.scale * 0.5,
      this.height * this.scale * 0.5,
    );
    context.restore();
  }

  sample(pixels, x, y) {
    const pixelX = Math.max(
      0,
      Math.min(this.fieldWidth - 1, Math.floor(x * this.scale)),
    );
    const pixelY = Math.max(
      0,
      Math.min(this.fieldHeight - 1, Math.floor(y * this.scale)),
    );
    return pixels[(pixelY * this.fieldWidth + pixelX) * 4] / 255;
  }

  coverageAt(x, y) {
    return this.sample(this.mask.pixels, x, y);
  }

  pulseScaleAt(pulse = 0) {
    const pulseAmount = Math.max(0, Math.min(1, pulse));
    return 1 + pulseAmount * this.options.pulseScale;
  }

  overlapsText(x, y, radius = 0, pulse = 0) {
    if (
      !Number.isFinite(x)
      || !Number.isFinite(y)
      || !Number.isFinite(radius)
      || radius < 0
      || !this.coverageIntegral
    ) return false;

    // Typography pulses with a uniform scale around the canvas centre. Map
    // the dot footprint back into the unscaled mask before querying it.
    const pulseScale = this.pulseScaleAt(pulse);
    const centerX = this.width * 0.5;
    const centerY = this.height * 0.5;
    const maskX = centerX + (x - centerX) / pulseScale;
    const maskY = centerY + (y - centerY) / pulseScale;
    const maskRadius = radius / pulseScale;

    // One low-resolution pixel of padding covers small rasterization
    // differences between the mask font and the full-size canvas font.
    const left = Math.max(
      0,
      Math.floor((maskX - maskRadius) * this.scale) - MASK_SAFE_ZONE_PIXELS,
    );
    const top = Math.max(
      0,
      Math.floor((maskY - maskRadius) * this.scale) - MASK_SAFE_ZONE_PIXELS,
    );
    const right = Math.min(
      this.fieldWidth,
      Math.floor((maskX + maskRadius) * this.scale) + 1 + MASK_SAFE_ZONE_PIXELS,
    );
    const bottom = Math.min(
      this.fieldHeight,
      Math.floor((maskY + maskRadius) * this.scale) + 1 + MASK_SAFE_ZONE_PIXELS,
    );
    if (left >= right || top >= bottom) return false;

    const stride = this.fieldWidth + 1;
    const covered = this.coverageIntegral[bottom * stride + right]
      - this.coverageIntegral[top * stride + right]
      - this.coverageIntegral[bottom * stride + left]
      + this.coverageIntegral[top * stride + left];
    return covered > 0;
  }

  forceAt(x, y, output = { x: 0, y: 0 }) {
    const step = 4 / this.scale;
    const gradientX = this.sample(this.halo.pixels, x + step, y)
      - this.sample(this.halo.pixels, x - step, y);
    const gradientY = this.sample(this.halo.pixels, x, y + step)
      - this.sample(this.halo.pixels, x, y - step);
    const inside = this.coverageAt(x, y);
    let forceX = -gradientX;
    let forceY = -gradientY;

    if (inside > 0.2 && Math.abs(forceX) + Math.abs(forceY) < 0.01) {
      forceX = x - this.width * 0.5;
      forceY = y - this.height * 0.5;
    }

    const magnitude = Math.hypot(forceX, forceY);
    if (magnitude < 1e-5) {
      output.x = 0;
      output.y = 0;
      return output;
    }

    const strength = this.options.flockAvoidance
      * Math.max(inside, Math.min(1, magnitude * 3));
    output.x = forceX / magnitude * strength;
    output.y = forceY / magnitude * strength;
    return output;
  }

  draw(context, colorValue, pulse = 0) {
    const pulseAmount = Math.max(0, Math.min(1, pulse));
    const pulseScale = this.pulseScaleAt(pulseAmount);
    const inheritedAlpha = context.globalAlpha;
    context.save();
    context.translate(this.width * 0.5, this.height * 0.5);
    context.scale(pulseScale, pulseScale);
    context.globalAlpha = inheritedAlpha * (
      this.options.restingOpacity
      + (1 - this.options.restingOpacity) * pulseAmount
    );
    context.fillStyle = colorValue;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${this.options.weight} ${this.options.sizeInCanvasHeights * this.height}px ${this.options.fontFamily}`;
    context.fillText(this.options.text, 0, 0);
    context.restore();
  }

  dispose() {
    this.mask?.remove();
    this.halo?.remove();
    this.mask = null;
    this.halo = null;
    this.coverageIntegral = new Uint32Array(0);
    this.spawnPoints = new Float32Array(0);
  }
}
