import {
  BufferTarget,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
  canEncodeVideo,
  type VideoCodec,
} from "mediabunny";
import { Encoder as GifEncoder } from "modern-gif";

import { detached } from "../lib/detached";
import { errorMessage } from "../lib/utils";

import type {
  ExportSettings,
  ExportWorkerRequest,
  ExportWorkerResponse,
} from "../domain/export/protocol";
import { MAX_GIF_RAW_FRAME_BYTES, qualityToGifPaletteSize } from "../domain/export/optimization";

type GifSession = {
  kind: "gif";
  settings: ExportSettings;
  encoder: GifEncoder;
  nextFrame: number;
};

type WebmSession = {
  kind: "webm";
  settings: ExportSettings;
  output: Output<WebMOutputFormat, BufferTarget>;
  source: VideoSampleSource;
  codec: "vp8" | "vp9";
  nextFrame: number;
};

type Mp4Session = {
  kind: "mp4";
  settings: ExportSettings;
  output: Output<Mp4OutputFormat, BufferTarget>;
  source: VideoSampleSource;
  codec: "avc";
  nextFrame: number;
};

type ExportSession = GifSession | WebmSession | Mp4Session;

type WorkerScope = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<ExportWorkerRequest>) => void,
  ): void;
  postMessage(message: ExportWorkerResponse, transfer?: Transferable[]): void;
};

// TypeScript uses Window for `self` because this project includes lib.dom.
declare const self: WorkerScope;
const workerScope = self;
const sessions = new Map<number, ExportSession>();

function post(response: ExportWorkerResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(response, transfer);
}

function validateSettings(settings: ExportSettings): void {
  if (!Number.isInteger(settings.width) || settings.width < 2 || settings.width > 4096) {
    throw new Error("Export width must be an integer from 2 to 4096.");
  }
  if (!Number.isInteger(settings.height) || settings.height < 2 || settings.height > 4096) {
    throw new Error("Export height must be an integer from 2 to 4096.");
  }
  if (!Number.isFinite(settings.fps) || settings.fps < 1 || settings.fps > 120) {
    throw new Error("Export frame rate must be from 1 to 120 FPS.");
  }
  if (!Number.isSafeInteger(settings.frameCount) || settings.frameCount < 1) {
    throw new Error("Export frame count must be a positive safe integer.");
  }
  if (!Number.isFinite(settings.quality) || settings.quality < 0 || settings.quality > 1) {
    throw new Error("Export quality must be from 0 to 1.");
  }
  if (
    settings.bitrate !== undefined &&
    (!Number.isSafeInteger(settings.bitrate) || settings.bitrate < 1)
  ) {
    throw new Error("Export bitrate must be a positive integer.");
  }
  if (
    settings.gifPaletteSize !== undefined &&
    (!Number.isInteger(settings.gifPaletteSize) ||
      settings.gifPaletteSize < 2 ||
      settings.gifPaletteSize > 255)
  ) {
    throw new Error("GIF palette size must be an integer from 2 to 255.");
  }
  if (settings.format === "gif" && settings.bitrate !== undefined) {
    throw new Error("GIF exports do not accept a video bitrate.");
  }
  if (settings.format !== "gif" && settings.gifPaletteSize !== undefined) {
    throw new Error("GIF palette size only applies to GIF exports.");
  }
  if (settings.format === "mp4" && settings.transparent) {
    throw new Error("MP4 does not support transparent video. Choose a matte color instead.");
  }
  const bytesPerFrame = settings.width * settings.height * 4;
  if (!Number.isSafeInteger(bytesPerFrame)) throw new Error("Export dimensions are too large.");
  const totalFrameBytes = bytesPerFrame * settings.frameCount;
  if (settings.format === "gif" && totalFrameBytes > MAX_GIF_RAW_FRAME_BYTES) {
    throw new Error(
      "GIF frames would exceed the 512 MiB encoding limit. Reduce the size, FPS, or duration.",
    );
  }
}

function videoQuality(settings: ExportSettings): Quality {
  return settings.bitrate === undefined
    ? new Quality({ quality: settings.quality })
    : new Quality({ bitrate: settings.bitrate, bitrateMode: "constant" });
}

async function chooseWebmCodec(settings: ExportSettings): Promise<"vp8" | "vp9"> {
  const quality = videoQuality(settings);
  const candidates = ["vp9", "vp8"] as const satisfies readonly VideoCodec[];
  for (const codec of candidates) {
    if (await canEncodeVideo(codec, { width: settings.width, height: settings.height, quality }))
      return codec;
  }
  throw new Error("This browser cannot encode VP9 or VP8 WebM video with WebCodecs.");
}

async function chooseMp4Codec(settings: ExportSettings): Promise<"avc"> {
  const quality = videoQuality(settings);
  if (await canEncodeVideo("avc", { width: settings.width, height: settings.height, quality })) {
    return "avc";
  }
  throw new Error(
    "This browser cannot encode H.264 MP4 at these dimensions. Try WebM or reduce the frame size.",
  );
}

async function startSession(id: number, settings: ExportSettings): Promise<void> {
  if (sessions.has(id)) throw new Error("An export with this ID already exists.");
  validateSettings(settings);

  if (settings.format === "gif") {
    sessions.set(id, {
      kind: "gif",
      settings,
      encoder: new GifEncoder({
        width: settings.width,
        height: settings.height,
        maxColors: settings.gifPaletteSize ?? qualityToGifPaletteSize(settings.quality),
        looped: true,
        loopCount: 0,
        premultipliedAlpha: false,
        ditherTransparency: settings.transparent ? "floyd-steinberg" : undefined,
      }),
      nextFrame: 0,
    });
    post({ type: "ready", id });
    return;
  }

  if (settings.format === "mp4") {
    const codec = await chooseMp4Codec(settings);
    const target = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target,
    });
    const source = new VideoSampleSource({
      codec,
      quality: videoQuality(settings),
      keyFrameInterval: 2,
      alpha: "discard",
      latencyMode: "quality",
    });
    output.addVideoTrack(source, { frameRate: settings.fps });
    try {
      await output.start();
    } catch (error) {
      await output.cancel().catch(() => undefined);
      throw error;
    }
    sessions.set(id, { kind: "mp4", settings, output, source, codec, nextFrame: 0 });
    post({ type: "ready", id, codec });
    return;
  }

  const codec = await chooseWebmCodec(settings);
  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  const source = new VideoSampleSource({
    codec,
    quality: videoQuality(settings),
    keyFrameInterval: 2,
    alpha: settings.transparent ? "keep" : "discard",
    latencyMode: "quality",
  });
  output.addVideoTrack(source, { frameRate: settings.fps });
  try {
    await output.start();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  }
  sessions.set(id, { kind: "webm", settings, output, source, codec, nextFrame: 0 });
  post({ type: "ready", id, codec });
}

function assertFrame(session: ExportSession, index: number, rgba: ArrayBuffer): void {
  if (index !== session.nextFrame) {
    throw new Error(`Expected export frame ${session.nextFrame}, received ${index}.`);
  }
  const expectedSize = session.settings.width * session.settings.height * 4;
  if (rgba.byteLength !== expectedSize) {
    throw new Error(`Frame ${index} has ${rgba.byteLength} bytes; expected ${expectedSize}.`);
  }
  if (index >= session.settings.frameCount) throw new Error("Received more frames than requested.");
}

async function addFrame(id: number, index: number, rgba: ArrayBuffer): Promise<void> {
  const session = sessions.get(id);
  if (!session) throw new Error("Export session does not exist.");
  assertFrame(session, index, rgba);

  if (session.kind === "gif") {
    await session.encoder.encode({
      data: new Uint8ClampedArray(rgba),
      width: session.settings.width,
      height: session.settings.height,
      delay: 1000 / session.settings.fps,
    });
  } else {
    const sample = new VideoSample(rgba, {
      format: "RGBA",
      codedWidth: session.settings.width,
      codedHeight: session.settings.height,
      timestamp: index / session.settings.fps,
      duration: 1 / session.settings.fps,
    });
    try {
      await session.source.add(sample, { keyFrame: index === 0 });
    } finally {
      sample.close();
    }
  }

  session.nextFrame += 1;
  post({ type: "frame-added", id, index });
}

async function finishSession(id: number): Promise<void> {
  const session = sessions.get(id);
  if (!session) throw new Error("Export session does not exist.");
  if (session.nextFrame !== session.settings.frameCount) {
    throw new Error(
      `Export received ${session.nextFrame} of ${session.settings.frameCount} frames.`,
    );
  }

  if (session.kind === "gif") {
    const data = await session.encoder.flush("arrayBuffer");
    sessions.delete(id);
    post({ type: "done", id, mimeType: "image/gif", data }, [data]);
    return;
  }

  await session.output.finalize();
  const data = session.output.target.buffer;
  if (!data) {
    throw new Error(`${session.kind.toUpperCase()} encoder finalized without producing a file.`);
  }
  const mimeType = await session.output.getMimeType();
  sessions.delete(id);
  post({ type: "done", id, mimeType, data }, [data]);
}

async function cancelSession(id: number): Promise<void> {
  const session = sessions.get(id);
  sessions.delete(id);
  if (
    session &&
    session.kind !== "gif" &&
    session.output.state !== "finalized" &&
    session.output.state !== "canceled"
  ) {
    await session.output.cancel();
  }
  post({ type: "canceled", id });
}

workerScope.addEventListener("message", (event: MessageEvent<ExportWorkerRequest>) => {
  detached(
    (async () => {
      const request = event.data;
      try {
        if (request.type === "start") await startSession(request.id, request.settings);
        else if (request.type === "frame") await addFrame(request.id, request.index, request.rgba);
        else if (request.type === "finish") await finishSession(request.id);
        else await cancelSession(request.id);
      } catch (error) {
        const session = sessions.get(request.id);
        sessions.delete(request.id);
        if (
          session &&
          session.kind !== "gif" &&
          session.output.state !== "finalized" &&
          session.output.state !== "canceled"
        ) {
          await session.output.cancel().catch(() => undefined);
        }
        post({
          type: "error",
          id: request.id,
          message: errorMessage(error),
        });
      }
    })(),
    "export-worker.handle-message",
  );
});
