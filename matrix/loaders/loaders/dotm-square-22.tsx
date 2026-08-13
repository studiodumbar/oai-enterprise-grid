"use client";

import { createPathWaveComponent } from "../core/path-wave-factory";
import { colWaveNormFromIndex } from "../core/grid-paths";
import type { DotMatrixCommonProps } from "../types";

export type DotmSquare22Props = DotMatrixCommonProps;

export const DotmSquare22 = createPathWaveComponent("DotmSquare22", ({ index }) =>
  colWaveNormFromIndex(index)
);
