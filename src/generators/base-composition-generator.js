import { createFlicker, FLICKER_SCOPES } from "../visuals/flicker/index.js";
import { hashUnit } from "./grid-scene-strategies.js";
import {
  SceneTransition,
  createSceneTransitionModeRegistry,
  resolveSceneTransitionSettings,
} from "../scene-transitions/index.js";
import { NativeCircleEndpointTransition } from "../compositions/circle-endpoints.js";

export const BASE_CELL_LEVELS = Object.freeze([0, 1, 2, 3, 4]);

const DOTS_PER_FINEST_AXIS = 1 << BASE_CELL_LEVELS.at(-1);
const TAU = Math.PI * 2;

function requireFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`);
  }
}

export function normalizePreviewRepeats(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new RangeError("base.previewRepeats must be an integer between 1 and 100.");
  }
  return value;
}

function paletteByName(palettes, requestedName) {
  if (!palettes || typeof palettes !== "object") {
    throw new TypeError("Base composition requires a palettes object.");
  }
  const normalized = String(requestedName).toLowerCase();
  const key = Object.keys(palettes).find(name => name.toLowerCase() === normalized);
  if (!key) {
    throw new Error(
      `Unknown palette "${requestedName}". Available palettes: ${Object.keys(palettes).join(", ")}.`,
    );
  }
  return palettes[key];
}

/** Five square cells centered along the viewport's long axis. */
export function createBaseCompositionLayout(viewport) {
  const width = Number(viewport?.width);
  const height = Number(viewport?.height);
  requireFinitePositive(width, "viewport width");
  requireFinitePositive(height, "viewport height");

  const horizontal = width >= height;
  const cellSize = Math.max(width, height) / BASE_CELL_LEVELS.length;
  const columns = horizontal ? BASE_CELL_LEVELS.length : 1;
  const rows = horizontal ? 1 : BASE_CELL_LEVELS.length;
  const patternWidth = columns * cellSize;
  const patternHeight = rows * cellSize;

  return {
    width,
    height,
    horizontal,
    columns,
    rows,
    cellSize,
    patternWidth,
    patternHeight,
    offsetX: (width - patternWidth) * 0.5,
    offsetY: (height - patternHeight) * 0.5,
  };
}

/**
 * A stable flicker test card: the five cells cover every supported dot density
 * while the active mode and all of its values come from GLOBAL_CONFIG.flicker
 * through the normal config assembly path.
 */
export class BaseCompositionGenerator {
  constructor({
    name,
    settingsKey,
    options,
    settings,
    runtime,
    palettes,
    sceneTransitionTypes,
  }) {
    if (!runtime || typeof runtime.viewport !== "function") {
      throw new TypeError("Base composition requires runtime.viewport().");
    }
    if (!options || typeof options !== "object") {
      throw new TypeError("Base composition options must be an object.");
    }
    if (!Number.isFinite(options.dotMargin) || options.dotMargin < 0 || options.dotMargin >= 1) {
      throw new RangeError("base.dotMargin must be between 0 (inclusive) and 1 (exclusive).");
    }
    if (!Number.isFinite(options.previewSeconds) || options.previewSeconds <= 0) {
      throw new RangeError("base.previewSeconds must be a finite positive number.");
    }

    this.generatorInstanceId = name ?? null;
    this.settingsKey = settingsKey ?? null;
    this.options = options;
    this.runtime = runtime;
    this.timelineElapsed = 0;
    this.elapsed = 0;
    this.pendingCycleBoundary = null;
    this.active = false;
    this.disposed = false;
    this.palette = paletteByName(palettes, options.palette);
    this.noiseFunction = typeof runtime.p5?.noise === "function"
      ? runtime.p5.noise.bind(runtime.p5)
      : undefined;
    this.flickerSettings = options.flicker;
    this.previewRepeats = normalizePreviewRepeats(options.previewRepeats);
    this.flicker = createFlicker({
      palette: this.palette,
      settings: this.flickerSettings,
      noiseFunction: this.noiseFunction,
      autoCycleSeconds: this.autoFlickerCycleSeconds(),
    });
    const introSettings = resolveSceneTransitionSettings({}, options.intro ?? {});
    const outroSettings = options.outro === undefined
      ? resolveSceneTransitionSettings(introSettings, { fallbackToIntro: true })
      : resolveSceneTransitionSettings(introSettings, options.outro);
    this.intro = new SceneTransition({
      direction: "intro",
      settings: introSettings,
      modeRegistry: sceneTransitionTypes ?? createSceneTransitionModeRegistry(),
    });
    this.outro = new SceneTransition({
      direction: "outro",
      settings: outroSettings,
      modeRegistry: sceneTransitionTypes ?? createSceneTransitionModeRegistry(),
    });
    this.circleEndpoint = new NativeCircleEndpointTransition({
      settings: settings?.composition,
      intro: introSettings,
      outro: outroSettings,
      modeRegistry: sceneTransitionTypes ?? createSceneTransitionModeRegistry(),
    });
    this.compositionEndpoint = null;
    this.circleEndpointActive = false;
    this.resize(runtime.viewport());
  }

  transitionItems() {
    const items = [];
    for (let index = 0; index < BASE_CELL_LEVELS.length; index += 1) {
      const level = BASE_CELL_LEVELS[index];
      const subdivisions = 1 << level;
      const slot = this.layout.cellSize / subdivisions;
      const parentColumn = this.layout.horizontal ? index : 0;
      const parentRow = this.layout.horizontal ? 0 : index;
      const left = this.layout.offsetX + parentColumn * this.layout.cellSize;
      const top = this.layout.offsetY + parentRow * this.layout.cellSize;
      for (let glyphIndex = 0; glyphIndex < subdivisions * subdivisions; glyphIndex += 1) {
        const column = glyphIndex % subdivisions;
        const row = Math.floor(glyphIndex / subdivisions);
        items.push({
          id: `${index}:${glyphIndex}`,
          x: left + (column + 0.5) * slot,
          y: top + (row + 0.5) * slot,
          size: slot,
        });
      }
    }
    return items;
  }

  beginIntro(key, fromItems = null) {
    if (this.compositionEndpoint?.phase === "start") return false;
    const event = {
      items: this.transitionItems(),
      layout: this.layout,
      key: `${key}:${this.layout.columns}x${this.layout.rows}`,
    };
    if (Array.isArray(fromItems)) event.fromItems = fromItems;
    return this.intro.begin(event);
  }

  beginOutro(key) {
    return this.outro.begin({
      items: this.transitionItems(),
      layout: this.layout,
      key: `${key}:${this.layout.columns}x${this.layout.rows}`,
    });
  }

  enter() {
    if (this.disposed) throw new Error("Base composition has been disposed.");
    this.active = true;
    this.timelineElapsed = 0;
    this.elapsed = 0;
    this.pendingCycleBoundary = null;
    this.intro.reset();
    this.outro.reset();
    this.circleEndpoint.reset();
    this.compositionEndpoint = null;
    if (!this.circleEndpoint.settings.startWithCircle) this.beginIntro("base:0");
    this.beginFlickerFrame();
  }

  exit() {
    this.active = false;
  }

  update(frame = {}) {
    if (this.disposed) throw new Error("Base composition has been disposed.");
    const dtSource = Number.isFinite(frame.compositionDt) ? frame.compositionDt : frame.dt;
    const dt = Number.isFinite(dtSource) ? Math.max(0, dtSource) : 0;
    this.compositionEndpoint = frame.compositionEndpoint ?? null;
    this.timelineElapsed += dt;
    this.consumeTimeline(dt);
    this.beginFlickerFrame();
  }

  consumeTimeline(dt) {
    let remaining = dt;
    if (this.outro.active) {
      remaining = this.outro.update(remaining);
      if (this.outro.active) return;
      if (this.pendingCycleBoundary !== null) {
        this.elapsed = this.pendingCycleBoundary;
        this.pendingCycleBoundary = null;
        if (this.intro.settings.enabled) {
          this.beginIntro(
            `base:${Math.floor(this.elapsed / this.cycleDuration())}`,
            null,
          );
        }
      }
    }
    if (this.intro.active) {
      remaining = this.intro.update(remaining);
      if (this.intro.active) return;
    }
    if (remaining > 0) this.advanceCycle(remaining);
  }

  advanceCycle(dt) {
    if (dt <= 0) return;
    const duration = this.cycleDuration();
    const currentCycle = Math.floor(this.elapsed / duration);
    const boundary = (currentCycle + 1) * duration;
    const secondsToBoundary = boundary - this.elapsed;
    const cycleIntro = this.intro.settings.enabled;
    const cycleOutro = this.outro.settings.enabled
      && !this.outro.settings.fallbackToIntro;
    if ((cycleIntro || cycleOutro) && dt >= secondsToBoundary) {
      if (cycleOutro) {
        this.pendingCycleBoundary = boundary;
        this.beginOutro(`base:${currentCycle}`);
        this.consumeTimeline(dt - secondsToBoundary);
      } else {
        this.elapsed = boundary;
        this.beginIntro(`base:${currentCycle + 1}`, this.transitionItems());
        this.consumeTimeline(dt - secondsToBoundary);
      }
      return;
    }
    this.elapsed += dt;
  }

  beginFlickerFrame() {
    const duration = this.cycleDuration();
    const cyclePosition = this.elapsed / duration;
    this.flicker.beginFrame({
      time: this.elapsed,
      progress: cyclePosition - Math.floor(cyclePosition),
      cycleIndex: Math.floor(cyclePosition),
    });
  }

  resize(viewport) {
    if (this.disposed) return;
    this.layout = createBaseCompositionLayout(viewport);
    this.flicker.resize(this.flickerGrid());
  }

  flickerGrid() {
    if (this.flicker.scope === "cell") {
      return {
        columns: 1,
        rows: 1,
        cellSize: this.layout.cellSize,
        dotsPerCellAxis: DOTS_PER_FINEST_AXIS,
      };
    }
    return {
      columns: this.layout.columns,
      rows: this.layout.rows,
      cellSize: this.layout.cellSize,
      dotsPerCellAxis: DOTS_PER_FINEST_AXIS,
    };
  }

  flickerTimeFor(index) {
    const cycleTime = this.elapsed % this.cycleDuration();
    if (this.flicker.scope !== "cell" || this.flicker.cellStaggerSeconds === 0) {
      return cycleTime;
    }
    return cycleTime
      + hashUnit(index, BASE_CELL_LEVELS.length, 977) * this.flicker.cellStaggerSeconds;
  }

  sampleCoordinates(index, subColumn, subRow, coordinateStep) {
    const halfStep = coordinateStep * 0.5;
    if (this.flicker.scope === "cell") {
      return {
        x: subColumn * coordinateStep + halfStep,
        y: subRow * coordinateStep + halfStep,
      };
    }
    const parentColumn = this.layout.horizontal ? index : 0;
    const parentRow = this.layout.horizontal ? 0 : index;
    return {
      x: parentColumn * DOTS_PER_FINEST_AXIS + subColumn * coordinateStep + halfStep,
      y: parentRow * DOTS_PER_FINEST_AXIS + subRow * coordinateStep + halfStep,
    };
  }

  paletteIndicesForCell(index, level) {
    const subdivisions = 1 << level;
    const glyphCount = subdivisions * subdivisions;
    const coordinateStep = DOTS_PER_FINEST_AXIS / subdivisions;
    const samples = new Float32Array(glyphCount);
    const order = Array.from({ length: glyphCount }, (_, glyphIndex) => glyphIndex);
    const time = this.flickerTimeFor(index);

    for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex += 1) {
      const subColumn = glyphIndex % subdivisions;
      const subRow = Math.floor(glyphIndex / subdivisions);
      const point = this.sampleCoordinates(index, subColumn, subRow, coordinateStep);
      samples[glyphIndex] = this.flicker.sampleAt(point.x, point.y, time);
    }

    const paletteCount = this.flicker.paletteColors.length;
    const useRank = this.flicker.spreadsRankAcrossCell(glyphCount);
    if (useRank) {
      order.sort((first, second) => samples[first] - samples[second] || first - second);
    }

    const basePosition = 0.5;
    const indices = new Uint16Array(glyphCount);
    for (let rank = 0; rank < glyphCount; rank += 1) {
      const glyphIndex = useRank ? order[rank] : rank;
      if (useRank) {
        const target = Math.min(
          paletteCount - 1,
          Math.floor(rank * paletteCount / glyphCount),
        ) / Math.max(1, paletteCount - 1);
        indices[glyphIndex] = this.flicker.paletteIndexFromSample(
          basePosition,
          target,
          this.flicker.amount,
        );
      } else if (this.flicker.distribution === "level") {
        indices[glyphIndex] = this.flicker.paletteIndexFromSample(
          basePosition,
          samples[glyphIndex],
          this.flicker.amount,
        );
      } else {
        indices[glyphIndex] = this.flicker.paletteIndexFromNoise(
          basePosition,
          samples[glyphIndex],
          this.flicker.amount,
        );
      }
    }
    return indices;
  }

  draw(frame, planEntry, context) {
    if (!context || typeof context.beginPath !== "function") {
      throw new TypeError("Base composition requires a 2D drawing context.");
    }
    this.circleEndpointActive = this.circleEndpoint.prepare(
      frame?.compositionEndpoint,
      this.transitionItems(),
      this.layout,
    );
    const marginScale = 1 - this.options.dotMargin;
    for (let index = 0; index < BASE_CELL_LEVELS.length; index += 1) {
      const level = BASE_CELL_LEVELS[index];
      const subdivisions = 1 << level;
      const slot = this.layout.cellSize / subdivisions;
      const radius = slot * 0.5 * marginScale;
      const parentColumn = this.layout.horizontal ? index : 0;
      const parentRow = this.layout.horizontal ? 0 : index;
      const left = this.layout.offsetX + parentColumn * this.layout.cellSize;
      const top = this.layout.offsetY + parentRow * this.layout.cellSize;
      const paletteIndices = this.flicker.enabled
        ? this.paletteIndicesForCell(index, level)
        : new Uint16Array(subdivisions * subdivisions).fill(
          Math.round((this.flicker.paletteColors.length - 1) * 0.5),
        );

      const transition = this.outro.active ? this.outro : this.intro;
      context.save();
      const inheritedAlpha = Number.isFinite(context.globalAlpha)
        ? context.globalAlpha
        : 1;

      for (let paletteIndex = 0; paletteIndex < this.flicker.paletteColors.length; paletteIndex += 1) {
        context.fillStyle = this.flicker.paletteColors[paletteIndex];
        for (let glyphIndex = 0; glyphIndex < paletteIndices.length; glyphIndex += 1) {
          if (paletteIndices[glyphIndex] !== paletteIndex) continue;
          const subColumn = glyphIndex % subdivisions;
          const subRow = Math.floor(glyphIndex / subdivisions);
          const id = `${index}:${glyphIndex}`;
          const presentations = this.circleEndpointActive
            ? this.circleEndpoint.presentationsFor(id)
            : transition.presentationsFor(id);
          for (const presentation of presentations) {
            if (presentation.opacity <= 0) continue;
            const x = left + (subColumn + 0.5) * slot + presentation.offsetX;
            const y = top + (subRow + 0.5) * slot + presentation.offsetY;
            const glyphRadius = radius * presentation.scale;
            context.globalAlpha = inheritedAlpha * presentation.opacity;
            context.beginPath();
            context.moveTo(x + glyphRadius, y);
            context.arc(x, y, glyphRadius, 0, TAU);
            context.fill();
          }
        }
      }
      context.restore();
    }
  }

  useFlickerMode(name) {
    return this.useFlickerPreview({ mode: name });
  }

  useFlickerPreview({
    mode = this.flicker.modeName,
    scope = this.flicker.scope,
    repeats = this.previewRepeats,
  } = {}) {
    if (!FLICKER_SCOPES.includes(scope)) {
      throw new RangeError(`Flicker preview scope must be one of ${FLICKER_SCOPES.join(", ")}.`);
    }
    const normalizedRepeats = normalizePreviewRepeats(repeats);
    const next = createFlicker({
      palette: this.palette,
      settings: {
        ...this.flickerSettings,
        mode,
        scope,
      },
      noiseFunction: this.noiseFunction,
      autoCycleSeconds: this.autoFlickerCycleSeconds(),
    });
    this.flicker = next;
    this.previewRepeats = normalizedRepeats;
    if (this.layout) this.flicker.resize(this.flickerGrid());
    this.beginFlickerFrame();
    return this;
  }

  flickerPreviewState() {
    return {
      mode: this.flicker.modeName,
      scope: this.flicker.scope,
      repeats: this.previewRepeats,
    };
  }

  availableFlickerModes() {
    return this.flicker.availableModes();
  }

  // The preview window is this composition's only beat, so `cycleSeconds:
  // "auto"` fills one preview per flicker loop. It cannot read cycleDuration()
  // below — that already derives from the flicker cycle.
  autoFlickerCycleSeconds() {
    return this.options.previewSeconds;
  }

  cycleDuration() {
    const modeSettings = this.flicker.settings.modes[this.flicker.modeName];
    return Number.isFinite(modeSettings?.cycleSeconds) && modeSettings.cycleSeconds > 0
      ? modeSettings.cycleSeconds
      : this.options.previewSeconds;
  }

  animationDuration() {
    const cycleSeconds = this.cycleDuration() * this.previewRepeats;
    const authoredIntroCount = this.intro.settings.enabled
      ? this.previewRepeats
      : 0;
    const introCount = this.circleEndpoint.settings.startWithCircle
      ? Math.max(0, authoredIntroCount - 1)
      : authoredIntroCount;
    const outroCount = this.outro.settings.enabled
      && !this.outro.settings.fallbackToIntro
      ? this.previewRepeats
      : 0;
    return cycleSeconds
      + introCount * this.intro.settings.durationSeconds
      + outroCount * this.outro.settings.durationSeconds;
  }

  endpointAutoDuration(direction) {
    const modeSettings = this.flicker.settings.modes[this.flicker.modeName];
    if (Number.isFinite(modeSettings?.cycleSeconds) && modeSettings.cycleSeconds > 0) {
      return modeSettings.cycleSeconds;
    }
    const transition = direction === "end" ? this.outro : this.intro;
    return transition.settings.durationSeconds;
  }

  seek(time) {
    if (!Number.isFinite(time) || time < 0) return false;
    this.enter();
    const step = 1 / 60;
    const tolerance = Number.EPSILON * Math.max(1, time) * 16;
    while (this.timelineElapsed + step < time - tolerance) {
      this.update({ dt: step, compositionDt: step });
    }
    const remainder = time - this.timelineElapsed;
    if (remainder > tolerance) {
      this.update({ dt: remainder, compositionDt: remainder });
    }
    return true;
  }

  contentBounds() {
    return {
      x: this.layout.offsetX,
      y: this.layout.offsetY,
      width: this.layout.patternWidth,
      height: this.layout.patternHeight,
    };
  }

  snapshotProjectState() {
    return {
      version: 1,
      flickerMode: this.flicker.modeName,
      flickerScope: this.flicker.scope,
      previewRepeats: this.previewRepeats,
    };
  }

  restoreProjectState(snapshot) {
    if (
      !snapshot
      || snapshot.version !== 1
      || typeof snapshot.flickerMode !== "string"
      || !this.availableFlickerModes().includes(snapshot.flickerMode)
      || !FLICKER_SCOPES.includes(snapshot.flickerScope)
    ) return false;
    try {
      this.useFlickerPreview({
        mode: snapshot.flickerMode,
        scope: snapshot.flickerScope,
        repeats: snapshot.previewRepeats,
      });
    } catch {
      return false;
    }
    return true;
  }

  inspect() {
    return {
      generatorInstanceId: this.generatorInstanceId,
      generatorType: "base-composition",
      settingsKey: this.settingsKey,
      active: this.active,
      timelinePhase: this.outro.active
        ? "outro"
        : (this.intro.active ? "intro" : "cycle"),
      timelineElapsed: this.timelineElapsed,
      cycleElapsed: this.elapsed,
      elapsed: this.elapsed,
      layout: { ...this.layout },
      levels: [...BASE_CELL_LEVELS],
      dotCounts: BASE_CELL_LEVELS.map(level => 1 << (level * 2)),
      previewRepeats: this.previewRepeats,
      cycleDuration: this.cycleDuration(),
      animationDuration: this.animationDuration(),
      flicker: {
        enabled: this.flicker.enabled,
        mode: this.flicker.modeName,
        scope: this.flicker.scope,
        amount: this.flicker.amount,
      },
      intro: this.intro.inspect(),
      outro: this.outro.inspect(),
    };
  }

  dispose() {
    this.active = false;
    this.disposed = true;
    this.intro.reset();
    this.outro.reset();
    this.circleEndpoint.reset();
    this.pendingCycleBoundary = null;
  }
}

export default BaseCompositionGenerator;
