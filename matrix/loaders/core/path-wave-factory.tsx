"use client";

import type { CSSProperties } from "react";

import { DotMatrixBase } from "../base/dot-matrix-base";
import { useDotMatrixPhases } from "./phases";
import { usePrefersReducedMotion } from "../hooks/use-prefers-reduced-motion";
import type {
  DotAnimationContext,
  DotAnimationResolver,
  DotMatrixCommonProps
} from "../types";

type NormFn = (ctx: Pick<DotAnimationContext, "row" | "col" | "index">) => number;

export function createPathWaveResolver(getPathNorm: NormFn): DotAnimationResolver {
  return ({ isActive, row, col, index, reducedMotion, phase }) => {
    if (!isActive) {
      return { className: "dmx-inactive" };
    }

    const path = getPathNorm({ row, col, index });
    const style = { "--dmx-path": path } as CSSProperties;

    if (reducedMotion || phase === "idle") {
      return {
        style: {
          ...style,
          opacity: 0.12 + path * 0.72
        }
      };
    }

    return { className: "dmx-path", style };
  };
}

type PathWaveComponentProps = DotMatrixCommonProps;

export function createPathWaveComponent(displayName: string, getPathNorm: NormFn) {
  const resolve = createPathWaveResolver(getPathNorm);

  function PathWaveComponent({
    pattern = "full",
    animated = true,
    hoverAnimated = false,
    speed = 1,
    ...rest
  }: PathWaveComponentProps) {
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
        reducedMotion={reducedMotion}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        animationResolver={resolve}
      />
    );
  }

  PathWaveComponent.displayName = displayName;
  return PathWaveComponent;
}
