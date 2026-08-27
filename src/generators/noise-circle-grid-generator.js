import {
  createNoiseFieldRegistry,
  NoiseFieldSampler,
  resolveNoiseFieldSettings,
} from "../noise-fields/index.js";
import { debug } from "../debug/index.js";

const TAU = Math.PI * 2;

function paletteByName(palettes, name) {
  const key = Object.keys(palettes).find(candidate => candidate.toLowerCase() === String(name).toLowerCase());
  if (!key) throw new Error(`Unknown palette "${name}". Available palettes: ${Object.keys(palettes).join(', ')}.`);
  return palettes[key];
}

function legacyVisibilityUnit(x, y, subdivisions) {
  const value = Math.sin(
    (x + 0.5) * 127.1 + (y + 0.5) * 311.7 + subdivisions * 74.7,
  ) * 43758.5453;
  return value - Math.floor(value);
}

function visibilityFill(value, layer) {
  if (layer.softness <= 1e-7) return Number(value >= layer.threshold);
  return Math.max(0, Math.min(1, (
    value - layer.threshold + layer.softness
  ) / (2 * layer.softness)));
}

function densityFromSize(raw, layer) {
  // Match the legacy density control: default false makes dark source values
  // finer, while invert=true uses the source luminance directly.
  const curved = Math.pow(raw, layer.gamma);
  return layer.invert ? curved : 1 - curved;
}

function levelFromSize(raw, layer, levelCount) {
  if (raw < layer.emptyBelow) return -1;
  const density = densityFromSize(raw, layer);
  return Math.min(
    levelCount - 1,
    Math.floor(Math.min(0.999999, density) * levelCount),
  );
}

const DEFAULT_LEVEL_TRANSITION = Object.freeze({
  enabled: false,
  durationSeconds: 0.23,
  cascade: true,
  smoothing: 0.5,
  hysteresis: 0.03,
});

function visibilitySettingsAt(base, effect) {
  if (!effect) return base;
  const amount = Math.max(0, Math.min(1, Number(effect.amount) || 0));
  if (amount === 0) return base;
  if (amount === 1) {
    return {
      ...base,
      threshold: effect.threshold,
      contrast: effect.contrast,
      softness: effect.softness,
    };
  }
  return {
    ...base,
    threshold: base.threshold + (effect.threshold - base.threshold) * amount,
    contrast: base.contrast + (effect.contrast - base.contrast) * amount,
    softness: base.softness + (effect.softness - base.softness) * amount,
  };
}

function mergeNoiseFields(base = {}, overrides = {}) {
  const layers = {};
  for (const name of new Set([
    ...Object.keys(base.layers ?? {}),
    ...Object.keys(overrides.layers ?? {}),
  ])) {
    layers[name] = { ...(base.layers?.[name] ?? {}), ...(overrides.layers?.[name] ?? {}) };
  }
  return {
    ...base,
    ...overrides,
    modes: { ...(base.modes ?? {}), ...(overrides.modes ?? {}) },
    layers,
  };
}

function normalizeGeneratorSettings(source = {}, fallback = {}) {
  const timing = source.timing ?? fallback.timing;
  const settings = {
    longSideCells: source.longSideCells ?? fallback.longSideCells ?? 9,
    frameMargin: source.frameMargin ?? fallback.frameMargin ?? 0,
    dotMargin: source.dotMargin ?? fallback.dotMargin ?? 0,
    palette: source.palette ?? fallback.palette ?? "green",
    paletteColors: source.paletteColors === undefined
      ? (fallback.paletteColors ? [...fallback.paletteColors] : null)
      : (source.paletteColors === null ? null : [...source.paletteColors]),
    backgroundColor: source.backgroundColor ?? fallback.backgroundColor ?? "#000000",
    backend: source.backend ?? fallback.backend ?? "auto",
    noiseFields: mergeNoiseFields(fallback.noiseFields, source.noiseFields),
    levelTransition: {
      ...DEFAULT_LEVEL_TRANSITION,
      ...(fallback.levelTransition ?? {}),
      ...(source.levelTransition ?? {}),
    },
    debugGrid: source.debugGrid ?? fallback.debugGrid ?? false,
    durationSeconds: source.durationSeconds
      ?? fallback.durationSeconds
      ?? timing?.bodyDurationSeconds,
  };
  if (!Number.isFinite(settings.longSideCells) || settings.longSideCells < 3) {
    throw new RangeError("noiseGrid.longSideCells must be at least 3.");
  }
  if (!Number.isFinite(settings.frameMargin) || settings.frameMargin < 0) {
    throw new RangeError("noiseGrid.frameMargin must be non-negative.");
  }
  if (!Number.isFinite(settings.dotMargin) || settings.dotMargin < 0 || settings.dotMargin >= 1) {
    throw new RangeError("noiseGrid.dotMargin must be between 0 (inclusive) and 1 (exclusive).");
  }
  if (!['auto', 'cpu', 'shader'].includes(settings.backend)) {
    throw new Error(`Unknown noise backend "${settings.backend}". Available backends: auto, cpu, shader.`);
  }
  if (!(Number.isFinite(settings.durationSeconds) && settings.durationSeconds > 0)) {
    throw new RangeError("noiseGrid.durationSeconds must be a finite positive number.");
  }
  if (!(Number.isFinite(settings.levelTransition.durationSeconds) && settings.levelTransition.durationSeconds > 0)) {
    throw new RangeError("noiseGrid.levelTransition.durationSeconds must be a finite positive number.");
  }
  return settings;
}

export class NoiseCircleGridGenerator {
  constructor({ name, settingsKey, options, settings, runtime, palettes, noiseFieldModes }) {
    this.generatorInstanceId = name ?? null;
    this.settingsKey = settingsKey ?? null;
    this.runtime = runtime;
    this.modeRegistry = noiseFieldModes ?? createNoiseFieldRegistry();
    this.options = { ...options };
    this.palettes = palettes;
    this.globalNoiseFields = settings?.noiseFields ?? {};
    this.generatorSettings = normalizeGeneratorSettings(options);
    this.resolveSettings();
    this.sampler = new NoiseFieldSampler({ modeRegistry: this.modeRegistry, shaderFactory: options.shaderFactory ?? null });
    this.progress = 0;
    this.elapsedTime = 0;
    this.active = false;
    this.disposed = false;
    this.sampled = null;
    this.outputState = null;
    this.cellAnimation = null;
    this.visibilityEffectPhase = null;
    this.visibilityEffectActive = false;
    this.resize(runtime.viewport());
  }

  resolveSettings() {
    const authored = this.generatorSettings.noiseFields;
    this.noiseSettings = resolveNoiseFieldSettings(this.globalNoiseFields, {
      ...authored,
      dotMargin: authored.dotMargin ?? this.generatorSettings.dotMargin,
    }, { modeRegistry: this.modeRegistry, timing: this.options.timing });
    this.noiseSettings.timing = {
      ...this.options.timing,
      bodyDurationSeconds: this.generatorSettings.durationSeconds,
      beatSeconds: this.generatorSettings.durationSeconds / this.options.timing.beatCount,
    };
    this.visibilitySettings = this.noiseSettings.layers.visibility;
    this.samplingSettings = this.noiseSettings;
    this.palette = this.generatorSettings.paletteColors
      ? [...this.generatorSettings.paletteColors]
      : [...paletteByName(this.palettes, this.generatorSettings.palette)];
  }

  resize({ width, height }) {
    const long = Math.max(3, Math.round(this.generatorSettings.longSideCells));
    const longCells = long % 2 === 0 ? long - 1 : long;
    const cellSize = Math.max(width, height) / longCells;
    const fit = size => Math.max(1, Math.floor(size / cellSize + 1e-6));
    const columns = width >= height ? longCells : fit(width);
    const rows = width >= height ? fit(height) : longCells;
    this.layout = {
      width, height, columns, rows, cellSize,
      patternWidth: columns * cellSize,
      patternHeight: rows * cellSize,
      offsetX: (width - columns * cellSize) / 2,
      offsetY: (height - rows * cellSize) / 2,
    };
    this.cellAnimation = {
      level: new Int8Array(columns * rows).fill(-1),
      target: new Int8Array(columns * rows).fill(-1),
      luminance: new Float32Array(columns * rows).fill(-1),
      phase: new Uint8Array(columns * rows),
      phaseProgress: new Float32Array(columns * rows),
      scale: new Float32Array(columns * rows).fill(1),
    };
    this.sample();
    this.resetOutputState(this.elapsedTime);
  }

  enter() { this.active = true; this.sample(); }
  exit() { this.active = false; }

  update(frame = {}) {
    const duration = this.generatorSettings.durationSeconds;
    const timelineTime = Math.max(0, Number(frame.timelineTime ?? frame.time) || 0);
    this.progress = duration > 0 ? ((timelineTime / duration) % 1 + 1) % 1 : 0;
    this.elapsedTime = timelineTime;
    this.applyPhaseEffects(frame);
    this.sample(frame.exporting === true ? 'cpu' : this.generatorSettings.backend);
    this.updateOutputState(this.elapsedTime);
    this.updateCellAnimation(Math.max(0, Number(frame.dt) || 0));
  }

  applyPhaseEffects(frame) {
    const effect = frame?.phaseEffects?.noiseVisibility ?? null;
    this.visibilityEffectActive = effect !== null;
    this.visibilitySettings = visibilitySettingsAt(
      this.noiseSettings.layers.visibility,
      effect,
    );
    this.samplingSettings = effect === null
      ? this.noiseSettings
      : {
        ...this.noiseSettings,
        layers: {
          ...this.noiseSettings.layers,
          visibility: this.visibilitySettings,
        },
      };
    const phase = effect === null ? null : frame?.compositionEndpoint?.phase ?? null;
    if (phase !== this.visibilityEffectPhase) {
      debug.transition(
        "noise-visibility phase=%s threshold=%.3f contrast=%.3f softness=%.3f",
        phase ?? "-",
        effect?.threshold ?? this.visibilitySettings.threshold,
        effect?.contrast ?? this.visibilitySettings.contrast,
        effect?.softness ?? this.visibilitySettings.softness,
      );
      this.visibilityEffectPhase = phase;
    }
  }

  sample(backend = this.generatorSettings.backend) {
    if (this.disposed) return;
    this.sampled = this.sampler.sample({
      layout: this.layout,
      progress: this.progress,
      timeSeconds: this.elapsedTime,
      projectSeed: this.runtime.projectSeed?.() ?? 0,
      settings: this.samplingSettings,
      backend,
    });
  }

  desiredOutputs(levelIndex, sampleIndex) {
    const contrastLevel = this.sampled.contrastLevels[levelIndex];
    const subdivisions = contrastLevel.subdivisions;
    const x = sampleIndex % contrastLevel.width;
    const y = Math.floor(sampleIndex / contrastLevel.width);
    const column = Math.floor(x / subdivisions);
    const row = Math.floor(y / subdivisions);
    const cell = row * this.layout.columns + column;
    const base = this.sampled.color[cell] / 255;
    const contrast = contrastLevel.data[sampleIndex] / 255;
    const influence = this.noiseSettings.layers.contrast.influence;
    const modulated = Math.max(0, Math.min(0.999999, base + influence * (contrast - 0.5)));
    const color = Math.min(this.palette.length - 1, Math.floor(modulated * this.palette.length));

    const visibilityLayer = this.visibilitySettings;
    const visibilityLevel = this.sampled.visibilityLevels[levelIndex];
    const visibilityValue = visibilityLayer.softness <= 1e-7
      ? this.sampled.visibilityLevels[4].data[cell] / 255
      : visibilityLevel.data[sampleIndex] / 255;
    const fill = visibilityFill(visibilityValue, visibilityLayer);
    const visibility = Number(
      legacyVisibilityUnit(x, y, subdivisions) * 0.999999 <= fill,
    );
    return { color, visibility };
  }

  resetOutputState(time = 0) {
    if (!this.sampled) return;
    this.outputState = {
      lastTime: time,
      cycleIndex: Math.floor(time / this.animationDuration()),
      color: this.sampled.contrastLevels.map(level => ({
        values: new Uint8Array(level.data.length),
        changedAt: new Float64Array(level.data.length),
      })),
      visibility: this.sampled.visibilityLevels.map(level => ({
        values: new Uint8Array(level.data.length),
        changedAt: new Float64Array(level.data.length),
      })),
    };
    this.updateOutputState(time, true);
  }

  updateOutputState(time, forceReset = false) {
    if (!this.sampled) return;
    if (
      !this.outputState
      || this.outputState.color[0].values.length !== this.sampled.contrastLevels[0].data.length
      || time < this.outputState.lastTime
      || Math.floor(time / this.animationDuration()) !== this.outputState.cycleIndex
    ) {
      this.resetOutputState(time);
      return;
    }
    const colorHold = this.noiseSettings.layers.color.holdSeconds;
    // The text envelope is already a timed visibility transition. Applying the
    // field's output hold on top can outlast the whole intro and hide the ramp.
    const visibilityHold = this.visibilityEffectActive
      ? 0
      : this.noiseSettings.layers.visibility.holdSeconds;
    for (let levelIndex = 0; levelIndex < this.sampled.contrastLevels.length; levelIndex += 1) {
      const colorState = this.outputState.color[levelIndex];
      const visibilityState = this.outputState.visibility[levelIndex];
      for (let index = 0; index < colorState.values.length; index += 1) {
        const desired = this.desiredOutputs(levelIndex, index);
        if (forceReset) {
          colorState.values[index] = desired.color;
          colorState.changedAt[index] = time - colorHold;
          visibilityState.values[index] = desired.visibility;
          visibilityState.changedAt[index] = time - visibilityHold;
          continue;
        }
        if (
          desired.color !== colorState.values[index]
          && time - colorState.changedAt[index] >= colorHold
        ) {
          colorState.values[index] = desired.color;
          colorState.changedAt[index] = time;
        }
        if (
          desired.visibility !== visibilityState.values[index]
          && time - visibilityState.changedAt[index] >= visibilityHold
        ) {
          visibilityState.values[index] = desired.visibility;
          visibilityState.changedAt[index] = time;
        }
      }
    }
    this.outputState.lastTime = time;
  }

  levelForCell(index) {
    const raw = this.sampled.size[index] / 255;
    return levelFromSize(
      raw,
      this.noiseSettings.layers.size,
      this.noiseSettings.levelCount,
    );
  }

  updateCellAnimation(dt) {
    const transition = this.generatorSettings.levelTransition;
    if (!transition.enabled || !this.sampled) return;
    const state = this.cellAnimation;
    const smoothing = transition.smoothing;
    const blend = smoothing <= 0 ? 1 : 1 - Math.pow(smoothing, Math.min(0.25, dt) * 60);
    for (let index = 0; index < this.sampled.size.length; index += 1) {
      const raw = this.sampled.size[index] / 255;
      if (state.luminance[index] < 0) state.luminance[index] = raw;
      else state.luminance[index] += (raw - state.luminance[index]) * blend;
      const layer = this.noiseSettings.layers.size;
      const adjusted = densityFromSize(state.luminance[index], layer);
      const levelCount = this.noiseSettings.levelCount;
      let wanted = raw < layer.emptyBelow
        ? -1
        : Math.min(levelCount - 1, Math.floor(Math.min(0.999999, adjusted) * levelCount));
      if (state.level[index] < 0) { state.level[index] = wanted; state.target[index] = wanted; continue; }
      const current = state.level[index];
      if (wanted > current && adjusted < (current + 1) / levelCount + transition.hysteresis) wanted = current;
      if (wanted < current && adjusted > current / levelCount - transition.hysteresis) wanted = current;
      state.target[index] = wanted;
      if (state.phase[index] === 0 && wanted !== current) { state.phase[index] = 1; state.phaseProgress[index] = 0; }
      if (state.phase[index] === 0) continue;
      state.phaseProgress[index] += Math.min(0.25, dt) / transition.durationSeconds;
      const p = Math.min(1, state.phaseProgress[index]);
      if (state.phase[index] === 1) {
        state.scale[index] = 1 - p;
        if (p >= 1) {
          state.level[index] = transition.cascade
            ? current + Math.sign(state.target[index] - current)
            : state.target[index];
          state.phase[index] = 2; state.phaseProgress[index] = 0;
        }
      } else {
        state.scale[index] = p;
        if (p >= 1) {
          state.scale[index] = 1; state.phaseProgress[index] = 0;
          state.phase[index] = state.level[index] === state.target[index] ? 0 : 1;
        }
      }
    }
  }

  draw(frame, planEntry, context = this.runtime.context()) {
    if (!context || typeof context.arc !== 'function') throw new TypeError('Noise grid requires a 2D drawing context.');
    if (!this.sampled) this.sample(frame?.exporting === true ? 'cpu' : this.generatorSettings.backend);
    const { columns, rows, cellSize, offsetX, offsetY } = this.layout;
    const margin = 1 - this.noiseSettings.dotMargin;
    if (!this.outputState) this.resetOutputState(this.elapsedTime);
    context.save();
    try {
      context.fillStyle = this.generatorSettings.backgroundColor;
      context.fillRect?.(0, 0, this.layout.width, this.layout.height);
      if (this.generatorSettings.frameMargin > 0) {
        const longSideCells = this.generatorSettings.longSideCells;
        const scale = Math.max(0.01, (
          longSideCells - Math.min(this.generatorSettings.frameMargin, longSideCells - 1)
        ) / longSideCells);
        context.translate(this.layout.width / 2, this.layout.height / 2);
        context.scale(scale, scale);
        context.translate(-this.layout.width / 2, -this.layout.height / 2);
      }
      for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
        const cell = row * columns + column;
        const level = this.generatorSettings.levelTransition.enabled
          ? this.cellAnimation.level[cell]
          : this.levelForCell(cell);
        if (level < 0) continue;
        const subdivisions = 1 << level;
        const slot = cellSize / subdivisions;
        const levelIndex = 4 - level;
        const colors = this.outputState.color[levelIndex].values;
        const visibility = this.outputState.visibility[levelIndex].values;
        const levelWidth = columns * subdivisions;
        for (let gy = 0; gy < subdivisions; gy += 1) for (let gx = 0; gx < subdivisions; gx += 1) {
          const glyph = gy * subdivisions + gx;
          const sampleIndex = (row * subdivisions + gy) * levelWidth + column * subdivisions + gx;
          if (visibility[sampleIndex] === 0) continue;
          const paletteIndex = colors[sampleIndex];
          const x = offsetX + column * cellSize + (gx + 0.5) * slot;
          const y = offsetY + row * cellSize + (gy + 0.5) * slot;
          const radius = slot * 0.5 * margin * (
            this.generatorSettings.levelTransition.enabled ? this.cellAnimation.scale[cell] : 1
          );
          context.fillStyle = this.palette[paletteIndex];
          context.beginPath(); context.moveTo(x + radius, y); context.arc(x, y, radius, 0, TAU); context.fill();
        }
        if (this.generatorSettings.debugGrid) {
          context.strokeStyle = "#ff00ff";
          context.strokeRect?.(offsetX + column * cellSize, offsetY + row * cellSize, cellSize, cellSize);
        }
      }
    } finally { context.restore(); }
  }

  transitionItems() {
    const items = [];
    for (let cell = 0; cell < this.layout.columns * this.layout.rows; cell += 1) {
      const level = this.levelForCell(cell);
      if (level < 0) continue;
      const n = 1 << level;
      const column = cell % this.layout.columns;
      const row = Math.floor(cell / this.layout.columns);
      const slot = this.layout.cellSize / n;
      for (let glyph = 0; glyph < n * n; glyph += 1) items.push({
        id: `${cell}:${glyph}`,
        x: this.layout.offsetX + column * this.layout.cellSize + (glyph % n + 0.5) * slot,
        y: this.layout.offsetY + row * this.layout.cellSize + (Math.floor(glyph / n) + 0.5) * slot,
        size: slot,
      });
    }
    return items;
  }

  noisePreviewSnapshot({ previewWidth, previewHeight } = {}) {
    if (!this.sampled) return null;
    const continuous = Number.isFinite(previewWidth) && Number.isFinite(previewHeight)
      ? this.sampler.samplePreview({
        width: previewWidth,
        height: previewHeight,
        progress: this.progress,
        timeSeconds: this.elapsedTime,
        projectSeed: this.runtime.projectSeed?.() ?? 0,
        settings: this.samplingSettings,
      })
      : null;
    return {
      backend: this.sampled.backend,
      palette: [...this.palette],
      dimensions: { ...this.sampled.dimensions },
      size: continuous?.size ?? this.sampled.size.slice(),
      color: continuous?.color ?? this.sampled.color.slice(),
      previewDimensions: continuous?.dimensions ?? null,
      contrast: this.sampled.contrastLevels[0].data.slice(),
      visibility: Uint8Array.from(this.sampled.visibilityLevels[0].data, value => (
        Math.round(visibilityFill(value / 255, this.visibilitySettings) * 255)
      )),
      visibilitySettings: {
        threshold: this.visibilitySettings.threshold,
        contrast: this.visibilitySettings.contrast,
        softness: this.visibilitySettings.softness,
      },
    };
  }

  animationDuration() { return this.generatorSettings.durationSeconds; }
  seek(time) {
    if (!Number.isFinite(time) || time < 0) return false;
    this.elapsedTime = 0;
    this.progress = 0;
    this.sample('cpu');
    this.resetOutputState(0);
    const step = 1 / 60;
    const tolerance = Number.EPSILON * Math.max(1, time) * 16;
    let cursor = 0;
    while (cursor + step < time - tolerance) {
      cursor += step;
      this.elapsedTime = cursor;
      this.progress = (cursor / this.animationDuration()) % 1;
      this.sample('cpu');
      this.updateOutputState(cursor);
    }
    const remainder = time - cursor;
    if (remainder > tolerance) {
      this.elapsedTime = time;
      this.progress = (time / this.animationDuration()) % 1;
      this.sample('cpu');
      this.updateOutputState(time);
    }
    return true;
  }
  contentBounds() { return { x: 0, y: 0, width: this.layout.width, height: this.layout.height }; }
  inspect() { const preview = this.noisePreviewSnapshot(); return { generatorType: 'noise-circle-grid', active: this.active, progress: this.progress, fieldTime: this.elapsedTime, visibilitySettings: { threshold: this.visibilitySettings.threshold, contrast: this.visibilitySettings.contrast, softness: this.visibilitySettings.softness }, backend: preview?.backend ?? null, levels: this.sampled ? Array.from(this.sampled.size, (_, index) => this.levelForCell(index)) : [] }; }
  settingsSnapshot() { return structuredClone(this.generatorSettings); }
  applySettings(value, { time = this.elapsedTime } = {}) {
    this.generatorSettings = normalizeGeneratorSettings(value, this.generatorSettings);
    this.resolveSettings();
    this.resize(this.runtime.viewport());
    this.seek(time);
    debug.config(
      "noise-settings=applied mode=%s palette=%s cells=%d",
      this.noiseSettings.layers.size.mode,
      this.generatorSettings.palette,
      this.generatorSettings.longSideCells,
    );
    return this.settingsSnapshot();
  }
  snapshotProjectState() { return { version: 3, settings: this.settingsSnapshot(), time: this.elapsedTime, timeline: structuredClone(this.timeline ?? { version: 1, tracks: {} }) }; }
  restoreProjectState(value) {
    if (value?.version === 1) return this.seek(value.progress * this.animationDuration());
    if (value?.version !== 3 || !value.settings) return false;
    this.timeline = structuredClone(value.timeline ?? { version: 1, tracks: {} });
    this.applySettings(value.settings, { time: value.time });
    return true;
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.sampled = null; this.outputState = null; debug.config('noise-generator=disposed id=%s', this.generatorInstanceId); }
}
