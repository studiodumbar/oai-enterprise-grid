// CRC-32/ISO-HDLC (the checksum used by PNG and ZIP).
//
// Passing a previously returned checksum continues the calculation, so callers
// can checksum several byte ranges without first concatenating them:
//
//   crc32(second, crc32(first)) === crc32([...first, ...second])


const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1
        ? 0xedb88320 ^ (value >>> 1)
        : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function byteView(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("CRC-32 input must be an ArrayBuffer or typed-array view.");
}

export function crc32(input, previous = 0) {
  const bytes = byteView(input);
  if (!Number.isInteger(previous) || previous < 0 || previous > 0xffffffff) {
    throw new RangeError("Previous CRC-32 value must be an unsigned 32-bit integer.");
  }

  let checksum = (previous ^ 0xffffffff) >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    checksum = CRC_TABLE[(checksum ^ bytes[index]) & 0xff] ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

export default crc32;
