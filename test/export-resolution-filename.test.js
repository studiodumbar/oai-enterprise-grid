import test from "node:test";
import assert from "node:assert/strict";

import {
  ASPECT_RATIO_PRESETS,
  LONG_EDGE_PRESETS,
  RESOLUTION_PRESETS,
  evenSize,
  parseAspectRatio,
  parseSize,
  sizeFromAspect,
  sizeFromPresets,
} from "../src/export/resolution.js";
import {
  sequencePadding,
  stamp,
  nameSegment,
  exportBaseName,
  exportFilename,
  exportSequenceFilename,
  exportStamp,
} from "../src/export/filename.js";

test("resolution and aspect presets produce authoritative output dimensions", () => {
  assert.deepEqual(RESOLUTION_PRESETS["1920x1080"], [1920, 1080]);
  assert.equal(LONG_EDGE_PRESETS["4K"], 3840);
  assert.ok(ASPECT_RATIO_PRESETS.includes("9:16"));
  assert.ok(ASPECT_RATIO_PRESETS.includes("2:1"));
  assert.deepEqual(parseSize(" 1920 × 1080 "), { width: 1920, height: 1080 });
  assert.deepEqual(parseAspectRatio("4:5"), { width: 4, height: 5, ratio: 0.8 });
  assert.deepEqual(sizeFromAspect("16:9", 1920), { width: 1920, height: 1080 });
  assert.deepEqual(sizeFromAspect("2:1", 3840), { width: 3840, height: 1920 });
  assert.deepEqual(sizeFromAspect("9:16", 1920), { width: 1080, height: 1920 });
  assert.deepEqual(sizeFromPresets("4K", "4:3"), { width: 3840, height: 2880 });
});

test("video dimensions round down to positive even pixel counts", () => {
  assert.deepEqual(evenSize({ width: 1921, height: 1081 }), {
    width: 1920,
    height: 1080,
  });
  assert.deepEqual(evenSize({ width: 1921.99, height: 1081.99 }), {
    width: 1920,
    height: 1080,
  });
  assert.throws(() => evenSize({ width: 1, height: 10 }), /at least 2/);
});

test("Export filenames use the exact local MMDD-HHMMSS convention", () => {
  const date = new Date(2026, 7, 12, 14, 30, 5);
  assert.equal(exportStamp(date), "0812-143005");
  assert.equal(stamp(date), "0812-143005");
  assert.equal(exportBaseName(date), "OAI_0812-143005");
  assert.equal(
    exportBaseName(date, { composition: "flock", variant: "preview-4k-2x1" }),
    "OAI_flock_preview-4k-2x1_0812-143005",
  );
  assert.equal(exportFilename("png", { date }), "OAI_0812-143005.png");
  assert.equal(
    exportFilename(".PNG", { date, alpha: true }),
    "OAI_0812-143005-alpha.png",
  );
  assert.equal(
    exportFilename("webm", { date, alpha: true }),
    "OAI_0812-143005-alpha.webm",
  );
  assert.equal(
    exportSequenceFilename(7, { date }),
    "OAI_0812-143005_0007.png",
  );
  assert.equal(
    exportSequenceFilename(12, {
      baseName: "OAI_0812-143005",
      padding: 5,
    }),
    "OAI_0812-143005_00012.png",
  );
  assert.equal(sequencePadding(300), 4);
  assert.equal(sequencePadding(10_002), 5);
});

test("Export filenames carry the composition and flicker mode after the OAI prefix", () => {
  const date = new Date(2026, 7, 12, 14, 30, 5);
  assert.equal(
    exportBaseName(date, { composition: "game-of-life", flicker: "radar-arc" }),
    "OAI_game-of-life_radar-arc_0812-143005",
  );
  assert.equal(
    exportFilename("png", { date, composition: "voronoi", flicker: "noise" }),
    "OAI_voronoi_noise_0812-143005.png",
  );
  assert.equal(
    exportFilename("webm", {
      date,
      composition: "flock-grid",
      flicker: "crt-glide",
      alpha: true,
    }),
    "OAI_flock-grid_crt-glide_0812-143005-alpha.webm",
  );
  assert.equal(
    exportSequenceFilename(7, {
      date,
      composition: "Game Of Life",
      flicker: "Echo Ring",
    }),
    "OAI_game-of-life_echo-ring_0812-143005_0007.png",
  );
  assert.equal(nameSegment("  L/Tree_2 "), "l-tree-2");
  // Flicker off, unnamed, or unusable segments drop out entirely.
  assert.equal(
    exportBaseName(date, { composition: "l-tree" }),
    "OAI_l-tree_0812-143005",
  );
  assert.equal(
    exportBaseName(date, { flicker: "noise" }),
    "OAI_noise_0812-143005",
  );
  assert.equal(exportBaseName(date, { composition: "///" }), "OAI_0812-143005");
  assert.equal(exportBaseName(date), "OAI_0812-143005");
});

test("invalid export sizes and filenames fail clearly", () => {
  assert.throws(() => parseSize("1920-ish"), /Bad export size/);
  assert.throws(() => parseAspectRatio("16/9"), /Bad aspect ratio/);
  assert.throws(() => sizeFromPresets("unknown", "1:1"), /Long edge/);
  assert.throws(() => exportFilename("p/ng"), /Invalid export extension/);
  assert.throws(() => exportSequenceFilename(-1), /non-negative integer/);
  assert.throws(() => sequencePadding(0), /positive integer/);
});
