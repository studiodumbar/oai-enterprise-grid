// Headless frame driver.
//
// Runs any composition for N frames with no browser, no canvas, and no p5,
// returning the debug log and a per-frame inspection snapshot. This is how an
// agent answers "why does the intro look glitchy" — see AGENTS.md section 3.
//
//   node --input-type=module -e "
//     import { runFrames } from './src/debug/headless.js';
//     const run = await runFrames({ composition: 'voronoi', frames: 240,
//                                   channels: ['timeline', 'transition'] });
//     console.log(run.lines.join('\n'));
//   "

import {
  SETTINGS,
  PALETTES,
  GENERATOR_DEFINITIONS,
  COMPOSITION_DEFINITIONS,
} from "../../config.js";
import { CompositionDirector } from "../core/composition-director.js";
import { createCatalog } from "../catalog.js";
import { debug } from "./index.js";
import { toPlainState, diffPlainState } from "./plain.js";

export const DEFAULT_HEADLESS_VIEWPORT = Object.freeze({ width: 900, height: 600 });
const SIMULATION_FPS = 60;

/**
 * A Canvas2D stub that records how much drawing happened. It answers the
 * question the real context cannot: did this frame draw anything at all, and
 * how many glyphs did each generator contribute.
 */
export function createCountingContext() {
  return {
    globalAlpha: 1,
    fillStyle: "#000",
    strokeStyle: "#000",
    font: "10px sans-serif",
    textAlign: "left",
    textBaseline: "alphabetic",
    counts: { fill: 0, stroke: 0, path: 0, text: 0, save: 0 },
    alphaStack: [],
    save() {
      this.counts.save += 1;
      this.alphaStack.push(this.globalAlpha);
    },
    restore() {
      if (this.alphaStack.length > 0) this.globalAlpha = this.alphaStack.pop();
    },
    beginPath() {
      this.counts.path += 1;
    },
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    ellipse() {},
    rect() {},
    roundRect() {},
    bezierCurveTo() {},
    quadraticCurveTo() {},
    translate() {},
    rotate() {},
    scale() {},
    setTransform() {},
    resetTransform() {},
    clip() {},
    fill() {
      this.counts.fill += 1;
    },
    stroke() {
      this.counts.stroke += 1;
    },
    fillText() {
      this.counts.text += 1;
    },
    strokeText() {},
    measureText(text) {
      return { width: String(text).length * 6 };
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    drawImage() {},
    clearRect() {},
    fillRect() {},
  };
}

function createFakeP5() {
  return {
    // Deterministic stand-in: the real p5.noise is unavailable headlessly and
    // export already forbids wall-clock or unseeded randomness.
    noise(x = 0, y = 0, z = 0) {
      const value = Math.sin((x + 1) * 12.9898 + (y + 1) * 78.233 + (z + 1) * 37.719)
        * 43758.5453;
      return value - Math.floor(value);
    },
    noiseSeed() {},
    createGraphics(width, height) {
      return {
        width,
        height,
        pixels: new Uint8ClampedArray(width * height * 4),
        drawingContext: createCountingContext(),
        background() {},
        pixelDensity() {},
        loadPixels() {},
        remove() {},
      };
    },
  };
}

export function createHeadlessDirector({
  composition,
  viewport = DEFAULT_HEADLESS_VIEWPORT,
  settings = SETTINGS,
  projectSeed = 1,
} = {}) {
  const context = createCountingContext();
  const runtime = {
    p5: createFakeP5(),
    viewport: () => viewport,
    context: () => context,
    canvas: () => null,
    document: () => null,
    announcer: () => null,
    sessionStorage: () => null,
    random: () => 0.5,
    projectSeed: () => projectSeed,
  };
  const catalog = createCatalog({ palettes: PALETTES });
  const director = new CompositionDirector({
    settings,
    generatorDefinitions: GENERATOR_DEFINITIONS,
    compositionDefinitions: COMPOSITION_DEFINITIONS,
    generatorTypes: catalog.generatorTypes,
    compositionRules: catalog.compositionRules,
    sceneTransitionTypes: catalog.sceneTransitionTypes,
    palettes: PALETTES,
    runtime,
  });
  director.resize(viewport);
  if (composition !== undefined) director.use(composition);
  return { director, context, runtime, viewport };
}

/**
 * Drive `composition` for `frames` fixed steps and return everything an agent
 * needs to reason about what happened.
 *
 * Returns `{ lines, snapshots, drawCounts, changes }` where `lines` is the
 * debug log, `snapshots` are JSON-safe per-frame inspections, and `changes`
 * lists every inspection field that changed, with the frame it changed on.
 */
export async function runFrames({
  composition,
  frames = 120,
  fps = SIMULATION_FPS,
  channels = ["timeline", "transition"],
  viewport = DEFAULT_HEADLESS_VIEWPORT,
  snapshotEvery = 1,
  settings,
  projectSeed = 1,
} = {}) {
  if (!Number.isSafeInteger(frames) || frames <= 0) {
    throw new RangeError("Headless frames must be a positive integer.");
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError("Headless fps must be a finite positive number.");
  }

  const lines = [];
  const previousSink = debug.sink;
  const previousChannels = debug.channels();
  debug.configure({ channels, sink: line => lines.push(line) });

  const { director, context, viewport: activeViewport } = createHeadlessDirector({
    composition,
    viewport,
    settings,
    projectSeed,
  });

  const dt = 1 / fps;
  const snapshots = [];
  const drawCounts = [];
  const changes = [];
  let previousSnapshot = null;

  try {
    for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
      debug.setFrame(frameIndex);
      const frame = {
        dt,
        compositionDt: dt,
        time: frameIndex * dt,
        frameIndex,
        viewport: activeViewport,
        pointer: { active: false, x: 0, y: 0 },
      };
      const before = { ...context.counts };
      director.update(frame);
      director.draw(frame, context);

      drawCounts.push({
        frameIndex,
        fill: context.counts.fill - before.fill,
        path: context.counts.path - before.path,
        text: context.counts.text - before.text,
      });

      if (frameIndex % snapshotEvery === 0) {
        const snapshot = toPlainState(director.inspect());
        snapshots.push({ frameIndex, state: snapshot });
        if (previousSnapshot) {
          for (const change of diffPlainState(previousSnapshot, snapshot)) {
            changes.push({ frameIndex, ...change });
          }
        }
        previousSnapshot = snapshot;
      }
    }
  } finally {
    debug.configure({ channels: previousChannels, sink: previousSink });
    director.dispose();
  }

  return { lines, snapshots, drawCounts, changes };
}

/** Frames that drew nothing — the signature of a composition rendering a blank. */
export function blankFrames(drawCounts) {
  return drawCounts.filter(entry => entry.fill === 0 && entry.text === 0);
}
