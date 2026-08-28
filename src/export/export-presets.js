import { normalizeExportState } from "./export-state.js";
import { sizeFromAspect } from "./resolution.js";

const PREVIEW_JOBS = Object.freeze([
  Object.freeze({
    label: "Preview PNG · 4K · 16:9",
    format: "png-sequence",
    aspect: "16:9",
    resolution: 3840,
    directory: "png_sequence-4k-16x9",
    variant: "preview-4k-16x9-png-sequence",
  }),
  Object.freeze({
    label: "Preview PNG · 4K · 2:1",
    format: "png-sequence",
    aspect: "2:1",
    resolution: 3840,
    directory: "png_sequence-4k-2x1",
    variant: "preview-4k-2x1-png-sequence",
  }),
  Object.freeze({
    label: "Preview MP4 · 1080p · 16:9",
    format: "mp4",
    aspect: "16:9",
    resolution: 1920,
    variant: "preview-1080p-16x9-mp4",
  }),
  Object.freeze({
    label: "Preview MP4 · 1080p · 2:1",
    format: "mp4",
    aspect: "2:1",
    resolution: 1920,
    variant: "preview-1080p-2x1-mp4",
  }),
]);

export const EXPORT_PRESETS = Object.freeze({
  preview: Object.freeze({
    id: "preview",
    label: "Preview set",
    fps: 60,
    embedProjectState: true,
    transparentBg: false,
    jobs: PREVIEW_JOBS,
  }),
});

export function exportPreset(name) {
  const preset = EXPORT_PRESETS[name];
  if (!preset) {
    throw new Error(
      `Unknown export preset "${name}". Available presets: ${Object.keys(EXPORT_PRESETS).join(", ")}.`,
    );
  }
  return preset;
}

export function applyExportPresetJob(state, preset, job) {
  if (!state || typeof state !== "object") {
    throw new TypeError("Export preset needs mutable export state.");
  }
  const size = sizeFromAspect(job.aspect, job.resolution);
  Object.assign(state, {
    mode: "motion",
    exportFormat: job.format,
    aspect: job.aspect,
    resolution: job.resolution,
    resW: size.width,
    resH: size.height,
    fps: preset.fps,
    transparentBg: preset.transparentBg,
    embedProjectState: preset.embedProjectState,
  });
  return normalizeExportState(state);
}

export function exportPresetJobSession(session, job) {
  if (job.format !== "png-sequence" || !job.directory) return session;
  if (!session?.pngSequenceDirectory) return session;
  return {
    ...session,
    pngSequenceDirectory: Promise.resolve(session.pngSequenceDirectory).then(directory => {
      if (typeof directory?.getDirectoryHandle !== "function") {
        throw new Error(
          `The selected export directory cannot create "${job.directory}".`,
        );
      }
      return directory.getDirectoryHandle(job.directory, { create: true });
    }),
  };
}
