import { applyKnownExportState, exportStateSnapshot } from "./export-state.js";
import { containFit } from "./contain-fit.js";
import { canvasToBlob, downloadBlob } from "./download.js";
import { frameCountFor, frameTimeAt, fixedStepsForFrame } from "./deterministic-clock.js";
import { exportBaseName, exportFilename } from "./filename.js";
import { createProjectState, applyProjectState } from "./project-state.js";
import { projectSignature } from "./signature.js";
import { createPngSequenceSink } from "./png-sequence-sink.js";
import { createSvgRecordingContext } from "./svg-recording-context.js";
import { createVideoEncoder } from "./video-encoder.js";
import { evenSize } from "./resolution.js";
import { diogoniseImport, isDiogonisatorImport } from "./diogonisator.js";
import { debug } from "../debug/index.js";
import {
  applyExportPresetJob,
  exportPreset,
  exportPresetJobSession,
} from "./export-presets.js";

const signature = projectSignature;
const INACTIVE_POINTER = Object.freeze({ active: false, x: 0, y: 0 });
const MAX_EXPORT_CYCLES = 100;

function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function fillOutput(context, width, height, transparent, background) {
  context.save();
  context.setTransform?.(1, 0, 0, 1, 0, 0);
  context.clearRect?.(0, 0, width, height);
  if (!transparent) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }
  context.restore();
}

function drawContained(director, frame, context, bounds, outputWidth, outputHeight) {
  const fit = containFit(bounds, outputWidth, outputHeight);
  context.save();
  try {
    context.translate(fit.dx, fit.dy);
    context.scale(fit.scale, fit.scale);
    director.draw(frame, context);
  } finally {
    context.restore();
  }
}

function normalizedOutputSize(state, video = false) {
  const size = {
    width: Math.max(2, Math.round(state.resW)),
    height: Math.max(2, Math.round(state.resH)),
  };
  return video ? evenSize(size) : size;
}

function pngBytes(blob, metadataPayload) {
  return blob.arrayBuffer().then(buffer => (
    metadataPayload ? signature.stampPng(buffer, metadataPayload) : new Uint8Array(buffer)
  ));
}

export function motionDurationForCycles(duration, cycles = 1) {
  if (!Number.isSafeInteger(cycles) || cycles < 1 || cycles > MAX_EXPORT_CYCLES) {
    throw new RangeError(`Export cycles must be an integer between 1 and ${MAX_EXPORT_CYCLES}.`);
  }
  return Number.isFinite(duration) && duration > 0 ? duration * cycles : null;
}

function exportedFrame(time, dt, frameIndex, viewport, exportFrame = {}) {
  return {
    dt,
    compositionDt: dt,
    time,
    frameIndex,
    viewport,
    pointer: INACTIVE_POINTER,
    exporting: true,
    ...exportFrame,
  };
}

export function exportNamePartsFromInspection(inspection) {
  if (!inspection || typeof inspection !== "object") return {};
  const flickers = Object.values(inspection.generators ?? {})
    .map(generator => generator?.flicker);
  const previewFlicker = inspection.compositionId === "base"
    ? flickers.find(entry => entry?.mode && entry.scope)
    : null;
  const flicker = previewFlicker
    ?? flickers.find(entry => entry?.enabled && entry.mode);
  return {
    composition: previewFlicker?.scope ?? inspection.compositionId ?? "",
    flicker: flicker?.mode ?? "",
  };
}

export function createExportController({
  p,
  getDirector,
  createDirector,
  state,
  panel,
  getPreviewClock,
  getProjectSeed,
  setProjectSeed,
  pausePreview,
  resumePreview,
  onProjectRestored,
  renderPreview,
  setInputLocked,
  background = "#fff",
} = {}) {
  let exporting = false;

  // Calling the picker, rather than awaiting its result, must happen in the
  // original click/console gesture. A session can be shared by a batch so its
  // later compositions keep writing to the directory selected up front.
  function prepareSession({ format = state.exportFormat } = {}) {
    if (format !== "png-sequence") return {};
    const picker = globalThis.window?.showDirectoryPicker;
    if (typeof picker !== "function") {
      debug.export("destination format=png-sequence kind=zip state=selected");
      return {};
    }
    debug.export("destination format=png-sequence kind=directory state=requested");
    const pngSequenceDirectory = Promise.resolve(
      picker.call(globalThis.window, { mode: "readwrite" }),
    ).then(
      directory => {
        debug.export("destination format=png-sequence kind=directory state=selected");
        return directory;
      },
      error => {
        debug.export(
          "destination format=png-sequence kind=directory state=failed error=%s",
          error?.name ?? "Error",
        );
        throw error;
      },
    );
    return { pngSequenceDirectory };
  }

  function projectPayload(director = getDirector()) {
    return {
      app: "circle-grid",
      project: "circle-grid",
      version: 1,
      params: createProjectState({
        director,
        exportState: exportStateSnapshot(state),
        projectSeed: getProjectSeed?.(),
        timeline: getPreviewClock(),
      }),
      svg: null,
    };
  }

  // Exports are named after the composition and flicker mode on screen. The
  // base test card uses its preview scope in place of the internal composition
  // id, producing prefixes such as OAI_canvas_radar-arc and OAI_cell_noise.
  function exportNameParts() {
    let inspection = null;
    try {
      inspection = getDirector()?.inspect?.() ?? null;
    } catch {
      return {};
    }
    return exportNamePartsFromInspection(inspection);
  }

  function contentBounds(director, viewport) {
    return director.contentBounds() ?? {
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    };
  }

  async function createMotionSession(width, height, fps) {
    const preview = getPreviewClock();
    const sourceDirector = getDirector();
    const project = sourceDirector.snapshotProjectState();
    let session = null;
    try {
      session = await createDirector({
        viewport: preview.viewport,
        context: null,
        sessionStorage: null,
        random: () => 0.5,
        projectSeed: getProjectSeed?.(),
      });
      session.use(project.compositionId);
      session.restoreProjectState(project);
      const bounds = contentBounds(session, preview.viewport);
      let frameIndex = 0;
      let simulationTime = 0;
      session.update(exportedFrame(0, 0, frameIndex, preview.viewport));

      return {
        director: session,
        bounds,
        viewport: preview.viewport,
        async advanceFrame(index) {
          for (const dt of fixedStepsForFrame(index, fps)) {
            simulationTime += dt;
            frameIndex += 1;
            session.update(exportedFrame(simulationTime, dt, frameIndex, preview.viewport));
          }
        },
        draw(context, target, exportFrame) {
          drawContained(
            session,
            exportedFrame(target, 0, frameIndex, preview.viewport, exportFrame),
            context,
            bounds,
            width,
            height,
          );
        },
        dispose() {
          session.dispose();
        },
      };
    } catch (error) {
      session?.dispose();
      throw error;
    }
  }

  async function exportPng(payload, names) {
    const { width, height } = normalizedOutputSize(state);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    const preview = getPreviewClock();
    fillOutput(context, width, height, state.transparentBg, background);
    drawContained(
      getDirector(),
      exportedFrame(preview.time, 0, preview.frameIndex, preview.viewport),
      context,
      contentBounds(getDirector(), preview.viewport),
      width,
      height,
    );
    const blob = await canvasToBlob(canvas);
    const bytes = await pngBytes(blob, state.embedProjectState ? signature.payload(payload) : null);
    downloadBlob(new Blob([bytes], { type: "image/png" }), names.png(state.transparentBg));
  }

  async function exportSvg(payload, names) {
    const { width, height } = normalizedOutputSize(state);
    const recorder = createSvgRecordingContext(width, height);
    const preview = getPreviewClock();
    drawContained(
      getDirector(),
      exportedFrame(preview.time, 0, preview.frameIndex, preview.viewport),
      recorder,
      contentBounds(getDirector(), preview.viewport),
      width,
      height,
    );
    const metadata = state.embedProjectState ? signature.svgText(payload) : null;
    const svg = recorder.toSVG({ metadata });
    downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), names.svg());
  }

  async function exportMotion(payload, names, format, cycles, exportSession, jobLabel) {
    const { width, height } = normalizedOutputSize(state, format !== "png-sequence");
    const fps = Math.max(1, Math.round(state.fps));
    const duration = motionDurationForCycles(getDirector().animationDuration(), cycles);
    if (!(duration > 0)) {
      throw new Error(
        "This composition is a continuous simulation without a finite seamless cycle. Choose a timed grid composition for motion export.",
      );
    }
    const frames = frameCountFor(duration, fps);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    const alpha = format === "webm"
      || (format === "png-sequence" && state.transparentBg);
    let session = null;
    let encoder = null;
    let sink = null;
    try {
      const directory = format === "png-sequence"
        ? await exportSession.pngSequenceDirectory
        : undefined;
      session = await createMotionSession(width, height, fps);
      if (format === "png-sequence") {
        sink = await createPngSequenceSink({
          prefix: names.base,
          frameCount: frames,
          directory,
          // Directory selection was deliberately completed before async setup.
          // Do not let the sink open a second, gesture-gated picker here.
          windowRef: {},
          download: downloadBlob,
        });
      } else {
        encoder = await createVideoEncoder({ canvas, format, width, height, fps });
      }

      const stampedPayload = state.embedProjectState ? signature.payload(payload) : null;
      for (let index = 0; index < frames; index += 1) {
        const time = frameTimeAt(index, fps);
        fillOutput(context, width, height, alpha, background);
        session.draw(context, time, {
          exportFrameIndex: index,
          exportFrameCount: frames,
        });
        if (sink) {
          const blob = await canvasToBlob(canvas);
          await sink.write(index, await pngBytes(blob, stampedPayload));
        } else {
          await encoder.add(time, 1 / fps);
        }
        await session.advanceFrame(index);
        const label = jobLabel ? `${jobLabel} · ` : "";
        panel.setProgress(`${label}Rendering ${index + 1}/${frames}…`, (index + 1) / frames);
        await yieldToBrowser();
      }

      if (sink) {
        panel.setProgress(jobLabel ? `${jobLabel} · Packaging…` : "Packaging sequence…", 1);
        await sink.close();
        return;
      }
      panel.setProgress(jobLabel ? `${jobLabel} · Finalizing…` : "Finalizing video…", 1);
      const video = await encoder.finalize();
      const parts = format === "mp4" && state.embedProjectState
        ? [video, signature.mp4Box(payload)]
        : [video];
      downloadBlob(
        new Blob(parts, { type: encoder.mime }),
        format === "webm" ? names.webm(true) : names.mp4(),
      );
    } catch (error) {
      await encoder?.cancel();
      throw error;
    } finally {
      session?.dispose();
    }
  }

  // `notify` is on for the panel button and off for the console, which
  // summarises failures itself instead of stacking alert dialogs.
  async function run({ notify = true, cycles = 1, session, variant, jobLabel } = {}) {
    if (exporting) {
      return { ok: false, error: new Error("An export is already running.") };
    }
    exporting = true;
    let failure = null;
    const wasLooping = typeof p.isLooping === "function" ? p.isLooping() : true;
    const exportDate = new Date();
    const parts = { date: exportDate, ...exportNameParts(), variant };
    const base = exportBaseName(exportDate, parts);
    const names = {
      base,
      png: alpha => exportFilename("png", { ...parts, alpha }),
      svg: () => exportFilename("svg", parts),
      mp4: () => exportFilename("mp4", parts),
      webm: alpha => exportFilename("webm", { ...parts, alpha }),
    };
    panel.setLocked(true);
    panel.setProgress(jobLabel ? `${jobLabel} · Preparing…` : "Preparing export…", 0);
    setInputLocked(true);
    pausePreview();
    try {
      const exportSession = session ?? prepareSession();
      debug.export("run state=started format=%s cycles=%d", state.exportFormat, cycles);
      const payload = projectPayload();
      if (state.exportFormat === "png") await exportPng(payload, names);
      else if (state.exportFormat === "svg") await exportSvg(payload, names);
      else if (state.exportFormat === "png-sequence") {
        await exportMotion(
          payload,
          names,
          "png-sequence",
          cycles,
          exportSession,
          jobLabel,
        );
      } else if (state.exportFormat === "webm") {
        await exportMotion(payload, names, "webm", cycles, exportSession, jobLabel);
      } else {
        await exportMotion(payload, names, "mp4", cycles, exportSession, jobLabel);
      }
    } catch (error) {
      failure = error;
      debug.export(
        "run state=failed format=%s cycles=%d error=%s",
        state.exportFormat,
        cycles,
        error?.name ?? "Error",
      );
      console.error("Export failed:", error);
      if (notify) window.alert(`Export failed: ${error.message}`);
    } finally {
      panel.setProgress();
      panel.setLocked(false);
      setInputLocked(false);
      try {
        resumePreview(wasLooping);
      } finally {
        exporting = false;
      }
    }
    if (!failure) {
      debug.export("run state=completed format=%s cycles=%d", state.exportFormat, cycles);
    }
    return failure ? { ok: false, error: failure } : { ok: true };
  }

  async function runPreset(name, { notify = true, cycles = 1 } = {}) {
    if (exporting) {
      return { ok: false, error: new Error("An export is already running.") };
    }
    const preset = exportPreset(name);
    const before = exportStateSnapshot(state);
    // The preset includes two PNG sequences. Acquire their shared destination
    // now, while this function is still executing inside the button gesture.
    const session = prepareSession({ format: "png-sequence" });
    const results = [];
    let failure = null;
    debug.export("preset state=started name=%s jobs=%d", preset.id, preset.jobs.length);
    try {
      for (const [index, job] of preset.jobs.entries()) {
        applyExportPresetJob(state, preset, job);
        panel.sync();
        debug.export(
          "preset state=job name=%s index=%d format=%s aspect=%s size=%dx%d fps=%d directory=%s",
          preset.id,
          index,
          job.format,
          job.aspect,
          state.resW,
          state.resH,
          state.fps,
          job.directory ?? "parent",
        );
        const result = await run({
          notify: false,
          cycles,
          session: exportPresetJobSession(session, job),
          variant: job.variant,
          jobLabel: `${index + 1}/${preset.jobs.length} ${job.label}`,
        });
        results.push({ ...job, ...result });
        if (!result.ok) {
          failure = result.error;
          break;
        }
      }
    } finally {
      applyKnownExportState(state, before);
      panel.sync();
    }
    if (failure) {
      debug.export(
        "preset state=failed name=%s completed=%d error=%s",
        preset.id,
        results.filter(result => result.ok).length,
        failure?.name ?? "Error",
      );
      if (notify) globalThis.window?.alert(`Export preset failed: ${failure.message}`);
      return { ok: false, preset: preset.id, results, error: failure };
    }
    debug.export("preset state=completed name=%s jobs=%d", preset.id, results.length);
    return { ok: true, preset: preset.id, results };
  }

  function restorePayload(saved) {
    const compatibleApp = saved?.app === "circle-grid" && saved?.project === "circle-grid";
    const diogonisatorImport = isDiogonisatorImport(saved);
    if ((!compatibleApp || saved.version !== 1) && !diogonisatorImport) {
      throw new Error("This file does not contain compatible Circle Grid state.");
    }
    const director = getDirector();
    const before = createProjectState({
      director,
      exportState: exportStateSnapshot(state),
      projectSeed: getProjectSeed?.(),
      timeline: getPreviewClock?.(),
    });
    const apply = params => {
      applyProjectState(params, {
        director,
        exportState: state,
        applyExportState: applyKnownExportState,
        applyProjectSeed: setProjectSeed,
        applyTimeline: timeline => onProjectRestored?.(params, timeline),
      });
      if (!params.timeline) onProjectRestored?.(params);
    };
    const imported = diogonisatorImport ? diogoniseImport(saved, before) : saved.params;
    try {
      apply(imported);
      panel.sync();
      renderPreview();
      return imported;
    } catch (error) {
      try {
        apply(before);
        panel.sync();
        renderPreview();
      } catch (rollbackError) {
        console.error("Project-state rollback failed:", rollbackError);
      }
      throw error;
    }
  }

  async function restoreFile(file) {
    const saved = signature.extract(
      await file.arrayBuffer(),
      value => (
        (value?.version === 1 && value.app === "circle-grid" && value.project === "circle-grid")
        || isDiogonisatorImport(value)
      ),
    );
    if (!saved) throw new Error("No embedded Circle Grid project state was found.");
    return restorePayload(saved);
  }

  return {
    prepareSession,
    run,
    runPreset,
    restoreFile,
    restorePayload,
    get exporting() {
      return exporting;
    },
  };
}
