import { MATRIX_SIZE } from "./patterns";

export function getMatrix5Layout(
  size: number,
  dotSize: number,
  cellPadding?: number
): { gap: number; matrixSpan: number } {
  const n = MATRIX_SIZE;
  if (cellPadding != null) {
    const gap = Math.max(0, cellPadding);
    const matrixSpan = dotSize * n + gap * (n - 1);
    return { gap, matrixSpan };
  }
  const gap = Math.max(1, Math.floor((size - dotSize * n) / (n - 1)));
  return { gap, matrixSpan: size };
}

export function resolveDmxBoxOuterDim(
  options: { boxSize?: number; minSize?: number } | null | undefined
): { outerDim: number; useWrapper: boolean } {
  const b = options?.boxSize;
  const hasBox = b != null && b > 0 && Number.isFinite(b);
  if (!hasBox) {
    return { outerDim: 0, useWrapper: false };
  }
  const m = options?.minSize;
  if (m != null && m > 0 && Number.isFinite(m)) {
    return { outerDim: Math.max(b, m), useWrapper: true };
  }
  return { outerDim: b, useWrapper: true };
}
