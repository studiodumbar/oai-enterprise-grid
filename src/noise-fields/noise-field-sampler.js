import { debug } from "../debug/index.js";

const LAYERS = Object.freeze(["size", "color", "contrast", "visibility"]);
const RESOLUTION = Object.freeze({ size: 4, color: 1, contrast: 16, visibility: 16 });
const TWO32 = 4294967296;

function clamp01(value) { return Math.max(0, Math.min(1, value)); }
function quantize(value) { return Math.round(clamp01(value) * 255); }
function curve(value, contrast) {
  const v = clamp01((value - 0.5) * contrast + 0.5);
  return v * v * (3 - 2 * v);
}

function reduce2x(source, width, height) {
  const nextWidth = width >> 1;
  const nextHeight = height >> 1;
  const target = new Uint8Array(nextWidth * nextHeight);
  for (let y = 0; y < nextHeight; y += 1) {
    for (let x = 0; x < nextWidth; x += 1) {
      const at = (y * 2) * width + x * 2;
      target[y * nextWidth + x] = Math.round((
        source[at] + source[at + 1] + source[at + width] + source[at + width + 1]
      ) / 4);
    }
  }
  return { data: target, width: nextWidth, height: nextHeight };
}

function pyramid(finest, width, height) {
  const levels = [{ data: finest, width, height, subdivisions: 16 }];
  while (levels.at(-1).subdivisions > 1) {
    const current = levels.at(-1);
    const reduced = reduce2x(current.data, current.width, current.height);
    levels.push({ ...reduced, subdivisions: current.subdivisions >> 1 });
  }
  return levels;
}

export class NoiseFieldSampler {
  constructor({ modeRegistry, shaderFactory = null } = {}) {
    if (!modeRegistry) throw new TypeError("NoiseFieldSampler requires a mode registry.");
    this.modeRegistry = modeRegistry;
    this.shaderFactory = shaderFactory;
    this.reportedBackend = null;
  }

  sample({ layout, progress, timeSeconds = 0, projectSeed, settings, backend = "auto" }) {
    if (!['auto', 'cpu', 'shader'].includes(backend)) {
      throw new Error(`Unknown noise backend "${backend}". Available backends: auto, cpu, shader.`);
    }
    let selected = backend;
    if (backend !== 'cpu') {
      try {
        if (!this.shaderFactory) throw new Error("WebGL2 is unavailable");
        return this.shaderFactory.sample({ layout, progress, timeSeconds, projectSeed, settings });
      } catch (error) {
        if (backend === 'shader') throw new Error(`Noise shader backend failed: ${error.message}`);
        selected = 'cpu';
        this.reportBackend('cpu', `fallback=${error.message}`);
      }
    }
    if (this.reportedBackend === null) this.reportBackend(selected, 'requested=' + backend);
    return this.sampleCpu({ layout, progress, timeSeconds, projectSeed, settings });
  }

  reportBackend(backend, reason) {
    if (this.reportedBackend !== null) return;
    this.reportedBackend = `${backend}:${reason}`;
    debug.config("noise-backend=%s %s", backend, reason);
  }

  samplePlane({ name, width, height, progress, timeSeconds, projectSeed, settings }) {
    const layer = settings.layers[name];
    const effectiveSeedBase = Math.fround((Number(projectSeed) >>> 0) / TWO32);
    const effectiveSeed = Math.fround(layer.seed + effectiveSeedBase);
    const loopPeriod = layer.cyclesPerLoop === 0 ? null : Math.abs(layer.cyclesPerLoop);
    const mode = this.modeRegistry.get(layer.mode);
    const field = mode.createField({ settings: layer.modes[layer.mode], loopPeriod, seed: effectiveSeed });
    const layerProgress = ((progress % 1) + 1) % 1;
    const direction = Math.sign(layer.cyclesPerLoop);
    const z = layer.speed !== null
      ? layer.speed * Math.max(0, timeSeconds) + effectiveSeed * 0.173
      : direction * layerProgress * Math.abs(layer.cyclesPerLoop)
      + effectiveSeed * 0.173;
    const output = new Uint8Array(width * height);
    const aspect = width / Math.max(1, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const px = ((x + 0.5) / width - 0.5) * aspect;
        const py = 0.5 - (y + 0.5) / height;
        const sx = px * layer.scale + effectiveSeed * 1.371;
        const sy = py * layer.scale + effectiveSeed * 2.113;
        output[y * width + x] = quantize(curve(field.sampleAt(sx, sy, z), layer.contrast));
      }
    }
    return { data: output, width, height };
  }

  samplePreview({ width, height, progress, timeSeconds = 0, projectSeed, settings }) {
    const previewWidth = Math.max(2, Math.trunc(width));
    const previewHeight = Math.max(2, Math.trunc(height));
    return {
      size: this.samplePlane({
        name: "size", width: previewWidth, height: previewHeight,
        progress, timeSeconds, projectSeed, settings,
      }).data,
      color: this.samplePlane({
        name: "color", width: previewWidth, height: previewHeight,
        progress, timeSeconds, projectSeed, settings,
      }).data,
      dimensions: { width: previewWidth, height: previewHeight },
    };
  }

  sampleCpu({ layout, progress, timeSeconds, projectSeed, settings }) {
    const columns = Math.max(1, Math.trunc(layout.columns));
    const rows = Math.max(1, Math.trunc(layout.rows));
    const planes = {};
    for (const name of LAYERS) {
      const factor = RESOLUTION[name];
      const width = columns * factor;
      const height = rows * factor;
      planes[name] = this.samplePlane({
        name, width, height, progress, timeSeconds, projectSeed, settings,
      });
    }
    const size = reduce2x(reduce2x(planes.size.data, planes.size.width, planes.size.height).data, columns * 2, rows * 2);
    return {
      backend: 'cpu',
      size: size.data,
      color: planes.color.data,
      contrastLevels: pyramid(planes.contrast.data, planes.contrast.width, planes.contrast.height),
      visibilityLevels: pyramid(planes.visibility.data, planes.visibility.width, planes.visibility.height),
      dimensions: { columns, rows },
    };
  }
}
