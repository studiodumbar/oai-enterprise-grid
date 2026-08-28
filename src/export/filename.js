function validDate(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("Export timestamp requires a valid Date.");
  }
  return value;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function extensionName(value) {
  const extension = String(value).replace(/^\.+/, "").toLowerCase();
  if (!/^[a-z0-9]+$/.test(extension)) {
    throw new TypeError(`Invalid export extension: ${value}`);
  }
  return extension;
}

// Local wall-clock time, matching the project's export filename convention.
export function exportStamp(date = new Date()) {
  const value = validDate(date);
  return (
    pad2(value.getMonth() + 1)
    + pad2(value.getDate())
    + "-"
    + pad2(value.getHours())
    + pad2(value.getMinutes())
    + pad2(value.getSeconds())
  );
}

export const stamp = exportStamp;

// Composition ids and flicker mode names are already kebab-case, but exports can
// be triggered from the console with arbitrary strings, so anything unsafe for a
// filename is folded into single dashes. Underscores separate the name segments,
// so they are folded too. An empty result drops the segment entirely.
export function nameSegment(value) {
  if (value === undefined || value === null) return "";
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// OAI_<composition>_<flicker mode>_<variant>_MMDD-HHMMSS; missing segments drop out.
export function exportBaseName(date = new Date(), { composition, flicker, variant } = {}) {
  return [
    "OAI",
    nameSegment(composition),
    nameSegment(flicker),
    nameSegment(variant),
    exportStamp(date),
  ].filter(Boolean).join("_");
}

export function exportFilename(
  extension,
  { date = new Date(), alpha = false, composition, flicker, variant } = {},
) {
  const suffix = alpha ? "-alpha" : "";
  const base = exportBaseName(date, { composition, flicker, variant });
  return `${base}${suffix}.${extensionName(extension)}`;
}

export function exportSequenceFilename(
  index,
  {
    baseName,
    date = new Date(),
    composition,
    flicker,
    variant,
    padding = 4,
    extension = "png",
  } = {},
) {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RangeError("PNG sequence index must be a non-negative integer.");
  }
  if (!Number.isSafeInteger(padding) || padding < 4) {
    throw new RangeError("PNG sequence padding must be an integer of at least four.");
  }
  const root = baseName === undefined
    ? exportBaseName(date, { composition, flicker, variant })
    : String(baseName);
  if (root.length === 0 || /[\\/\0]/.test(root)) {
    throw new TypeError("PNG sequence base name must be a safe non-empty filename.");
  }
  return `${root}_${String(index).padStart(padding, "0")}.${extensionName(extension)}`;
}

export function sequencePadding(frameCount) {
  if (!Number.isSafeInteger(frameCount) || frameCount < 1) {
    throw new RangeError("PNG sequence frame count must be a positive integer.");
  }
  return Math.max(4, String(frameCount - 1).length);
}
