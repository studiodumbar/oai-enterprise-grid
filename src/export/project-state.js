function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function validSeed(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function validTimeline(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Number.isFinite(value.time)
    && value.time >= 0
    && Number.isSafeInteger(value.frameIndex)
    && value.frameIndex >= 0,
  );
}

export function createProjectState({ director, exportState, projectSeed, timeline }) {
  if (!director || typeof director.snapshotProjectState !== "function") {
    throw new TypeError("createProjectState requires a composition director.");
  }
  const snapshot = {
    version: 1,
    director: director.snapshotProjectState(),
    export: clone(exportState),
  };
  if (validSeed(projectSeed)) snapshot.seed = projectSeed;
  if (
    validTimeline(timeline)
  ) {
    snapshot.timeline = {
      time: timeline.time,
      frameIndex: timeline.frameIndex,
    };
  }
  return snapshot;
}

export function applyProjectState(snapshot, {
  director,
  exportState,
  applyExportState,
  applyProjectSeed,
  applyTimeline,
} = {}) {
  if (!snapshot || snapshot.version !== 1 || typeof snapshot !== "object") {
    throw new Error("This project state is missing or uses an unsupported version.");
  }
  if (snapshot.timeline !== undefined && !validTimeline(snapshot.timeline)) {
    throw new Error("This project state contains an invalid animation timeline.");
  }
  if (validSeed(snapshot.seed)) applyProjectSeed?.(snapshot.seed);
  director?.restoreProjectState?.(snapshot.director);
  if (exportState && typeof applyExportState === "function") {
    applyExportState(exportState, snapshot.export);
  }
  if (snapshot.timeline) applyTimeline?.(snapshot.timeline);
  return snapshot;
}

export function createSnapshotHistory(initialSnapshot, { limit = 50 } = {}) {
  const maximum = Math.max(2, Math.round(Number(limit)) || 50);
  const undoStack = [clone(initialSnapshot)];
  const redoStack = [];
  return {
    commit(snapshot) {
      undoStack.push(clone(snapshot));
      if (undoStack.length > maximum) undoStack.shift();
      redoStack.length = 0;
    },
    undo(currentSnapshot) {
      if (undoStack.length <= 1) return null;
      redoStack.push(clone(currentSnapshot));
      undoStack.pop();
      return clone(undoStack.at(-1));
    },
    redo(currentSnapshot) {
      if (redoStack.length === 0) return null;
      const next = redoStack.pop();
      undoStack.push(clone(next));
      return clone(next ?? currentSnapshot);
    },
    get canUndo() {
      return undoStack.length > 1;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
  };
}
