const COUNTDOWN_EFFECTS = Object.freeze(["clock", "snake", "bubbles"]);

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function requireFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`);
  }
  return value;
}

export function resolveCountdownAppearanceOrder(appearance, totalDurationSeconds) {
  const authored = requireObject(appearance, "countdownFramed.appearance");
  const order = requireObject(
    authored.order,
    "countdownFramed.appearance.order",
  );
  if (
    !Array.isArray(order.stages)
    || order.stages.length < 1
    || order.stages.length > COUNTDOWN_EFFECTS.length
  ) {
    throw new RangeError(
      "countdownFramed.appearance.order.stages must list one to three of "
      + "clock, snake, and bubbles.",
    );
  }
  const stageDefinitions = order.stages.map((authoredStage, index) => {
    const stage = requireObject(
      authoredStage,
      `countdownFramed.appearance.order.stages[${index}]`,
    );
    if (!COUNTDOWN_EFFECTS.includes(stage.effect)) {
      throw new RangeError(
        `countdownFramed.appearance.order.stages[${index}].effect must be clock, snake, or bubbles.`,
      );
    }
    if (
      !Number.isFinite(stage.evolutionStartsAt)
      || stage.evolutionStartsAt < 0
      || stage.evolutionStartsAt >= 1
    ) {
      throw new RangeError(
        `countdownFramed.appearance.order.stages[${index}].evolutionStartsAt `
        + "must be from zero up to one.",
      );
    }
    return Object.freeze({
      effect: stage.effect,
      evolutionStartsAt: stage.evolutionStartsAt,
    });
  });
  const stages = stageDefinitions.map(stage => stage.effect);
  if (new Set(stages).size !== stages.length) {
    throw new RangeError(
      "countdownFramed.appearance.order.stages cannot repeat an effect.",
    );
  }
  const durationSeconds = requireFinitePositive(
    totalDurationSeconds,
    "Countdown appearance order duration",
  );
  const stageDurationSeconds = durationSeconds / stages.length;
  const windows = stageDefinitions.map((stage, index) => {
    const startSeconds = index * stageDurationSeconds;
    const endSeconds = (index + 1) * stageDurationSeconds;
    return Object.freeze({
      effect: stage.effect,
      index,
      evolutionStartsAt: stage.evolutionStartsAt,
      startSeconds,
      endSeconds,
      durationSeconds: stageDurationSeconds,
      evolutionStartSeconds: startSeconds
        + stageDurationSeconds * stage.evolutionStartsAt,
    });
  });
  return Object.freeze({
    stages: Object.freeze([...stages]),
    stageDefinitions: Object.freeze(stageDefinitions),
    totalDurationSeconds: durationSeconds,
    stageDurationSeconds,
    windows: Object.freeze(windows),
  });
}

export function countdownAppearanceStageAt(localTime, order) {
  if (!Number.isFinite(localTime) || localTime < 0) {
    throw new RangeError("Countdown appearance order time must be non-negative.");
  }
  const duration = requireFinitePositive(
    order?.totalDurationSeconds,
    "Countdown appearance order duration",
  );
  const time = localTime % duration;
  const stageIndex = Math.min(
    order.stages.length - 1,
    Math.floor(time / order.stageDurationSeconds),
  );
  const window = order.windows[stageIndex];
  const stageProgress = Math.max(
    0,
    Math.min(1, (time - window.startSeconds) / window.durationSeconds),
  );
  const evolutionEnabled = stageProgress >= window.evolutionStartsAt;
  const phase = evolutionEnabled ? "evolving" : "stable";
  const phaseProgress = evolutionEnabled
    ? (stageProgress - window.evolutionStartsAt) / (1 - window.evolutionStartsAt)
    : stageProgress / window.evolutionStartsAt;
  return {
    effect: window.effect,
    nextEffect: order.stages[(stageIndex + 1) % order.stages.length],
    index: stageIndex,
    phase,
    evolutionStartsAt: window.evolutionStartsAt,
    evolutionEnabled,
    stageProgress,
    phaseProgress,
    evolutionProgress: evolutionEnabled ? phaseProgress : 0,
    startSeconds: window.startSeconds,
    endSeconds: window.endSeconds,
    durationSeconds: window.durationSeconds,
  };
}

export function countdownAppearanceEffectTicks(
  effect,
  tick,
  tickSeconds,
  totalTickCount,
  order,
) {
  if (!COUNTDOWN_EFFECTS.includes(effect)) {
    throw new RangeError(`Countdown appearance effect "${effect}" is unknown.`);
  }
  const window = order?.windows?.find(candidate => candidate.effect === effect);
  if (!Number.isSafeInteger(tick) || tick < 0 || tick >= totalTickCount) {
    throw new RangeError("Countdown appearance tick must be inside the countdown.");
  }
  requireFinitePositive(tickSeconds, "Countdown appearance tick seconds");
  if (!Number.isSafeInteger(totalTickCount) || totalTickCount <= 0) {
    throw new RangeError("Countdown appearance tick count must be positive.");
  }
  if (!window) {
    // The order can omit an effect; its ticks then never become active.
    return {
      startTick: totalTickCount,
      endTick: totalTickCount - 1,
      evolutionStartTick: totalTickCount,
      evolutionTickCount: 1,
      evolutionEnabled: false,
      evolutionTick: 0,
      evolutionProgress: 0,
    };
  }
  const startTick = Math.max(0, Math.floor(window.startSeconds / tickSeconds));
  const endTick = Math.min(
    totalTickCount - 1,
    Math.max(startTick, Math.ceil((window.endSeconds - 1e-12) / tickSeconds) - 1),
  );
  const evolutionStartTick = Math.max(
    startTick,
    Math.ceil((window.evolutionStartSeconds - 1e-12) / tickSeconds),
  );
  const hasEvolutionTick = evolutionStartTick <= endTick;
  const evolutionTickCount = hasEvolutionTick
    ? endTick - evolutionStartTick + 1
    : 1;
  const evolutionEnabled = hasEvolutionTick
    && tick >= evolutionStartTick
    && tick <= endTick;
  const evolutionTick = evolutionEnabled ? tick - evolutionStartTick : 0;
  return {
    startTick,
    endTick,
    evolutionStartTick,
    evolutionTickCount,
    evolutionEnabled,
    evolutionTick,
    evolutionProgress: !evolutionEnabled
      ? 0
      : (evolutionTickCount === 1 ? 1 : evolutionTick / (evolutionTickCount - 1)),
  };
}
