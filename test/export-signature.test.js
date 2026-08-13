import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

import {
  PARAMS_MAGIC,
  PARAMS_PNG_KEYWORD,
  createSignature,
  mergeKnownKeys,
  projectSignature,
} from "../src/export/signature.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PNG_SIGNATURE = Uint8Array.of(
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
);

function concatenate(...parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

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

function pngChunk(type, data = new Uint8Array()) {
  const typeBytes = encoder.encode(type);
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(typeBytes, 4);
  result.set(data, 8);
  view.setUint32(8 + data.length, referenceCrc32(concatenate(typeBytes, data)));
  return result;
}

function onePixelPng() {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, 1);
  view.setUint32(4, 1);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, standard compression/filter
  const compressed = deflateSync(Uint8Array.of(0, 255, 0, 0, 255));
  return concatenate(
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND"),
  );
}

function readPngChunks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    chunks.push({
      offset,
      type,
      data,
      storedCrc: view.getUint32(offset + 8 + length),
    });
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

function iTxtKeyword(chunk) {
  if (chunk.type !== "iTXt") return null;
  const separator = chunk.data.indexOf(0);
  return separator < 0 ? null : decoder.decode(chunk.data.subarray(0, separator));
}

test("Raw and SVG payloads round-trip Unicode JSON", () => {
  assert.equal(PARAMS_MAGIC, "CIRCLEGRIDPARAMS1");
  assert.equal(PARAMS_PNG_KEYWORD, "circle-grid-params");

  const state = {
    app: "circle-grid",
    params: {
      title: "Größe 🟣",
      markerText: "CIRCLEGRIDPARAMS10000000002{}",
    },
    svg: "<svg><path d=\"M0&1\"/></svg>",
  };
  const binary = projectSignature.payload(state);
  assert.equal(
    decoder.decode(binary.subarray(0, PARAMS_MAGIC.length)),
    PARAMS_MAGIC,
  );
  const declaredBytes = Number(decoder.decode(binary.subarray(
    PARAMS_MAGIC.length,
    PARAMS_MAGIC.length + 10,
  )));
  assert.equal(declaredBytes, binary.length - PARAMS_MAGIC.length - 10);
  assert.deepEqual(projectSignature.extract(binary), state);

  const svgText = projectSignature.svgText(state);
  assert.match(svgText, /^CIRCLEGRIDPARAMS1B\d{10}[A-Za-z0-9+/]+=*$/);
  const declaredBase64 = Number(svgText.slice(
    PARAMS_MAGIC.length + 1,
    PARAMS_MAGIC.length + 11,
  ));
  assert.equal(declaredBase64, svgText.length - PARAMS_MAGIC.length - 11);
  assert.deepEqual(
    projectSignature.extract(`<metadata id="circle-grid-params">${svgText}</metadata>`),
    state,
  );
});

test("signature extraction skips malformed candidates and rejects truncation", () => {
  const valid = projectSignature.payload({ app: "circle-grid", params: { amount: 4 } });
  const malformed = encoder.encode(`${PARAMS_MAGIC}0000000004nope`);
  assert.deepEqual(
    projectSignature.extract(concatenate(malformed, valid)),
    { app: "circle-grid", params: { amount: 4 } },
  );
  assert.equal(projectSignature.extract(valid.subarray(0, valid.length - 1)), null);
  assert.equal(
    projectSignature.extract(encoder.encode(`${PARAMS_MAGIC}00000000x2{}`)),
    null,
  );

  const tiny = createSignature(PARAMS_MAGIC, { maxPayloadBytes: 10 });
  assert.throws(
    () => tiny.payload({ params: "far too large" }),
    /between 1 and 10 UTF-8 bytes/,
  );
  assert.throws(
    () => projectSignature.mp4Box(Uint8Array.of(1, 2, 3)),
    /not a complete binary payload/,
  );
});

test("signature extraction can skip valid payloads rejected by the application", () => {
  const unrelated = projectSignature.payload({ app: "another-project", version: 1 });
  const expected = { app: "circle-grid", project: "circle-grid", version: 1 };
  const matching = projectSignature.payload(expected);
  assert.deepEqual(
    projectSignature.extract(
      concatenate(unrelated, matching),
      value => value.app === "circle-grid" && value.project === "circle-grid",
    ),
    expected,
  );
});

test("PNG stamping writes one valid uncompressed iTXt chunk immediately before IEND", () => {
  const source = onePixelPng();
  const state = { app: "circle-grid", params: { text: "hello 🟣" } };
  const stamped = projectSignature.stampPng(source, projectSignature.payload(state));
  const chunks = readPngChunks(stamped);
  assert.deepEqual(chunks.map(chunk => chunk.type), ["IHDR", "IDAT", "iTXt", "IEND"]);

  const metadata = chunks.at(-2);
  assert.equal(iTxtKeyword(metadata), PARAMS_PNG_KEYWORD);
  const separator = metadata.data.indexOf(0);
  assert.deepEqual(
    Array.from(metadata.data.subarray(separator + 1, separator + 5)),
    [0, 0, 0, 0],
  );
  assert.equal(
    metadata.storedCrc,
    referenceCrc32(concatenate(encoder.encode("iTXt"), metadata.data)),
  );
  assert.deepEqual(projectSignature.extract(stamped), state);
});

test("PNG restamping replaces only the matching keyword and preserves other iTXt chunks", () => {
  const otherSignature = createSignature("OTHERPARAMS1", {
    pngKeyword: "other-params",
  });
  const withOther = otherSignature.stampPng(onePixelPng(), { other: true });
  const first = projectSignature.stampPng(withOther, { version: 1 });
  const second = projectSignature.stampPng(first, { version: 2 });
  const chunks = readPngChunks(second);
  assert.deepEqual(
    chunks.filter(chunk => chunk.type === "iTXt").map(iTxtKeyword).sort(),
    ["circle-grid-params", "other-params"],
  );
  assert.deepEqual(projectSignature.extract(second), { version: 2 });
  assert.throws(
    () => projectSignature.stampPng(Uint8Array.of(1, 2, 3), {}),
    /not a PNG/,
  );
});

test("MP4 metadata is a valid top-level skip box and can be appended without mutation", () => {
  const state = { app: "circle-grid", params: { fps: 60 } };
  const source = Uint8Array.of(0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70);
  const box = projectSignature.mp4Box(state);
  const boxView = new DataView(box.buffer, box.byteOffset, box.byteLength);
  assert.equal(boxView.getUint32(0), box.length);
  assert.equal(decoder.decode(box.subarray(4, 8)), "skip");
  assert.deepEqual(projectSignature.extract(box), state);

  const stamped = projectSignature.stampMp4(source, state);
  assert.deepEqual(stamped.subarray(0, source.length), source);
  assert.deepEqual(projectSignature.extract(stamped), state);
  assert.deepEqual(source, Uint8Array.of(0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70));
});

test("known-key restoration cannot inject fields unknown to the current app", () => {
  const target = { width: 1920, height: 1080 };
  const returned = mergeKnownKeys(target, { width: 800, futureOption: true });
  assert.strictEqual(returned, target);
  assert.deepEqual(target, { width: 800, height: 1080 });
});
