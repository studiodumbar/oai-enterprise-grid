import test from "node:test";
import assert from "node:assert/strict";

import { crc32 } from "../src/export/crc32.js";

const encoder = new TextEncoder();

test("CRC-32 matches the standard check vector and empty input", () => {
  assert.equal(crc32(encoder.encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("CRC-32 can continue across separate byte ranges", () => {
  const first = encoder.encode("deterministic ");
  const second = encoder.encode("exports");
  const combined = encoder.encode("deterministic exports");
  assert.equal(crc32(second, crc32(first)), crc32(combined));
});

test("CRC-32 respects typed-array byte offsets and validates prior values", () => {
  const padded = Uint8Array.of(99, 49, 50, 51, 52, 53, 54, 55, 56, 57, 88);
  const view = new DataView(padded.buffer, 1, 9);
  assert.equal(crc32(view), 0xcbf43926);
  assert.throws(() => crc32(view, -1), /unsigned 32-bit/);
});
