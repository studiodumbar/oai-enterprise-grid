"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DotMatrixPhase } from "../types";

interface UseDotMatrixPhasesOptions {
  animated?: boolean;
  hoverAnimated?: boolean;
  speed?: number;
}

interface DotMatrixPhasesResult {
  phase: DotMatrixPhase;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/**
 * `animated` = user wants continuous loading motion (already gated by reduced motion at call sites).
 * When `hoverAnimated` is true, auto/continuous motion is off — only pointer hover runs animation.
 */
export function useDotMatrixPhases({
  animated = false,
  hoverAnimated = false,
  speed = 1
}: UseDotMatrixPhasesOptions): DotMatrixPhasesResult {
  const safeSpeed = speed > 0 ? speed : 1;
  const autoRun = Boolean(animated && !hoverAnimated);
  const [phase, setPhase] = useState<DotMatrixPhase>(() => (autoRun ? "loadingRipple" : "idle"));
  const timeouts = useRef<number[]>([]);
  const hoverGen = useRef(0);

  const clearTimers = useCallback(() => {
    for (const id of timeouts.current) {
      window.clearTimeout(id);
    }
    timeouts.current = [];
  }, []);

  useEffect(() => {
    clearTimers();
    if (autoRun) {
      setPhase("loadingRipple");
    } else {
      setPhase("idle");
    }
    return clearTimers;
  }, [autoRun, clearTimers]);

  const onMouseEnter = useCallback(() => {
    if (!hoverAnimated || autoRun) {
      return;
    }
    clearTimers();
    const gen = ++hoverGen.current;
    setPhase("collapse");
    const collapseMs = Math.max(1, Math.round(300 / safeSpeed));
    const id = window.setTimeout(() => {
      if (hoverGen.current !== gen) {
        return;
      }
      setPhase("hoverRipple");
    }, collapseMs);
    timeouts.current.push(id);
  }, [hoverAnimated, autoRun, safeSpeed, clearTimers]);

  const onMouseLeave = useCallback(() => {
    if (!hoverAnimated || autoRun) {
      return;
    }
    hoverGen.current += 1;
    clearTimers();
    setPhase("idle");
  }, [hoverAnimated, autoRun, clearTimers]);

  return useMemo(
    () => ({
      phase,
      onMouseEnter,
      onMouseLeave
    }),
    [phase, onMouseEnter, onMouseLeave]
  );
}
