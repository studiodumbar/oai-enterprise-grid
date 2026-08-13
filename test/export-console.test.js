import test from "node:test";
import assert from "node:assert/strict";

import {
  CONSOLE_HELP,
  applyExportFlags,
  createExportConsole,
  parseCommandLine,
  tokenize,
} from "../src/export/export-console.js";
import { createExportState } from "../src/export/export-state.js";
import { sizeFromAspect } from "../src/export/resolution.js";

const CANONICAL = ["game-of-life", "voronoi", "l-tree"];
const ALL_IDS = [...CANONICAL, "thinking"];

function createHarness(overrides = {}) {
  const logged = [];
  const exported = [];
  const failures = overrides.failures ?? {};
  const stub = {
    state: overrides.state ?? createExportState(),
    composition: overrides.composition ?? "game-of-life",
    panelVisible: overrides.panelVisible ?? true,
    synced: 0,
    logged,
    exported,
  };
  const cg = createExportConsole({
    state: stub.state,
    runExport: async () => {
      exported.push({ composition: stub.composition, format: stub.state.exportFormat });
      const error = failures[stub.composition];
      return error ? { ok: false, error: new Error(error) } : { ok: true };
    },
    listCompositions: () => ALL_IDS,
    canonicalCompositions: () => CANONICAL,
    activeComposition: () => stub.composition,
    useComposition: id => {
      stub.composition = id;
    },
    setPanelVisible: visible => {
      stub.panelVisible = visible;
    },
    isPanelVisible: () => stub.panelVisible,
    syncPanel: () => {
      stub.synced += 1;
    },
    isExporting: overrides.isExporting ?? (() => false),
    log: message => logged.push(message),
  });
  return { cg, stub };
}

test("tokenize keeps quoted values whole and rejects unbalanced quotes", () => {
  assert.deepEqual(tokenize("export --all --mp4"), ["export", "--all", "--mp4"]);
  assert.deepEqual(
    tokenize('export --composition "game of life" --aspect \'16:9\''),
    ["export", "--composition", "game of life", "--aspect", "16:9"],
  );
  assert.deepEqual(tokenize("  export   --png  "), ["export", "--png"]);
  assert.throws(() => tokenize('export --composition "unclosed'), /Unbalanced/);
});

test("parseCommandLine reads boolean, valued, negated, and short flags", () => {
  assert.deepEqual(parseCommandLine("export --all --mp4"), {
    name: "export",
    args: [],
    flags: { all: true, mp4: true },
  });
  assert.deepEqual(parseCommandLine("export --fps 60 --aspect=9:16"), {
    name: "export",
    args: [],
    flags: { fps: "60", aspect: "9:16" },
  });
  assert.deepEqual(parseCommandLine("export --no-transparent -c voronoi,l-tree"), {
    name: "export",
    args: [],
    flags: { transparent: false, c: "voronoi,l-tree" },
  });
  assert.deepEqual(parseCommandLine("PANEL Hide"), {
    name: "panel",
    args: ["Hide"],
    flags: {},
  });
  assert.deepEqual(parseCommandLine(""), { name: "", args: [], flags: {} });
});

test("applyExportFlags moves the state to the requested format and frame", () => {
  const state = createExportState({ mode: "static", exportFormat: "png" });
  const changed = applyExportFlags(state, { mp4: true, fps: "60" });
  assert.equal(state.mode, "motion");
  assert.equal(state.exportFormat, "mp4");
  assert.equal(state.fps, 60);
  assert.deepEqual(changed.sort(), ["exportFormat", "fps", "mode"]);

  applyExportFlags(state, { png: true });
  assert.equal(state.mode, "static");
  assert.equal(state.exportFormat, "png");

  applyExportFlags(state, { aspect: "9:16", resolution: "4K" });
  const expected = sizeFromAspect("9:16", 3840);
  assert.equal(state.resolution, 3840);
  assert.equal(state.resW, expected.width);
  assert.equal(state.resH, expected.height);

  applyExportFlags(state, { width: "800", height: "600" });
  assert.equal(state.resW, 800);
  assert.equal(state.resH, 600);

  applyExportFlags(state, { transparent: true });
  assert.equal(state.transparentBg, true);
  applyExportFlags(state, { transparent: false });
  assert.equal(state.transparentBg, false);
});

test("applyExportFlags rejects unusable values", () => {
  const state = createExportState();
  assert.throws(() => applyExportFlags(state, { format: "gif" }), /Unknown format/);
  assert.throws(() => applyExportFlags(state, { mp4: true, webm: true }), /Pick one format/);
  assert.throws(() => applyExportFlags(state, { aspect: "5:7" }), /Unknown aspect/);
  assert.throws(() => applyExportFlags(state, { resolution: "8K" }), /Unknown resolution/);
  assert.throws(() => applyExportFlags(state, { fps: "0" }), /--fps must be between/);
  assert.throws(() => applyExportFlags(state, { width: "1.5" }), /whole number/);
  assert.throws(() => applyExportFlags(state, { format: true }), /--format needs a value/);
  assert.deepEqual(state, createExportState(), "a rejected flag set leaves the state alone");
});

test("export runs the active composition and syncs the panel", async () => {
  const { cg, stub } = createHarness();
  const result = await cg("export --mp4 --fps 24");

  assert.equal(result.ok, true);
  assert.deepEqual(result.compositions, ["game-of-life"]);
  assert.deepEqual(stub.exported, [{ composition: "game-of-life", format: "mp4" }]);
  assert.equal(stub.state.fps, 24);
  assert.equal(stub.synced, 1);
});

test("export --all walks canonical compositions and returns to the starting one", async () => {
  const { cg, stub } = createHarness({ composition: "voronoi" });
  const result = await cg("export --all --png");

  assert.deepEqual(result.compositions, CANONICAL);
  assert.deepEqual(stub.exported.map(entry => entry.composition), CANONICAL);
  assert.ok(!stub.exported.some(entry => entry.composition === "thinking"));
  assert.equal(stub.composition, "voronoi", "the live composition is restored");
  assert.equal(result.ok, true);
});

test("export reports per-composition failures without stopping the batch", async () => {
  const { cg, stub } = createHarness({ failures: { voronoi: "No finite cycle." } });
  const result = await cg("export --all --mp4");

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.results.map(entry => [entry.composition, entry.ok]),
    [["game-of-life", true], ["voronoi", false], ["l-tree", true]],
  );
  assert.equal(result.results[1].error, "No finite cycle.");
  assert.equal(stub.exported.length, 3);
});

test("export --composition validates ids and accepts a comma list", async () => {
  const { cg, stub } = createHarness();
  const result = await cg("export -c voronoi,l-tree --svg");
  assert.deepEqual(result.compositions, ["voronoi", "l-tree"]);
  assert.deepEqual(stub.exported.map(entry => entry.format), ["svg", "svg"]);

  const unknown = await cg("export -c nope");
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /Unknown composition "nope"/);

  const both = await cg("export --all -c voronoi");
  assert.equal(both.ok, false);
  assert.match(both.error, /either --all or --composition/);
});

test("export --dry-run applies settings but downloads nothing", async () => {
  const { cg, stub } = createHarness();
  const result = await cg("export --all --webm --dry-run");

  assert.equal(result.dryRun, true);
  assert.deepEqual(result.compositions, CANONICAL);
  assert.equal(stub.exported.length, 0);
  assert.equal(stub.state.exportFormat, "webm");
});

test("export refuses to start while an export is running", async () => {
  const { cg, stub } = createHarness({ isExporting: () => true });
  const result = await cg("export --png");
  assert.equal(result.ok, false);
  assert.match(result.error, /already running/);
  assert.equal(stub.exported.length, 0);
});

test("panel show, hide, and toggle drive the visibility callback", async () => {
  const { cg, stub } = createHarness({ panelVisible: true });

  assert.deepEqual(await cg("panel hide"), { ok: true, panelVisible: false });
  assert.equal(stub.panelVisible, false);
  assert.deepEqual(await cg("panel show"), { ok: true, panelVisible: true });
  assert.deepEqual(await cg("panel toggle"), { ok: true, panelVisible: false });
  assert.deepEqual(await cg("panel"), { ok: true, panelVisible: true });
  assert.deepEqual(await cg("ui --hide"), { ok: true, panelVisible: false });

  const bad = await cg("panel sideways");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Unknown panel action/);
});

test("list, status, use, and help report the current runtime", async () => {
  const { cg, stub } = createHarness();

  const list = await cg("list");
  assert.deepEqual(list.compositions, ALL_IDS);
  assert.equal(list.active, "game-of-life");
  assert.match(stub.logged.at(-1), /\* game-of-life/);

  const used = await cg("use voronoi");
  assert.equal(used.composition, "voronoi");
  assert.equal(stub.composition, "voronoi");

  const status = await cg("status");
  assert.equal(status.composition, "voronoi");
  assert.equal(status.panelVisible, true);
  assert.equal(status.export.exportFormat, stub.state.exportFormat);

  const help = await cg("help");
  assert.equal(help.help, CONSOLE_HELP);

  const unknown = await cg("frobnicate");
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /Unknown command "frobnicate"/);
});

test("the console accepts tagged-template calls and helper methods", async () => {
  const { cg, stub } = createHarness();
  const format = "webm";

  const result = await cg`export --format ${format}`;
  assert.equal(result.ok, true);
  assert.equal(stub.state.exportFormat, "webm");

  await cg.panel("hide");
  assert.equal(stub.panelVisible, false);
  assert.equal((await cg.list()).active, "game-of-life");
});
