"use client";

import type { CSSProperties } from "react";

import { DotMatrixBase } from "../base/dot-matrix-base";
import { useDotMatrixPhases } from "../core/phases";
import {
  middleRingAntiClockwiseNormFromIndex,
  middleRingAntiClockwiseOrderValue,
  outerRingClockwiseNormFromIndex,
  outerRingClockwiseOrderValue
} from "../core/grid-paths";
import { usePrefersReducedMotion } from "../hooks/use-prefers-reduced-motion";
import type { DotAnimationResolver, DotMatrixCommonProps } from "../types";

export type DotmSquare4Props = DotMatrixCommonProps;

const animationResolver: DotAnimationResolver = ({ isActive, index, row, col, reducedMotion, phase }) => {
  if (!isActive) {
    return { className: "dmx-inactive" };
  }

  const isCenter = row === 2 && col === 2;
  if (isCenter) {
    return { className: "dmx-inactive" };
  }

  const outerOrder = outerRingClockwiseOrderValue(index);
  if (outerOrder >= 0) {
    const outerNorm = outerRingClockwiseNormFromIndex(index);
    const style = { "--dmx-outer-order": outerOrder } as CSSProperties;
    if (reducedMotion || phase === "idle") {
      return {
        style: {
          ...style,
          opacity: 0.2 + outerNorm * 0.72
        }
      };
    }
    return { className: "dmx-outer-snake", style };
  }

  const middleOrder = middleRingAntiClockwiseOrderValue(index);
  const middleNorm = middleRingAntiClockwiseNormFromIndex(index);
  const style = { "--dmx-middle-order": middleOrder } as CSSProperties;
  if (reducedMotion || phase === "idle") {
    return {
      style: {
        ...style,
        opacity: 0.2 + middleNorm * 0.72
      }
    };
  }

  return { className: "dmx-middle-snake", style };
};

export function DotmSquare4({
  speed = 1,
  pattern = "full",
  animated = true,
  hoverAnimated = false,
  ...rest
}: DotmSquare4Props) {
  const reducedMotion = usePrefersReducedMotion();
  const { phase: matrixPhase, onMouseEnter, onMouseLeave } = useDotMatrixPhases({
    animated: Boolean(animated && !reducedMotion),
    hoverAnimated: Boolean(hoverAnimated && !reducedMotion),
    speed
  });

  return (
    <DotMatrixBase
      {...rest}
      speed={speed}
      pattern={pattern}
      animated={animated}
      phase={matrixPhase}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      reducedMotion={reducedMotion}
      animationResolver={animationResolver}
    />
  );
}
