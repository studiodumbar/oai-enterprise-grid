// The overlay port, from the mode up to the director.
//
// An intro/outro mode that owns content beyond the composition's glyphs — the
// `text` reveal's ladder of cells and its string — draws it through this path.
// Modes without such content must produce no driver at all, so the whole
// subsystem stays free for every other composition.
import test from "node:test";
import assert from "node:assert/strict";

import { PALETTES, SETTINGS } from "../config.js";
import { createArrangementModeRegistry } from "../src/transitions/index.js";
import { createPhaseOverlay } from "../src/transitions/phase-overlay.js";
import { runFrames } from "../src/debug/headless.js";

const VIEWPORT = Object.freeze({ width: 1200, height: 600 });

function countingContext() {
  return {
    globalAlpha: 1,
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    dots: [],
    texts: [],
    // Each ladder cell paints out its own footprint before its dots, so the
    // string never shows through the gaps.
    rects: [],
    alphaStack: [],
    save() {
      this.alphaStack.push(this.globalAlpha);
    },
    restore() {
      this.globalAlpha = this.alphaStack.pop() ?? 1;
    },
    beginPath() {},
    moveTo() {},
    arc(x, y) {
      this.dots.push({ x, y, opacity: this.globalAlpha, fillStyle: this.fillStyle });
    },
    fill() {},
    fillRect(x, y, width, height) {
      this.rects.push({ x, y, width, height, fillStyle: this.fillStyle });
    },
    fillText(text) {
      this.texts.push({ text, opacity: this.globalAlpha });
    },
  };
}

// levels 2 in a 2-second phase with half a second held. The hold takes its
// seconds out of the phase first (0.25 of it) and the four cascade windows split
// what is left, 0.1875 each: expand, uncover, [hold], cover, collapse. Three
// steps — one per level — inside each cascade window.
const PHASE_SECONDS = 2;
const TEXT_PHASE = Object.freeze({
  enabled: true,
  mode: "text",
  durationSeconds: PHASE_SECONDS,
  modes: {
    text: {
      text: "TITLE",
      levels: 2,
      longSideCells: 6,
      visibleSeconds: 0.5,
      palette: "mono",
    },
  },
});

function endpointAt(phase, progress) {
  return { phase, progress, durationSeconds: PHASE_SECONDS, cycleIndex: 0 };
}

test("only a mode with content of its own produces an overlay driver", () => {
  const modeRegistry = createArrangementModeRegistry();
  assert.equal(
    createPhaseOverlay({
      intro: { enabled: true, mode: "fade", durationSeconds: 1 },
      outro: undefined,
      modeRegistry,
    }),
    null,
  );
  // A registry is optional; without one nothing can be resolved.
  assert.equal(createPhaseOverlay({ intro: TEXT_PHASE, modeRegistry: null }), null);
  // A mode that draws its own content refuses to start without a palette.
  assert.throws(
    () => createPhaseOverlay({
      intro: { ...TEXT_PHASE, modes: { text: { text: "TITLE" } } },
      modeRegistry,
    }),
    /draws content of its own and has no palette/,
  );
  const overlay = createPhaseOverlay({ intro: TEXT_PHASE, modeRegistry, palettes: PALETTES });
  assert.deepEqual(overlay.inspect(), {
    intro: "text",
    outro: "text",
    phase: null,
    longSideCells: null,
  });
  // An unauthored outro follows the intro, so a reveal always has its reverse.
  assert.equal(
    createPhaseOverlay({
      intro: TEXT_PHASE,
      outro: { ...TEXT_PHASE, fallbackToIntro: true },
      modeRegistry,
      palettes: PALETTES,
    }).inspect().outro,
    "text",
  );
});

test("the overlay draws the intro forward and the outro backward", () => {
  const overlay = createPhaseOverlay({
    intro: TEXT_PHASE,
    modeRegistry: createArrangementModeRegistry(),
    longSideCells: 6,
    palettes: PALETTES,
    // The host owns the canvas ground the ladder paints out; without it a mode
    // that masks refuses to draw.
    background: "#000000",
  });
  overlay.resize(VIEWPORT);

  const drawAt = (phase, progress) => {
    const context = countingContext();
    const drew = overlay.draw(endpointAt(phase, progress), context);
    return { drew, ...context };
  };

  // Nothing outside a phase, and nothing for a phase the endpoint is not in.
  assert.equal(drawAt("core", 0).drew, false);
  assert.equal(overlay.draw(null, countingContext()), false);

  // The intro runs 0 -> 1: one dot, the full ladder, then the held text.
  assert.equal(drawAt("start", 0.05).dots.length, 1);
  assert.equal(drawAt("start", 0.24).dots.length, 1 + 2 * 4 + 2 * 16);
  const held = drawAt("start", 0.6);
  assert.equal(held.dots.length, 0);
  assert.equal(held.texts.length, 1);

  // The end phase is the same plan read backward, so its progress 0.95 is the
  // intro's 0.05: a single centre dot.
  assert.equal(drawAt("end", 0.95).dots.length, 1);
  assert.equal(drawAt("end", 0.4).texts.length, 1);
  assert.equal(overlay.inspect().phase, "outro");

  // Resizing rebuilds the plan against the new viewport.
  overlay.resize({ width: 600, height: 300 });
  const resized = drawAt("start", 0.05);
  assert.deepEqual([resized.dots[0].x, resized.dots[0].y], [300, 150]);
});

test("a text intro cascades, reveals, and hands the screen to the composition", async () => {
  const settings = structuredClone(SETTINGS);
  settings.composition = {
    ...settings.composition,
    startWithCircle: true,
    startWithCircleDurationSeconds: PHASE_SECONDS,
    endWithCircle: false,
    circleSubdivision: 1,
  };
  settings.gameOfLife.intro = TEXT_PHASE;
  settings.gameOfLife.outro = { ...TEXT_PHASE, fallbackToIntro: true };
  settings.gameOfLife.circleEndpoints.start = {
    ...settings.gameOfLife.circleEndpoints.start,
    enabled: true,
    durationSeconds: PHASE_SECONDS,
  };
  settings.gameOfLife.circleEndpoints.end = {
    ...settings.gameOfLife.circleEndpoints.end,
    enabled: false,
  };

  const run = await runFrames({
    composition: "game-of-life",
    frames: 140,
    channels: ["transition"],
    viewport: VIEWPORT,
    settings,
  });
  const frame = index => run.drawCounts[index];

  assert.ok(
    run.lines.some(line => line.includes("overlay=intro mode=text")),
    "the overlay phase must be observable on the transition channel",
  );
  assert.equal(run.snapshots[0].state.phaseOverlay.intro, "text");

  // A 2s intro at 60fps: expand 0-21, uncover 22-43, hold 44-74, cover 75-96,
  // collapse 97-119.
  assert.equal(frame(3).fill, 1);
  assert.equal(frame(10).fill, 1 + 2 * 4);
  assert.equal(frame(18).fill, 1 + 2 * 4 + 2 * 16);
  assert.equal(frame(18).text, 0);
  // Uncovering: the text is behind the cells, which leave centre first.
  assert.equal(frame(25).text, 1);
  assert.equal(frame(25).fill, 1 + 2 * 4 + 2 * 16);
  assert.equal(frame(33).fill, 2 * 4 + 2 * 16);
  assert.equal(frame(40).fill, 2 * 16);
  // Held: the text alone, and the composition is still dark.
  assert.equal(frame(60).fill, 0);
  assert.equal(frame(60).text, 1);
  // Covering: the cells come back outermost first, and the text stays drawn
  // behind them until the last one lands.
  assert.equal(frame(78).fill, 2 * 16);
  assert.equal(frame(85).fill, 2 * 4 + 2 * 16);
  assert.equal(frame(93).fill, 1 + 2 * 4 + 2 * 16);
  assert.equal(frame(93).text, 1);
  // Collapsing: the ladder is covered, then it folds inward to one centre dot.
  assert.equal(frame(100).text, 0, "the cells cover the text again, nothing fades");
  assert.equal(frame(100).fill, 1 + 2 * 4 + 2 * 16);
  assert.equal(frame(108).fill, 1 + 2 * 4);
  assert.equal(frame(115).fill, 1);
  // Body: the composition alone, no overlay.
  assert.equal(frame(130).text, 0);
  assert.ok(frame(130).fill > 0);

  // The regression this pins: the hold lasts the seconds it was authored for.
  // Nothing else may shorten it — least of all a setting elsewhere that nobody
  // would connect with phase timing.
  const heldFrames = run.drawCounts.filter(
    entry => entry.fill === 0 && entry.text === 1,
  ).length;
  assert.equal(heldFrames, Math.round(TEXT_PHASE.modes.text.visibleSeconds * 60));
  // A squeezed phase clamps the hold and says so; a correct one never does.
  assert.equal(
    run.lines.filter(line => line.includes("text hold clamped")).length,
    0,
    run.lines.join("\n"),
  );
});

test("every palette in the catalog stays available to the overlay color", () => {
  // The overlay draws its own color rather than a palette index, so a text
  // phase does not silently depend on the composition's palette.
  assert.ok(Object.keys(PALETTES).length > 0);
  const overlay = createPhaseOverlay({
    intro: {
      ...TEXT_PHASE,
      modes: { text: { ...TEXT_PHASE.modes.text, palette: ["#00ff88"] } },
    },
    modeRegistry: createArrangementModeRegistry(),
    longSideCells: 6,
    background: "#000000",
  });
  overlay.resize(VIEWPORT);
  const context = countingContext();
  overlay.draw(endpointAt("start", 0.05), context);
  assert.equal(context.dots.at(-1).fillStyle, "#00ff88");
  // A name the palette table does not carry is a startup error, not a default.
  assert.throws(
    () => createPhaseOverlay({
      intro: {
        ...TEXT_PHASE,
        modes: { text: { ...TEXT_PHASE.modes.text, palette: "chartreuse" } },
      },
      modeRegistry: createArrangementModeRegistry(),
      palettes: PALETTES,
    }),
    /palette "chartreuse" is not available/,
  );
});
