const MEDIABUNNY_URL = "./vendor/mediabunny.mjs";

let mediabunnyPromise = null;

async function loadMediabunny() {
  mediabunnyPromise ??= import(/* @vite-ignore */ MEDIABUNNY_URL);
  return mediabunnyPromise;
}

async function firstAlphaCodec(module, codecs, options) {
  for (const codec of codecs) {
    if (await module.canEncodeVideo(codec, { ...options, alpha: "keep" })) return codec;
  }
  return null;
}

export async function createVideoEncoder({
  canvas,
  format,
  width,
  height,
  fps,
} = {}) {
  const module = await loadMediabunny();
  const {
    Output,
    BufferTarget,
    Mp4OutputFormat,
    WebMOutputFormat,
    CanvasSource,
    getFirstEncodableVideoCodec,
    QUALITY_HIGH,
  } = module;
  const alpha = format === "webm";
  const options = { width, height, bitrate: QUALITY_HIGH, framerate: fps };
  const codec = alpha
    ? await firstAlphaCodec(module, ["vp9", "vp8", "av1"], options)
    : await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], options);
  if (!codec) {
    throw new Error(
      alpha
        ? "This browser has no WebCodecs encoder that supports transparent WebM."
        : "This browser has no compatible WebCodecs video encoder.",
    );
  }

  const output = new Output({
    format: alpha
      ? new WebMOutputFormat()
      : new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, {
    codec,
    bitrate: QUALITY_HIGH,
    alpha: alpha ? "keep" : "discard",
  });
  output.addVideoTrack(source, { frameRate: fps, alpha: alpha ? "keep" : "discard" });
  await output.start();

  let closed = false;
  let finalized = false;
  return {
    codec,
    mime: alpha ? "video/webm" : "video/mp4",
    extension: alpha ? "webm" : "mp4",
    async add(timestamp, duration) {
      await source.add(timestamp, duration);
    },
    async finalize() {
      if (closed) throw new Error("Video encoder is already closed.");
      closed = true;
      source.close();
      await output.finalize();
      finalized = true;
      return new Blob([output.target.buffer], {
        type: alpha ? "video/webm" : "video/mp4",
      });
    },
    async cancel() {
      if (finalized || output.state === "canceled") return;
      closed = true;
      try {
        if (output.state === "started") await output.cancel();
      } catch {
        // The encoder may already have torn itself down after an error.
      }
    },
  };
}
