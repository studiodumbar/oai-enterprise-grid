import { debug } from "../debug/index.js";
import {
  CIRCLE_TAU,
  GRID_FACE_PALETTE_STEP_COUNT,
  MAX_GRID_FACE_LEVEL,
} from "../generators/grid-scene-strategies.js";
import { runPathfindingSearch } from "../generators/pathfinding-strategies.js";

const LOADING_LEVEL = 2;
const LOADING_SUBDIVISIONS = 1 << LOADING_LEVEL;
const LOADING_GLYPH_COUNT = LOADING_SUBDIVISIONS ** 2;

// Rank the 4x4 glyphs by angle from twelve o'clock. Canvas y increases
// downward, so increasing atan2 angles already travel clockwise on screen.
const LOADING_CLOCKWISE_RANKS = Object.freeze((() => {
  const center = (LOADING_SUBDIVISIONS - 1) * 0.5;
  const glyphs = Array.from({ length: LOADING_GLYPH_COUNT }, (_, index) => {
    const x = index % LOADING_SUBDIVISIONS - center;
    const y = Math.floor(index / LOADING_SUBDIVISIONS) - center;
    return {
      index,
      angle: (Math.atan2(y, x) + Math.PI * 0.5 + CIRCLE_TAU) % CIRCLE_TAU,
      radius: x * x + y * y,
    };
  });
  glyphs.sort((a, b) => (
    a.angle - b.angle
    || b.radius - a.radius
    || a.index - b.index
  ));
  const ranks = new Array(LOADING_GLYPH_COUNT);
  glyphs.forEach((glyph, rank) => {
    ranks[glyph.index] = rank;
  });
  return ranks;
})());

export const DEFAULT_DIJKSTRA_ENDPOINT_SETTINGS = Object.freeze({
  pathFraction: 0.4,
  blinkFraction: 0.2,
  centerHoldFraction: 0.1,
  blinkCount: 2,
  trailLength: 1,
  maximumLevel: MAX_GRID_FACE_LEVEL,
  paletteStep: 3,
  cleanupAcceleration: 2,
  foreignTerritoryCost: 3,
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function requireFraction(value, label) {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new RangeError(`${label} must be between zero and one.`);
  }
  return value;
}

function requireUnitInterval(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be between zero and one inclusive.`);
  }
  return value;
}

function loadingPaletteSteps(progress, paletteStep) {
  const peakStep = Math.min(
    GRID_FACE_PALETTE_STEP_COUNT - 1,
    paletteStep,
  );
  const phase = ((progress % 1) + 1) % 1;
  const head = Math.floor(phase * LOADING_GLYPH_COUNT)
    % LOADING_GLYPH_COUNT;
  return LOADING_CLOCKWISE_RANKS.map(rank => {
    const distance = (head - rank + LOADING_GLYPH_COUNT)
      % LOADING_GLYPH_COUNT;
    return Math.max(0, peakStep - distance);
  });
}

export class DijkstraCompositionEndpoint {
  constructor(options = {}) {
    const defaults = DEFAULT_DIJKSTRA_ENDPOINT_SETTINGS;
    this.pathFraction = requireFraction(
      options.pathFraction ?? defaults.pathFraction,
      "dijkstra endpoint pathFraction",
    );
    this.blinkFraction = requireFraction(
      options.blinkFraction ?? defaults.blinkFraction,
      "dijkstra endpoint blinkFraction",
    );
    if (this.pathFraction + this.blinkFraction >= 1) {
      throw new RangeError(
        "dijkstra endpoint pathFraction and blinkFraction must total less than one.",
      );
    }
    this.centerHoldFraction = requireFraction(
      options.centerHoldFraction ?? defaults.centerHoldFraction,
      "dijkstra endpoint centerHoldFraction",
    );
    if (this.pathFraction + this.blinkFraction + this.centerHoldFraction >= 1) {
      throw new RangeError(
        "dijkstra endpoint pathFraction, blinkFraction, and centerHoldFraction "
        + "must total less than one.",
      );
    }
    this.blinkCount = options.blinkCount ?? defaults.blinkCount;
    if (!Number.isSafeInteger(this.blinkCount) || this.blinkCount < 1) {
      throw new RangeError("dijkstra endpoint blinkCount must be a positive integer.");
    }
    this.trailLength = requireUnitInterval(
      options.trailLength ?? defaults.trailLength,
      "dijkstra endpoint trailLength",
    );
    this.maximumLevel = options.maximumLevel ?? defaults.maximumLevel;
    if (
      !Number.isSafeInteger(this.maximumLevel)
      || this.maximumLevel < 1
      || this.maximumLevel > MAX_GRID_FACE_LEVEL
    ) {
      throw new RangeError(
        `dijkstra endpoint maximumLevel must be between 1 and ${MAX_GRID_FACE_LEVEL}.`,
      );
    }
    this.paletteStep = options.paletteStep ?? defaults.paletteStep;
    if (!Number.isSafeInteger(this.paletteStep) || this.paletteStep < 0) {
      throw new RangeError("dijkstra endpoint paletteStep must be a non-negative integer.");
    }
    this.cleanupAcceleration = options.cleanupAcceleration
      ?? defaults.cleanupAcceleration;
    if (!Number.isFinite(this.cleanupAcceleration) || this.cleanupAcceleration < 1) {
      throw new RangeError("dijkstra endpoint cleanupAcceleration must be at least one.");
    }
    this.foreignTerritoryCost = options.foreignTerritoryCost
      ?? defaults.foreignTerritoryCost;
    if (!Number.isFinite(this.foreignTerritoryCost) || this.foreignTerritoryCost < 1) {
      throw new RangeError(
        "dijkstra endpoint foreignTerritoryCost must be at least one.",
      );
    }
    this.plan = null;
    this.planKey = null;
    this.lastStage = null;
  }

  centerIndex(layout) {
    const column = Math.round(layout.columns * 0.5 - 0.5);
    const row = Math.round(layout.rows * 0.5 - 0.5);
    return row * layout.columns + column;
  }

  startIndex(layout, scene) {
    const index = scene?.endpointCellIndex;
    const cellCount = layout.columns * layout.rows;
    if (
      !Number.isSafeInteger(index)
      || index < 0
      || index >= cellCount
    ) {
      throw new Error(
        "dijkstra endpoint needs one endpoint parent cell.",
      );
    }
    return index;
  }

  createPlan({ layout, scene, cycleIndex = 0 }) {
    const startIndex = this.startIndex(layout, scene);
    const centerIndex = this.centerIndex(layout);
    const cellCount = layout.columns * layout.rows;
    const territoryByIndex = scene.territoryByIndex;
    const startTerritory = Array.isArray(territoryByIndex)
      ? territoryByIndex[startIndex]
      : null;
    const traversalCosts = Array.from({ length: cellCount }, (_, index) => (
      startTerritory !== null && territoryByIndex[index] !== startTerritory
        ? this.foreignTerritoryCost
        : 1
    ));
    const search = runPathfindingSearch({
      strategy: "dijkstra",
      layout,
      startIndex,
      goalIndex: centerIndex,
      traversalCosts,
    });
    if (!search.found) {
      throw new Error(
        `dijkstra endpoint could not reach center cell ${centerIndex} from ${startIndex}.`,
      );
    }
    const removableCount = Math.max(0, search.pathIndices.length - 1);
    const changingCellCount = removableCount === 0
      ? 0
      : 1 + Math.round(this.trailLength * (removableCount - 1));
    debug.transition(
      "endpoint=end mode=dijkstra grid=parent cycle=%d start=%d center=%d path=%d changing=%d trail=%.3f cost=%.3f",
      cycleIndex,
      startIndex,
      centerIndex,
      search.pathIndices.length,
      changingCellCount,
      this.trailLength,
      search.pathCost,
    );
    return {
      cycleIndex,
      startIndex,
      centerIndex,
      pathIndices: search.pathIndices,
      changingCellCount,
      pathCost: search.pathCost,
      layout: { ...layout },
      cellCount,
    };
  }

  prepare({ layout, scene, cycleIndex = 0 }) {
    const key = [
      cycleIndex,
      layout.columns,
      layout.rows,
      scene?.endpointCellIndex,
    ].join(":");
    if (key !== this.planKey) {
      this.plan = this.createPlan({ layout, scene, cycleIndex });
      this.planKey = key;
      this.lastStage = null;
    }
    return this.plan;
  }

  loadingEndProgress(plan) {
    return this.pathFraction / Math.max(1, plan.pathIndices.length);
  }

  stageAt(progress, plan) {
    const amount = clamp01(progress);
    if (amount < this.loadingEndProgress(plan)) return "loading";
    if (amount < this.pathFraction) return "path";
    if (amount < this.pathFraction + this.blinkFraction) return "blink";
    if (amount >= 1 - this.centerHoldFraction) return "center";
    return "subdivide";
  }

  visiblePathLength(plan, progress) {
    if (plan.pathIndices.length <= 1) return 1;
    const local = clamp01(progress / this.pathFraction);
    return Math.min(
      plan.pathIndices.length,
      1 + Math.floor(local * plan.pathIndices.length),
    );
  }

  blinkVisible(progress) {
    const local = clamp01(
      (progress - this.pathFraction) / this.blinkFraction,
    );
    if (local >= 1) return true;
    return Math.floor(local * this.blinkCount * 2) % 2 === 0;
  }

  enterStage(stage, cycleIndex) {
    if (stage === this.lastStage) return;
    debug.transition(
      "endpoint=end mode=dijkstra stage=%s cycle=%d",
      stage,
      cycleIndex,
    );
    this.lastStage = stage;
  }

  endpointFrame(plan, stage, cells) {
    const cleanupStage = stage === "subdivide" || stage === "center";
    return {
      stage,
      cells,
      layout: plan.layout,
      paletteStep: this.paletteStep,
      flicker: cleanupStage,
      flickerAmount: cleanupStage ? 1 : 0,
      pathIndices: [...plan.pathIndices],
      changingCellCount: plan.changingCellCount,
      trailLength: this.trailLength,
      centerIndex: plan.centerIndex,
    };
  }

  loadingCell(plan, progress) {
    return {
      index: plan.startIndex,
      level: LOADING_LEVEL,
      paletteSteps: loadingPaletteSteps(progress, this.paletteStep),
    };
  }

  preparationFrameAt({ layout, scene, cycleIndex = 0, progress = 0 }) {
    const plan = this.prepare({ layout, scene, cycleIndex });
    this.enterStage("loading", cycleIndex);
    return this.endpointFrame(
      plan,
      "loading",
      [this.loadingCell(plan, clamp01(progress))],
    );
  }

  frameAt({ layout, scene, cycleIndex = 0, progress = 0 }) {
    const plan = this.prepare({ layout, scene, cycleIndex });
    const amount = clamp01(progress);
    const stage = this.stageAt(amount, plan);
    this.enterStage(stage, cycleIndex);
    const cells = [];
    const drawCell = (index, level = 0) => cells.push({ index, level });

    if (stage === "loading") {
      cells.push(this.loadingCell(
        plan,
        1 + amount / this.loadingEndProgress(plan),
      ));
    } else if (stage === "path") {
      for (const index of plan.pathIndices.slice(0, this.visiblePathLength(plan, amount))) {
        drawCell(index);
      }
    } else if (stage === "blink") {
      if (this.blinkVisible(amount)) {
        for (const index of plan.pathIndices) drawCell(index);
      }
    } else if (stage === "subdivide") {
      const removableCount = Math.max(0, plan.pathIndices.length - 1);
      const local = clamp01(
        (amount - this.pathFraction - this.blinkFraction)
          / (1 - this.pathFraction - this.blinkFraction - this.centerHoldFraction),
      );
      const cascadeDistance = Math.max(
        0,
        removableCount + plan.changingCellCount - 1,
      );
      const cascadePosition = local ** this.cleanupAcceleration * cascadeDistance;
      for (let order = 0; order < removableCount; order += 1) {
        const cellAmount = (cascadePosition - order) / plan.changingCellCount;
        if (cellAmount >= 1) continue;
        const level = cellAmount <= 0
          ? 0
          : Math.min(
            this.maximumLevel,
            1 + Math.floor(cellAmount * this.maximumLevel),
          );
        drawCell(plan.pathIndices[order], level);
      }
      drawCell(plan.centerIndex);
    } else {
      drawCell(plan.centerIndex);
    }

    return this.endpointFrame(plan, stage, cells);
  }

  reset() {
    this.plan = null;
    this.planKey = null;
    this.lastStage = null;
  }

  inspect() {
    return {
      mode: "dijkstra",
      stage: this.lastStage,
      pathIndices: [...(this.plan?.pathIndices ?? [])],
      changingCellCount: this.plan?.changingCellCount ?? null,
      trailLength: this.trailLength,
      centerIndex: this.plan?.centerIndex ?? null,
      pathCost: this.plan?.pathCost ?? null,
    };
  }
}
