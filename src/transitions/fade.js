import {
  cubicBezierAt,
  normalizeBezierCurve,
} from "../core/cubic-bezier.js";
import {
  firstPoseFlags,
  normalizeArrangementItems,
} from "./arrangement-items.js";

const IDENTITY_PRESENTATION = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  opacity: 1,
  scale: 1,
});

export const DEFAULT_FADE_SETTINGS = Object.freeze({
  revealFraction: 0.5,
  timingCurve: Object.freeze([0.42, 0, 0.58, 1]),
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Opacity-only arrangement. Nothing moves: the source pose fades up over the
 * first `revealFraction` of the phase, then crossfades into the target pose
 * over the remainder. Driven from the circle endpoint the source pose is the
 * centered parent cell, so an intro reads as "one big circle grid appears, then
 * dissolves into the composition"; an outro plays the same plan backward.
 *
 * With no source items the reveal window is skipped and the phase is a plain
 * fade-in of the target scene, which is what a cycle-boundary intro with no
 * previous scene should look like.
 */
export class FadeArrangementMode {
  constructor(options = {}) {
    const revealFraction = options.revealFraction
      ?? DEFAULT_FADE_SETTINGS.revealFraction;
    const timingCurve = normalizeBezierCurve(
      options.timingCurve ?? DEFAULT_FADE_SETTINGS.timingCurve,
      "fade timingCurve",
    );
    if (
      !Number.isFinite(revealFraction)
      || revealFraction < 0
      || revealFraction >= 1
    ) {
      throw new RangeError(
        "fade revealFraction must be at least zero and below one.",
      );
    }
    this.revealFraction = revealFraction;
    this.timingCurve = Object.freeze(timingCurve);
  }

  createPlan({
    items,
    indices,
    fromItems,
    layout,
    key = "scene",
    durationSeconds = 1,
  }) {
    const targets = normalizeArrangementItems({ items, indices, layout }, "fade");
    const sources = fromItems === undefined
      ? []
      : normalizeArrangementItems({ items: fromItems, layout }, "fade source");
    const targetOrderById = new Map(
      targets.map((target, order) => [target.id, order]),
    );
    // Plan totality (REFACTOR_PLAN.md §2.3): every source is carried by some
    // target and every target fades in, so neither side can be silently
    // dropped when the two sets differ in size. There is no offscreen
    // fallback — a fade never needs one.
    const sourcesByOrder = targets.map(() => []);
    if (targets.length > 0) {
      sources.forEach((source, index) => {
        sourcesByOrder[index % targets.length].push(source);
      });
    }
    const drawsTarget = firstPoseFlags(targets);
    const totalDurationSeconds = Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : 1;
    return {
      targets,
      targetOrderById,
      sourcesByOrder,
      drawsTarget,
      // A reveal window is only meaningful when there is something to reveal.
      revealFraction: sources.length > 0 ? this.revealFraction : 0,
      totalDurationSeconds,
      staggerSeconds: 0,
      key,
      fadeIn: sources.length === 0,
      sourceItemCount: sources.length,
      // Sources that no target can carry. Only reachable with an empty target
      // set, which means the scene has nothing to draw at all.
      unpairedSources: targets.length === 0 ? sources.length : 0,
    };
  }

  eased(amount) {
    return cubicBezierAt(clamp01(amount), this.timingCurve);
  }

  crossfadeAt(plan, amount) {
    return this.eased(
      (amount - plan.revealFraction) / (1 - plan.revealFraction),
    );
  }

  /**
   * A fade needs two poses on screen at once, so the multi-presentation port is
   * the primary one here. Callers limited to a single presentation get the
   * target pose, which is the one every renderer already knows how to draw.
   */
  presentationsAt(plan, targetId, progress) {
    const order = plan.targetOrderById.get(targetId);
    if (order === undefined) return [IDENTITY_PRESENTATION];
    const amount = clamp01(progress);
    if (amount >= 1) {
      return plan.drawsTarget[order] ? [IDENTITY_PRESENTATION] : [];
    }

    const target = plan.targets[order];
    const reveal = plan.revealFraction > 0
      ? this.eased(amount / plan.revealFraction)
      : 1;
    const crossfade = this.crossfadeAt(plan, amount);
    const sourceOpacity = reveal * (1 - crossfade);

    const presentations = [];
    if (sourceOpacity > 0) {
      for (const source of plan.sourcesByOrder[order]) {
        presentations.push({
          offsetX: source.x - target.x,
          offsetY: source.y - target.y,
          opacity: sourceOpacity,
          scale: source.size / target.size,
        });
      }
    }
    if (plan.drawsTarget[order]) {
      presentations.push({
        offsetX: 0,
        offsetY: 0,
        opacity: crossfade,
        scale: 1,
      });
    }
    return presentations;
  }

  presentationAt(plan, targetId, progress) {
    const order = plan.targetOrderById.get(targetId);
    if (order === undefined) return IDENTITY_PRESENTATION;
    const amount = clamp01(progress);
    if (amount >= 1) return IDENTITY_PRESENTATION;
    return {
      offsetX: 0,
      offsetY: 0,
      opacity: this.crossfadeAt(plan, amount),
      scale: 1,
    };
  }
}
