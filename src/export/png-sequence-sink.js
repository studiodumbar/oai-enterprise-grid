import { createZip } from "./zip.js";

export function sequenceFrameName(prefix, index, frameCount) {
  const padding = Math.max(4, String(Math.max(0, frameCount - 1)).length);
  return `${prefix}_${String(index).padStart(padding, "0")}.png`;
}

async function writeFile(directory, name, data) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  let completed = false;
  try {
    await writable.write(data);
    await writable.close();
    completed = true;
  } finally {
    if (!completed) await writable.abort?.();
  }
}

export async function createPngSequenceSink({
  prefix,
  frameCount,
  windowRef = window,
  download,
} = {}) {
  if (typeof prefix !== "string" || prefix.length === 0) {
    throw new TypeError("A PNG-sequence prefix is required.");
  }
  if (!Number.isInteger(frameCount) || frameCount <= 0) {
    throw new RangeError("PNG-sequence frameCount must be a positive integer.");
  }
  if (typeof windowRef?.showDirectoryPicker === "function") {
    const directory = await windowRef.showDirectoryPicker({ mode: "readwrite" });
    return {
      kind: "directory",
      async write(index, data) {
        await writeFile(directory, sequenceFrameName(prefix, index, frameCount), data);
      },
      async close() {},
    };
  }

  const entries = [];
  return {
    kind: "zip",
    async write(index, data) {
      entries.push({
        name: sequenceFrameName(prefix, index, frameCount),
        data: data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data,
      });
    },
    async close() {
      const zip = createZip(entries);
      if (typeof download === "function") download(zip, `${prefix}.zip`);
      return zip;
    },
  };
}
