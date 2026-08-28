import test from "node:test";
import assert from "node:assert/strict";

import { createExportState } from "../src/export/export-state.js";
import {
  applyExportPresetJob,
  exportPreset,
  exportPresetJobSession,
} from "../src/export/export-presets.js";

test("preview preset defines both aspect ratios for 4K PNG and 1080p MP4", () => {
  const preset = exportPreset("preview");
  const state = createExportState();
  const actual = preset.jobs.map(job => {
    applyExportPresetJob(state, preset, job);
    return {
      format: state.exportFormat,
      aspect: state.aspect,
      size: `${state.resW}x${state.resH}`,
      fps: state.fps,
      embedded: state.embedProjectState,
      transparent: state.transparentBg,
      directory: job.directory ?? null,
    };
  });

  assert.deepEqual(actual, [
    { format: "png-sequence", aspect: "16:9", size: "3840x2160", fps: 60, embedded: true, transparent: false, directory: "png_sequence-4k-16x9" },
    { format: "png-sequence", aspect: "2:1", size: "3840x1920", fps: 60, embedded: true, transparent: false, directory: "png_sequence-4k-2x1" },
    { format: "mp4", aspect: "16:9", size: "1920x1080", fps: 60, embedded: true, transparent: false, directory: null },
    { format: "mp4", aspect: "2:1", size: "1920x960", fps: 60, embedded: true, transparent: false, directory: null },
  ]);
});

test("preview PNG jobs create their named folder under one selected parent", async () => {
  const calls = [];
  const child = { getFileHandle() {} };
  const parent = {
    async getDirectoryHandle(name, options) {
      calls.push({ name, options });
      return child;
    },
  };
  const session = { pngSequenceDirectory: Promise.resolve(parent) };
  const [pngJob, , mp4Job] = exportPreset("preview").jobs;

  const pngSession = exportPresetJobSession(session, pngJob);
  assert.equal(await pngSession.pngSequenceDirectory, child);
  assert.deepEqual(calls, [{
    name: "png_sequence-4k-16x9",
    options: { create: true },
  }]);
  assert.equal(exportPresetJobSession(session, mp4Job), session);
});

test("export presets reject unknown names", () => {
  assert.throws(() => exportPreset("delivery"), /Unknown export preset.*preview/);
});
