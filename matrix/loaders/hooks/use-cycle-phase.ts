"use client";

import { useEffect, useState } from "react";

export interface UseCyclePhaseOptions {
  /** When false, phase is held at 0. */
  active: boolean;
  /** Loop duration in ms at speed = 1. */
  cycleMsBase: number;
  /** Larger values shorten the loop (same convention as DotMatrixCommonProps.speed). */
  speed?: number;
}

/**
 * Normalized phase in [0, 1) advancing linearly over one cycle, for opacity-only math in loaders.
 */
export function useCyclePhase({ active, cycleMsBase, speed = 1 }: UseCyclePhaseOptions): number {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) {
      setPhase(0);
      return;
    }

    const safeSpeed = speed > 0 ? speed : 1;
    const raw = cycleMsBase / safeSpeed;
    const cycleMs = raw > 0 && Number.isFinite(raw) ? raw : 1000;
    const start = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      // Positive modulo so elapsed stays in [0, cycleMs); JS % can be negative when (now - start) < 0.
      const elapsed = ((now - start) % cycleMs + cycleMs) % cycleMs;
      setPhase(elapsed / cycleMs);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [active, cycleMsBase, speed]);

  return phase;
}
