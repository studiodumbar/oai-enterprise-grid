import { crc32 } from "./crc32.js";

const UTF8_ENCODER = new TextEncoder();
const UTF8_FILENAME_FLAG = 0x0800;
const STORE_METHOD = 0;
const DOS_EPOCH_DATE = 0x0021; // 1980-01-01, ZIP's earliest representable date
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

function entryBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "string") return UTF8_ENCODER.encode(value);
  throw new TypeError(
    "ZIP entry data must be a string, ArrayBuffer, or typed-array view.",
  );
}

function prepareEntries(entries) {
  if (!Array.isArray(entries)) throw new TypeError("ZIP entries must be an array.");
  if (entries.length > UINT16_MAX) {
    throw new RangeError("Store-only ZIP does not support ZIP64 entry counts.");
  }

  return entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(`ZIP entry ${index} must be an object.`);
    }
    if (typeof entry.name !== "string" || entry.name.length === 0) {
      throw new TypeError(`ZIP entry ${index} needs a non-empty filename.`);
    }
    if (entry.name.includes("\0")) {
      throw new TypeError(`ZIP entry ${index} filename cannot contain NUL.`);
    }

    const nameBytes = UTF8_ENCODER.encode(entry.name);
    if (nameBytes.length > UINT16_MAX) {
      throw new RangeError(`ZIP entry ${index} filename is too long.`);
    }
    const data = entryBytes(entry.data);
    if (data.length > UINT32_MAX) {
      throw new RangeError(`ZIP entry ${index} requires unsupported ZIP64 sizes.`);
    }
    return {
      nameBytes,
      data,
      crc: crc32(data),
      localOffset: 0,
    };
  });
}

/**
 * Builds a dependency-free ZIP using compression method 0 (store).
 *
 * PNG frames are already compressed, so deflating them again saves little and
 * only slows export. Filenames are always marked UTF-8. ZIP64 is deliberately
 * rejected instead of emitting truncated 16/32-bit fields.
 */
export function createZipBytes(entries) {
  const files = prepareEntries(entries);
  let localSize = 0;
  let centralSize = 0;
  for (const file of files) {
    file.localOffset = localSize;
    localSize += 30 + file.nameBytes.length + file.data.length;
    centralSize += 46 + file.nameBytes.length;
    if (localSize > UINT32_MAX || centralSize > UINT32_MAX) {
      throw new RangeError("Store-only ZIP does not support ZIP64 offsets or sizes.");
    }
  }

  const totalSize = localSize + centralSize + 22;
  if (totalSize > UINT32_MAX) {
    throw new RangeError("Store-only ZIP does not support ZIP64 archives.");
  }

  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);
  let offset = 0;

  for (const file of files) {
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true); // version needed: ZIP 2.0
    view.setUint16(offset + 6, UTF8_FILENAME_FLAG, true);
    view.setUint16(offset + 8, STORE_METHOD, true);
    view.setUint16(offset + 10, 0, true); // 00:00:00
    view.setUint16(offset + 12, DOS_EPOCH_DATE, true);
    view.setUint32(offset + 14, file.crc, true);
    view.setUint32(offset + 18, file.data.length, true);
    view.setUint32(offset + 22, file.data.length, true);
    view.setUint16(offset + 26, file.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    output.set(file.nameBytes, offset + 30);
    output.set(file.data, offset + 30 + file.nameBytes.length);
    offset += 30 + file.nameBytes.length + file.data.length;
  }

  const centralOffset = offset;
  for (const file of files) {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true); // version made by
    view.setUint16(offset + 6, 20, true); // version needed
    view.setUint16(offset + 8, UTF8_FILENAME_FLAG, true);
    view.setUint16(offset + 10, STORE_METHOD, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, DOS_EPOCH_DATE, true);
    view.setUint32(offset + 16, file.crc, true);
    view.setUint32(offset + 20, file.data.length, true);
    view.setUint32(offset + 24, file.data.length, true);
    view.setUint16(offset + 28, file.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true); // extra length
    view.setUint16(offset + 32, 0, true); // comment length
    view.setUint16(offset + 34, 0, true); // disk number
    view.setUint16(offset + 36, 0, true); // internal attributes
    view.setUint32(offset + 38, 0, true); // external attributes
    view.setUint32(offset + 42, file.localOffset, true);
    output.set(file.nameBytes, offset + 46);
    offset += 46 + file.nameBytes.length;
  }

  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, files.length, true);
  view.setUint16(offset + 10, files.length, true);
  view.setUint32(offset + 12, offset - centralOffset, true);
  view.setUint32(offset + 16, centralOffset, true);
  view.setUint16(offset + 20, 0, true);

  return output;
}

export function createZip(entries) {
  return new Blob([createZipBytes(entries)], { type: "application/zip" });
}

// Explicit aliases make call sites self-documenting while retaining the API
// used by the team's previous export toolkit.
export const createStoreZipBytes = createZipBytes;
export const createStoreZip = createZip;

export default createZip;
