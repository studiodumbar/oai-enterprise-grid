const PHASES = Object.freeze([
  Object.freeze({ key: "introSeconds", phase: "intro", label: "Intro" }),
  Object.freeze({ key: "holdSeconds", phase: "hold", label: "Hold" }),
  Object.freeze({ key: "outroSeconds", phase: "outro", label: "Outro" }),
]);

export function normalizeNoiseGridTimeline(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Noise-grid timeline must be an object.");
  }
  const normalized = {};
  for (const { key } of PHASES) {
    const seconds = Number(value[key]);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new RangeError(`Noise-grid ${key} must be a finite positive number.`);
    }
    normalized[key] = seconds;
  }
  normalized.beatSeconds = Number.isFinite(value.beatSeconds) && value.beatSeconds > 0
    ? value.beatSeconds
    : null;
  normalized.phase = PHASES.some(entry => entry.phase === value.phase)
    ? value.phase
    : null;
  normalized.position = Number.isFinite(value.position)
    ? Math.max(0, Math.min(1, value.position))
    : null;
  normalized.currentSeconds = Number.isFinite(value.currentSeconds) && value.currentSeconds >= 0
    ? value.currentSeconds
    : null;
  return normalized;
}

export function noiseGridTimelineShares(value) {
  const timeline = normalizeNoiseGridTimeline(value);
  const total = PHASES.reduce((sum, entry) => sum + timeline[entry.key], 0);
  return Object.freeze(Object.fromEntries(
    PHASES.map(entry => [entry.phase, timeline[entry.key] / total]),
  ));
}

function timelineLabel(timeline) {
  const beat = timeline.beatSeconds === null
    ? ""
    : ` · beat ${timeline.beatSeconds.toFixed(2)} s`;
  const total = timeline.introSeconds + timeline.holdSeconds + timeline.outroSeconds;
  const current = timeline.currentSeconds === null
    ? ""
    : ` · current ${timeline.currentSeconds.toFixed(2)} of ${total.toFixed(2)} s`;
  return `Intro ${timeline.introSeconds.toFixed(2)} s, hold `
    + `${timeline.holdSeconds.toFixed(2)} s, outro `
    + `${timeline.outroSeconds.toFixed(2)} s${beat}${current}`;
}

export function createNoiseGridTimelineControl({ pane, current, set } = {}) {
  if (!pane || typeof pane.addFolder !== "function") {
    throw new TypeError("Noise-grid timeline control needs a Tweakpane instance.");
  }
  if (typeof current !== "function" || typeof set !== "function") {
    throw new TypeError("Noise-grid timeline control needs current() and set(value) functions.");
  }
  const initial = current();
  const timeline = initial === null
    ? normalizeNoiseGridTimeline({ introSeconds: 1, holdSeconds: 1, outroSeconds: 1 })
    : normalizeNoiseGridTimeline(initial);
  const values = {
    introSeconds: timeline.introSeconds,
    holdSeconds: timeline.holdSeconds,
    outroSeconds: timeline.outroSeconds,
  };
  const folder = pane.addFolder({ title: "Noise timeline", expanded: true });
  const bindings = PHASES.map(entry => folder.addBinding(values, entry.key, {
    label: `${entry.label} (s)`,
    min: 0.1,
    step: 0.1,
  }));
  const document = pane.element?.ownerDocument;
  const root = document?.createElement?.("div") ?? null;
  const segments = new Map();
  let playhead = null;
  if (root) {
    root.className = "noise-timeline";
    root.setAttribute("role", "img");
    for (const entry of PHASES) {
      const segment = document.createElement("span");
      segment.className = `noise-timeline-segment is-${entry.phase}`;
      segment.textContent = entry.label;
      root.append(segment);
      segments.set(entry.phase, segment);
    }
    playhead = document.createElement("span");
    playhead.className = "noise-timeline-playhead";
    playhead.setAttribute("aria-hidden", "true");
    root.append(playhead);
    folder.element.append(root);
  }
  let disposed = false;
  let syncing = false;

  function render(value) {
    if (!root) return;
    const shares = noiseGridTimelineShares(value);
    root.setAttribute("aria-label", timelineLabel(value));
    playhead.hidden = value.position === null;
    if (value.position !== null) {
      playhead.style.left = `${(value.position * 100).toFixed(4)}%`;
    }
    for (const entry of PHASES) {
      const segment = segments.get(entry.phase);
      segment.style.flexGrow = String(shares[entry.phase]);
      segment.classList.toggle("is-active", value.phase === entry.phase);
    }
  }

  function sync() {
    if (disposed) return false;
    const next = current();
    folder.hidden = next === null;
    if (next === null) return false;
    const normalized = normalizeNoiseGridTimeline(next);
    syncing = true;
    try {
      for (const { key } of PHASES) values[key] = normalized[key];
      pane.refresh();
      render(normalized);
    } finally {
      syncing = false;
    }
    return true;
  }

  for (const binding of bindings) {
    binding.on("change", event => {
      if (syncing || event.last === false) return;
      const next = normalizeNoiseGridTimeline(values);
      try {
        set({
          introSeconds: next.introSeconds,
          holdSeconds: next.holdSeconds,
          outroSeconds: next.outroSeconds,
        });
      } finally {
        sync();
      }
    });
  }

  sync();
  return {
    sync,
    dispose() {
      if (disposed) return;
      disposed = true;
    },
  };
}
