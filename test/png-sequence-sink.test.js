import test from "node:test";
import assert from "node:assert/strict";

import {
  createPngSequenceSink,
  sequenceFrameName,
} from "../src/export/png-sequence-sink.js";

test("PNG sequence names use one prefix and at least four digits", () => {
  assert.equal(sequenceFrameName("OAI-0102-030405", 3, 120), "OAI-0102-030405_0003.png");
  assert.equal(sequenceFrameName("OAI", 99999, 100000), "OAI_99999.png");
});

test("directory sequence sink streams each file and closes it", async () => {
  const events = [];
  const directory = {
    async getFileHandle(name, options) {
      events.push(["handle", name, options]);
      return {
        async createWritable() {
          events.push(["writable", name]);
          return {
            async write(data) { events.push(["write", name, data]); },
            async close() { events.push(["close", name]); },
          };
        },
      };
    },
  };
  let pickerCalls = 0;
  const sink = await createPngSequenceSink({
    prefix: "OAI",
    frameCount: 2,
    windowRef: {
      async showDirectoryPicker() {
        pickerCalls += 1;
        return directory;
      },
    },
  });
  await sink.write(0, new Uint8Array([1]));
  await sink.write(1, new Uint8Array([2]));
  assert.equal(pickerCalls, 1);
  assert.deepEqual(events.map(event => event[0]), [
    "handle", "writable", "write", "close",
    "handle", "writable", "write", "close",
  ]);
});

test("a prepared directory bypasses the gesture-gated picker", async () => {
  const names = [];
  const directory = {
    async getFileHandle(name) {
      names.push(name);
      return {
        async createWritable() {
          return { async write() {}, async close() {} };
        },
      };
    },
  };
  const sink = await createPngSequenceSink({
    prefix: "OAI_voronoi",
    frameCount: 1,
    directory,
    windowRef: {
      showDirectoryPicker() {
        throw new Error("picker must not be called after preparation");
      },
    },
  });

  await sink.write(0, new Uint8Array([1]));
  assert.equal(sink.kind, "directory");
  assert.deepEqual(names, ["OAI_voronoi_0000.png"]);
});

test("fallback sequence sink returns and downloads one ZIP", async () => {
  let download = null;
  const sink = await createPngSequenceSink({
    prefix: "OAI",
    frameCount: 1,
    windowRef: {},
    download: (blob, name) => { download = { blob, name }; },
  });
  await sink.write(0, new Uint8Array([1, 2, 3]));
  const zip = await sink.close();
  assert.equal(download.name, "OAI.zip");
  assert.equal(download.blob, zip);
  assert.equal(zip.type, "application/zip");
});
