"use client";

import { createPathWaveComponent } from "../core/path-wave-factory";
import { concentricRingNormFromIndex } from "../core/grid-paths";
import type { DotMatrixCommonProps } from "../types";

export type DotmSquare23Props = DotMatrixCommonProps;

export const DotmSquare23 = createPathWaveComponent("DotmSquare23", ({ index }) =>
  concentricRingNormFromIndex(index)
);
