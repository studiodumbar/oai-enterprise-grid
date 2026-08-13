import test from "node:test";
import assert from "node:assert/strict";

import {
  createStoreZip,
  createStoreZipBytes,
  createZip,
  createZipBytes,
} from "../src/export/zip.js";

const decoder = new TextDecoder();

function referenceCrc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = checksum & 1
        ? 0xedb88320 ^ (checksum >>> 1)
        : checksum >>> 1;
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function inspectZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = bytes.length - 22;
  assert.equal(view.getUint32(endOffset, true), 0x06054b50);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  assert.equal(centralOffset + centralSize, endOffset);

  const localEntries = [];
  let localOffset = 0;
  while (localOffset < centralOffset) {
    assert.equal(view.getUint32(localOffset, true), 0x04034b50);
    assert.equal(view.getUint16(localOffset + 6, true), 0x0800);
    assert.equal(view.getUint16(localOffset + 8, true), 0);
    assert.equal(view.getUint16(localOffset + 12, true), 0x0021);
    const crc = view.getUint32(localOffset + 14, true);
    const compressedSize = view.getUint32(localOffset + 18, true);
    const uncompressedSize = view.getUint32(localOffset + 22, true);
    const nameLength = view.getUint16(localOffset + 26, true);
    const extraLength = view.getUint16(localOffset + 28, true);
    assert.equal(compressedSize, uncompressedSize);
    assert.equal(extraLength, 0);
    const nameStart = localOffset + 30;
    const dataStart = nameStart + nameLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    localEntries.push({
      name: decoder.decode(bytes.subarray(nameStart, dataStart)),
      data,
      crc,
      offset: localOffset,
    });
    localOffset = dataStart + compressedSize;
  }
  assert.equal(localEntries.length, entryCount);

  const centralEntries = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    assert.equal(view.getUint16(offset + 8, true), 0x0800);
    assert.equal(view.getUint16(offset + 10, true), 0);
    assert.equal(view.getUint16(offset + 14, true), 0x0021);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    centralEntries.push({
      name: decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)),
      crc: view.getUint32(offset + 16, true),
      size: view.getUint32(offset + 24, true),
      localOffset: view.getUint32(offset + 42, true),
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, endOffset);
  return { localEntries, centralEntries };
}

test("store-only ZIP emits UTF-8 names, data, CRCs, and matching central records", () => {
  const expected = [
    {
      name: "OAI-0812-143005_0000.png",
      data: Uint8Array.of(1, 2, 3, 4),
    },
    {
      name: "frames/été-帧.png",
      data: new TextEncoder().encode("already compressed"),
    },
  ];
  const bytes = createZipBytes(expected);
  const { localEntries, centralEntries } = inspectZip(bytes);

  assert.deepEqual(localEntries.map(entry => entry.name), expected.map(entry => entry.name));
  localEntries.forEach((entry, index) => {
    assert.deepEqual(entry.data, expected[index].data);
    assert.equal(entry.crc, referenceCrc32(expected[index].data));
    assert.deepEqual(centralEntries[index], {
      name: entry.name,
      crc: entry.crc,
      size: entry.data.length,
      localOffset: entry.offset,
    });
  });
});

test("ZIP accepts strings and offset views and exposes store-named aliases", () => {
  const padded = Uint8Array.of(99, 5, 6, 7, 88);
  const entries = [
    { name: "note.txt", data: "hello" },
    { name: "bytes.bin", data: new DataView(padded.buffer, 1, 3) },
  ];
  assert.deepEqual(createStoreZipBytes(entries), createZipBytes(entries));

  const { localEntries } = inspectZip(createStoreZipBytes(entries));
  assert.equal(decoder.decode(localEntries[0].data), "hello");
  assert.deepEqual(localEntries[1].data, Uint8Array.of(5, 6, 7));
});

test("ZIP Blob helpers set the expected media type", async () => {
  const entries = [{ name: "frame.png", data: Uint8Array.of(1, 2) }];
  for (const blob of [createZip(entries), createStoreZip(entries)]) {
    assert.ok(blob instanceof Blob);
    assert.equal(blob.type, "application/zip");
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), createZipBytes(entries));
  }
});

test("empty ZIPs are valid and unsupported names/counts are rejected", () => {
  const empty = createZipBytes([]);
  assert.equal(empty.length, 22);
  assert.deepEqual(inspectZip(empty), { localEntries: [], centralEntries: [] });
  assert.throws(
    () => createZipBytes([{ name: "", data: new Uint8Array() }]),
    /non-empty filename/,
  );
  assert.throws(
    () => createZipBytes(new Array(65_536)),
    /ZIP64 entry counts/,
  );
});
