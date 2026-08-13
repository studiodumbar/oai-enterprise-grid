/**
 * Inline `style` helpers so SSR and the client produce the same serialized CSS
 * (React/Next can emit "Npx" and rounded opacity in HTML while the tree uses numbers).
 */

export function stylePx(n: number): string {
  return `${n}px`;
}

export function styleOpacity(opacity: number): number {
  return Math.round(opacity * 1e6) / 1e6;
}
