import {
  EXPORT_MODES,
  MAX_EXPORT_DIMENSION,
  MAX_EXPORT_FPS,
  MOTION_EXPORT_FORMATS,
  STATIC_EXPORT_FORMATS,
  formatVisibility,
  normalizeExportState,
} from "./export-state.js";
import { ASPECT_RATIO_PRESETS, LONG_EDGE_PRESETS, sizeFromAspect } from "./resolution.js";

const FORMAT_LABELS = Object.freeze({
  png: "PNG image",
  svg: "SVG vector",
  mp4: "MP4 video",
  webm: "WebM · alpha",
  "png-sequence": "PNG sequence",
});

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function row(label, control, name) {
  const wrapper = document.createElement("label");
  wrapper.className = "export-row";
  wrapper.dataset.control = name;
  const caption = document.createElement("span");
  caption.textContent = label;
  wrapper.append(caption, control);
  return wrapper;
}

function numberInput(value, { min = 1, max = MAX_EXPORT_DIMENSION, step = 1 } = {}) {
  const input = document.createElement("input");
  input.type = "number";
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  return input;
}

export function createExportPanel({ state, onExport, onStateChange } = {}) {
  const root = document.createElement("aside");
  root.id = "export-panel";
  root.setAttribute("aria-label", "Export controls");
  root.innerHTML = `
    <div class="export-heading">
      <span>Export</span>
      <button type="button" class="export-collapse" aria-label="Collapse export controls" aria-expanded="true">−</button>
    </div>
  `;
  const body = document.createElement("div");
  body.className = "export-panel-body";
  root.append(body);

  const mode = document.createElement("select");
  mode.append(option(EXPORT_MODES.STATIC, "Static"), option(EXPORT_MODES.MOTION, "Motion"));
  mode.value = state.mode;

  const format = document.createElement("select");
  const aspect = document.createElement("select");
  for (const value of ASPECT_RATIO_PRESETS) aspect.append(option(value, value));
  aspect.value = state.aspect;

  const resolution = document.createElement("select");
  for (const [label, value] of Object.entries(LONG_EDGE_PRESETS)) {
    resolution.append(option(String(value), label));
  }
  resolution.value = String(state.resolution);

  const width = numberInput(state.resW);
  const height = numberInput(state.resH);
  const fps = numberInput(state.fps, { min: 1, max: MAX_EXPORT_FPS });
  const transparent = document.createElement("input");
  transparent.type = "checkbox";
  transparent.checked = state.transparentBg;
  const metadata = document.createElement("input");
  metadata.type = "checkbox";
  metadata.checked = state.embedProjectState;

  const progress = document.createElement("div");
  progress.className = "export-progress";
  progress.setAttribute("role", "status");
  progress.setAttribute("aria-live", "polite");
  const progressBar = document.createElement("div");
  progressBar.className = "export-progress-bar";
  progress.append(progressBar);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "export-button";
  button.textContent = "Export";

  body.append(
    row("Workflow", mode, "mode"),
    row("Format", format, "format"),
    row("Aspect", aspect, "aspect"),
    row("Resolution", resolution, "resolution"),
    row("Width", width, "width"),
    row("Height", height, "height"),
    row("FPS", fps, "fps"),
    row("Transparent", transparent, "transparency"),
    row("Embed state", metadata, "metadata"),
    progress,
    button,
  );

  const rows = Object.fromEntries(
    [...body.querySelectorAll("[data-control]")].map(element => [element.dataset.control, element]),
  );

  function emit() {
    normalizeExportState(state);
    onStateChange?.(state);
  }

  function sync() {
    normalizeExportState(state);
    mode.value = state.mode;
    format.replaceChildren();
    const formats = state.mode === EXPORT_MODES.MOTION
      ? MOTION_EXPORT_FORMATS
      : STATIC_EXPORT_FORMATS;
    for (const value of formats) format.append(option(value, FORMAT_LABELS[value]));
    format.value = state.exportFormat;
    aspect.value = state.aspect;
    resolution.value = String(state.resolution);
    width.value = String(state.resW);
    height.value = String(state.resH);
    fps.value = String(state.fps);
    transparent.checked = state.transparentBg;
    metadata.checked = state.embedProjectState;
    const visibility = formatVisibility(state);
    rows.transparency.hidden = !visibility.transparency;
    rows.fps.hidden = !visibility.fps;
    rows.metadata.hidden = !visibility.metadata;
  }

  function applyPreset() {
    const next = sizeFromAspect(state.aspect, state.resolution);
    state.resW = next.width;
    state.resH = next.height;
    sync();
    emit();
  }

  mode.addEventListener("change", () => {
    state.mode = mode.value;
    state.exportFormat = state.mode === EXPORT_MODES.MOTION ? "mp4" : "png";
    sync();
    emit();
  });
  format.addEventListener("change", () => {
    state.exportFormat = format.value;
    sync();
    emit();
  });
  aspect.addEventListener("change", () => { state.aspect = aspect.value; applyPreset(); });
  resolution.addEventListener("change", () => {
    state.resolution = Number(resolution.value);
    applyPreset();
  });
  width.addEventListener("change", () => {
    state.resW = Number(width.value);
    sync();
    emit();
  });
  height.addEventListener("change", () => {
    state.resH = Number(height.value);
    sync();
    emit();
  });
  fps.addEventListener("change", () => { state.fps = Number(fps.value); sync(); emit(); });
  transparent.addEventListener("change", () => { state.transparentBg = transparent.checked; emit(); });
  metadata.addEventListener("change", () => { state.embedProjectState = metadata.checked; emit(); });
  button.addEventListener("click", () => onExport?.());

  const collapse = root.querySelector(".export-collapse");
  collapse.addEventListener("click", () => {
    const collapsed = root.classList.toggle("is-collapsed");
    collapse.textContent = collapsed ? "+" : "−";
    collapse.setAttribute("aria-expanded", String(!collapsed));
  });

  function setLocked(locked) {
    root.classList.toggle("is-locked", locked);
    for (const control of root.querySelectorAll("button, input, select")) {
      if (control !== collapse) control.disabled = locked;
    }
  }

  function setProgress(message = "", ratio = null) {
    progress.dataset.visible = message ? "true" : "false";
    progress.setAttribute("aria-label", message);
    progress.title = message;
    progressBar.style.width = ratio === null ? "0%" : `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    button.textContent = message || "Export";
  }

  sync();
  return { root, sync, setLocked, setProgress, button };
}
