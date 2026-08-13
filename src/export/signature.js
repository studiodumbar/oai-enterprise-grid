import { crc32 } from "./crc32.js";

export const PARAMS_MAGIC = "CIRCLEGRIDPARAMS1";
export const PARAMS_PNG_KEYWORD = "circle-grid-params";
export const PARAMS_SVG_ID = "circle-grid-params";
export const DEFAULT_MAX_METADATA_BYTES = 16 * 1024 * 1024;

const PNG_SIGNATURE = Uint8Array.of(
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
);
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const TEN_DIGITS = 10;
const UINT32_MAX = 0xffffffff;

function byteView(value, label = "Binary input") {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`${label} must be an ArrayBuffer or typed-array view.`);
}

function concatenate(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function bytesMatch(bytes, offset, expected) {
  if (offset < 0 || offset + expected.length > bytes.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected[index]) return false;
  }
  return true;
}

function asciiType(bytes, offset) {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function encodedJson(value, maximum) {
  const json = JSON.stringify(value);
  if (typeof json !== "string") {
    throw new TypeError("Project metadata must be JSON-serializable.");
  }
  const bytes = UTF8_ENCODER.encode(json);
  if (bytes.length === 0 || bytes.length > maximum) {
    throw new RangeError(`Project metadata must be between 1 and ${maximum} UTF-8 bytes.`);
  }
  return bytes;
}

function lengthPrefix(length) {
  const digits = String(length);
  if (!Number.isSafeInteger(length) || length <= 0 || digits.length > TEN_DIGITS) {
    throw new RangeError("Project metadata length cannot fit its 10-digit prefix.");
  }
  return digits.padStart(TEN_DIGITS, "0");
}

function decimalLengthAt(bytes, offset) {
  if (offset < 0 || offset + TEN_DIGITS > bytes.length) return null;
  let value = 0;
  for (let index = 0; index < TEN_DIGITS; index += 1) {
    const digit = bytes[offset + index] - 0x30;
    if (digit < 0 || digit > 9) return null;
    value = value * 10 + digit;
  }
  return value > 0 ? value : null;
}

function bytesToBase64(bytes) {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    const value = (first << 16) | (second << 8) | third;
    result += BASE64_ALPHABET[(value >>> 18) & 0x3f];
    result += BASE64_ALPHABET[(value >>> 12) & 0x3f];
    result += hasSecond ? BASE64_ALPHABET[(value >>> 6) & 0x3f] : "=";
    result += hasThird ? BASE64_ALPHABET[value & 0x3f] : "=";
  }
  return result;
}

function base64Value(character) {
  const code = character.charCodeAt(0);
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26;
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52;
  if (character === "+") return 62;
  if (character === "/") return 63;
  return -1;
}

function base64ToBytes(value) {
  if (value.length === 0 || value.length % 4 !== 0) {
    throw new SyntaxError("Invalid base64 metadata length.");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const result = new Uint8Array(value.length / 4 * 3 - padding);
  let output = 0;

  for (let index = 0; index < value.length; index += 4) {
    const finalGroup = index + 4 === value.length;
    const chars = value.slice(index, index + 4);
    const values = [
      base64Value(chars[0]),
      base64Value(chars[1]),
      chars[2] === "=" ? 0 : base64Value(chars[2]),
      chars[3] === "=" ? 0 : base64Value(chars[3]),
    ];
    if (
      values.some(number => number < 0)
      || chars[0] === "="
      || chars[1] === "="
      || (!finalGroup && (chars[2] === "=" || chars[3] === "="))
      || (chars[2] === "=" && chars[3] !== "=")
    ) {
      throw new SyntaxError("Invalid base64 project metadata.");
    }

    const combined = (
      (values[0] << 18)
      | (values[1] << 12)
      | (values[2] << 6)
      | values[3]
    );
    if (output < result.length) result[output++] = (combined >>> 16) & 0xff;
    if (output < result.length) result[output++] = (combined >>> 8) & 0xff;
    if (output < result.length) result[output++] = combined & 0xff;
  }
  return result;
}

function pngChunks(bytes) {
  if (!bytesMatch(bytes, 0, PNG_SIGNATURE)) {
    throw new TypeError("Cannot stamp project metadata: input is not a PNG.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const dataLength = view.getUint32(offset);
    const end = offset + 12 + dataLength;
    if (end > bytes.length) {
      throw new TypeError("Cannot stamp project metadata: PNG has a truncated chunk.");
    }
    const type = asciiType(bytes, offset + 4);
    chunks.push({ offset, end, dataLength, type });
    offset = end;
    if (type === "IEND") {
      if (dataLength !== 0) {
        throw new TypeError("Cannot stamp project metadata: PNG IEND must be empty.");
      }
      return { chunks, trailingOffset: offset };
    }
  }
  throw new TypeError("Cannot stamp project metadata: PNG has no complete IEND chunk.");
}

function hasKeyword(bytes, chunk, keywordBytes) {
  if (chunk.type !== "iTXt") return false;
  const start = chunk.offset + 8;
  const end = start + chunk.dataLength;
  const separator = bytes.indexOf(0, start);
  return separator >= start
    && separator < end
    && separator - start === keywordBytes.length
    && bytesMatch(bytes, start, keywordBytes);
}

function makeITXtChunk(keywordBytes, metadataPayload) {
  // keyword NUL, compression flag 0, compression method 0, empty language tag
  // NUL, empty translated keyword NUL, then the uncompressed UTF-8 text.
  const data = new Uint8Array(keywordBytes.length + 5 + metadataPayload.length);
  data.set(keywordBytes, 0);
  data.set(metadataPayload, keywordBytes.length + 5);

  const type = UTF8_ENCODER.encode("iTXt");
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(data, crc32(type)));
  return chunk;
}

function validateSignatureOptions(magic, pngKeyword, maximum) {
  if (typeof magic !== "string" || !/^[!-~]+$/.test(magic)) {
    throw new TypeError("Project metadata magic must be non-empty printable ASCII.");
  }
  if (typeof pngKeyword !== "string" || !/^[ -~]+$/.test(pngKeyword)) {
    throw new TypeError("PNG metadata keyword must be non-empty printable ASCII.");
  }
  const keywordLength = UTF8_ENCODER.encode(pngKeyword).length;
  if (
    keywordLength > 79
    || pngKeyword.startsWith(" ")
    || pngKeyword.endsWith(" ")
    || pngKeyword.includes("  ")
  ) {
    throw new RangeError("PNG metadata keyword must satisfy PNG's 1-79 byte limit.");
  }
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > 9_999_999_999) {
    throw new RangeError("Maximum project metadata size must fit a 10-digit length.");
  }
}

export function mergeKnownKeys(target, source) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("Known-key merge target must be an object.");
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return target;
  for (const key of Object.keys(source)) {
    if (Object.hasOwn(target, key)) target[key] = source[key];
  }
  return target;
}

/**
 * Creates one marker codec shared by PNG, MP4, and SVG exports.
 *
 * Binary payload: magic + 10-digit byte length + raw UTF-8 JSON.
 * SVG payload:    magic + "B" + 10-digit character length + base64 UTF-8 JSON.
 */
export function createSignature(
  magic = PARAMS_MAGIC,
  {
    pngKeyword = PARAMS_PNG_KEYWORD,
    maxPayloadBytes = DEFAULT_MAX_METADATA_BYTES,
  } = {},
) {
  validateSignatureOptions(magic, pngKeyword, maxPayloadBytes);
  const magicBytes = UTF8_ENCODER.encode(magic);
  const keywordBytes = UTF8_ENCODER.encode(pngKeyword);

  const payload = value => {
    const json = encodedJson(value, maxPayloadBytes);
    const header = UTF8_ENCODER.encode(magic + lengthPrefix(json.length));
    return concatenate([header, json]);
  };

  const payloadB64 = value => {
    const json = encodedJson(value, maxPayloadBytes);
    const base64 = bytesToBase64(json);
    return magic + "B" + lengthPrefix(base64.length) + base64;
  };

  const preparedPayload = value => {
    if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) {
      return payload(value);
    }
    const bytes = byteView(value, "Prepared project metadata");
    const declaredLength = bytesMatch(bytes, 0, magicBytes)
      ? decimalLengthAt(bytes, magicBytes.length)
      : null;
    if (
      declaredLength === null
      || declaredLength > maxPayloadBytes
      || magicBytes.length + TEN_DIGITS + declaredLength !== bytes.length
    ) {
      throw new TypeError("Prepared project metadata is not a complete binary payload.");
    }
    return bytes;
  };

  const extractCandidate = (bytes, offset) => {
    const contentOffset = offset + magicBytes.length;
    const base64 = bytes[contentOffset] === 0x42;
    const lengthOffset = contentOffset + (base64 ? 1 : 0);
    const length = decimalLengthAt(bytes, lengthOffset);
    if (length === null) return { valid: false };

    const start = lengthOffset + TEN_DIGITS;
    const end = start + length;
    if (end > bytes.length) return { valid: false };

    try {
      let jsonBytes;
      if (base64) {
        if (length > Math.ceil(maxPayloadBytes / 3) * 4) return { valid: false };
        const encoded = UTF8_DECODER.decode(bytes.subarray(start, end));
        jsonBytes = base64ToBytes(encoded);
      } else {
        if (length > maxPayloadBytes) return { valid: false };
        jsonBytes = bytes.subarray(start, end);
      }
      if (jsonBytes.length === 0 || jsonBytes.length > maxPayloadBytes) {
        return { valid: false };
      }
      return {
        valid: true,
        value: JSON.parse(UTF8_DECODER.decode(jsonBytes)),
      };
    } catch {
      return { valid: false };
    }
  };

  const api = {
    magic,
    pngKeyword,

    payload,
    payloadB64,

    stampPng(input, valueOrPayload) {
      const source = byteView(input, "PNG input");
      const parsed = pngChunks(source);
      const metadataPayload = preparedPayload(valueOrPayload);
      const metadataChunk = makeITXtChunk(keywordBytes, metadataPayload);
      const parts = [source.subarray(0, PNG_SIGNATURE.length)];

      for (const chunk of parsed.chunks) {
        if (chunk.type === "IEND") {
          parts.push(metadataChunk, source.subarray(chunk.offset));
          break;
        }
        if (!hasKeyword(source, chunk, keywordBytes)) {
          parts.push(source.subarray(chunk.offset, chunk.end));
        }
      }
      return concatenate(parts);
    },

    mp4Box(valueOrPayload) {
      const metadataPayload = preparedPayload(valueOrPayload);
      if (metadataPayload.length > UINT32_MAX - 8) {
        throw new RangeError("Project metadata is too large for a 32-bit MP4 skip box.");
      }
      const box = new Uint8Array(8 + metadataPayload.length);
      new DataView(box.buffer).setUint32(0, box.length);
      box.set(Uint8Array.of(0x73, 0x6b, 0x69, 0x70), 4); // "skip"
      box.set(metadataPayload, 8);
      return box;
    },

    stampMp4(input, valueOrPayload) {
      return concatenate([
        byteView(input, "MP4 input"),
        api.mp4Box(valueOrPayload),
      ]);
    },

    // Assign this string to <metadata id="circle-grid-params">. It contains no XML
    // metacharacters that an XML serializer can alter.
    svgText(value) {
      return payloadB64(value);
    },

    // The marker is uncompressed in all supported containers, so one bounded
    // scanner restores PNG, MP4, and SVG exports. Invalid marker-like content is
    // skipped in case it occurs naturally before the actual metadata payload.
    extract(input, accept) {
      if (accept !== undefined && typeof accept !== "function") {
        throw new TypeError("Project metadata accept filter must be a function.");
      }
      const bytes = typeof input === "string"
        ? UTF8_ENCODER.encode(input)
        : byteView(input, "Project metadata input");
      let offset = bytes.indexOf(magicBytes[0]);
      while (offset >= 0 && offset <= bytes.length - magicBytes.length) {
        if (bytesMatch(bytes, offset, magicBytes)) {
          const result = extractCandidate(bytes, offset);
          if (result.valid && (!accept || accept(result.value))) return result.value;
        }
        offset = bytes.indexOf(magicBytes[0], offset + 1);
      }
      return null;
    },
  };

  return Object.freeze(api);
}

export const projectSignature = createSignature();

export default projectSignature;
