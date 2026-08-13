"use client";

import { createPathWaveComponent } from "../core/path-wave-factory";
import { snakePathNormFromIndex } from "../core/grid-paths";
import type { DotMatrixCommonProps } from "../types";

export type DotmSquare21Props = DotMatrixCommonProps;

export const DotmSquare21 = createPathWaveComponent("DotmSquare21", ({ index }) =>
  snakePathNormFromIndex(index)
);
