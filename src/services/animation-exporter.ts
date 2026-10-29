import type { ExportFormat, ExportSettings } from "../domain/export/protocol";
import { fitExportLayout, type Bounds, type ExportLayout } from "../domain/export/layout";
import {
  MAX_SIZE_OPTIMIZATION_PASSES,
  MAX_GIF_RAW_FRAME_BYTES,
  MIN_GIF_PALETTE_SIZE,
  qualityToGifPaletteSize,
  reduceVideoBitrate,
  scaleDimensionsToFit,
  targetVideoBitrate,
} from "../domain/export/optimization";
import type { SpineAssetBundle } from "../domain/spine/assets";
import { SpineRenderer, type PremultipliedAlphaMode } from "../render/spine-renderer";
import { ExportClient, type ExportResult } from "./export-client";

export type AnimationExportSource = {
  json: string;
  bundle: SpineAssetBundle;
  /** Base clip followed by overlays in playback order. */
  animations: readonly string[];
  skin: string;
};

export type AnimationExportOptions = {
  format: ExportFormat;
  width: number;
  height: number;
  fps: number;
  duration: number;
  quality: number;
  transparent: boolean;
  background: string;
  autoFit: boolean;
  padding: number;
  /** Texture alpha mode used by the preview. */
  premultipliedAlpha: PremultipliedAlphaMode;
  /** Loops short overlays or holds their last frame. */
  looping: boolean;
  manualBounds?: Bounds;
  maxBytes?: number;
  signal?: AbortSignal;
  onMeasureProgress?: (completed: number, total: number) => void;
  onLayout?: (layout: ExportLayout, pass: number) => void;
  onProgress?: (completed: number, total: number, pass: number) => void;
};

export type AnimationExportResult = ExportResult & {
  width: number;
  height: number;
  bounds: Bounds;
  passes: number;
};

export type StillCaptureOptions = {
  /** Playhead time in seconds. */
  time: number;
  width: number;
  height: number;
  autoFit: boolean;
  padding: number;
  /** Six-digit renderer color. The PNG keeps a zero alpha channel. */
  background: string;
  /** Texture alpha mode used by the preview. */
  premultipliedAlpha: PremultipliedAlphaMode;
  /** Loops short overlays or holds their last frame. */
  looping: boolean;
  /** Uses these bounds instead of the current pose bounds. */
  manualBounds?: Bounds;
};

export type StillCaptureResult = {
  blob: Blob;
  width: number;
  height: number;
};

/** Encodes the renderer's straight-alpha RGBA bytes as PNG. */
async function encodePng(rgba: Uint8Array, width: number, height: number): Promise<Blob> {
  const pixels = new Uint8ClampedArray(rgba.byteLength);
  pixels.set(rgba);
  const image = new ImageData(pixels, width, height);

  if ("OffscreenCanvas" in globalThis) {
    const surface = new OffscreenCanvas(width, height);
    const context = surface.getContext("2d");
    if (!context) throw new Error("A 2D canvas is required to encode PNG frames.");
    context.putImageData(image, 0, 0);
    return surface.convertToBlob({ type: "image/png" });
  }

  const surface = document.createElement("canvas");
  surface.width = width;
  surface.height = height;
  const context = surface.getContext("2d");
  if (!context) throw new Error("A 2D canvas is required to encode PNG frames.");
  context.putImageData(image, 0, 0);
  return new Promise((resolve, reject) => {
    surface.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not encode this frame as PNG."));
    }, "image/png");
  });
}

export class AnimationExporter {
  readonly #client: ExportClient;

  constructor(client = new ExportClient()) {
    this.#client = client;
  }

  async export(
    source: AnimationExportSource,
    options: AnimationExportOptions,
  ): Promise<AnimationExportResult> {
    const maxBytes = options.maxBytes;
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)) {
      throw new Error("The file-size limit must be a positive whole number of bytes.");
    }
    const captureCanvas = document.createElement("canvas");
    const renderer = new SpineRenderer(captureCanvas, () => undefined, {
      background: options.background,
      interactive: false,
      premultipliedAlpha: options.premultipliedAlpha,
    });
    const frameCount = Math.max(1, Math.ceil(options.duration * options.fps));

    try {
      await renderer.load(source.json, source.bundle);
      renderer.setLooping(options.looping);
      renderer.selectAnimations(source.animations);
      if (source.skin) renderer.selectSkin(source.skin);
      renderer.setPlaying(false);

      const bounds =
        options.manualBounds ??
        (await renderer.measureAnimationBounds(
          frameCount,
          options.fps,
          options.signal,
          options.onMeasureProgress,
        ));
      let pass = 0;
      const makeLayout = (width: number, height: number): ExportLayout => {
        const dimensionScale = Math.min(width / options.width, height / options.height, 1);
        const fitted = fitExportLayout(
          bounds,
          width,
          height,
          Math.round(options.padding * dimensionScale),
          options.autoFit,
        );
        return options.format === "mp4"
          ? {
              ...fitted,
              width: Math.min(4096, fitted.width + (fitted.width % 2)),
              height: Math.min(4096, fitted.height + (fitted.height % 2)),
            }
          : fitted;
      };
      const encodePass = async (
        width: number,
        height: number,
        overrides: Pick<ExportSettings, "bitrate" | "gifPaletteSize"> = {},
      ): Promise<AnimationExportResult> => {
        if (maxBytes !== undefined && pass >= MAX_SIZE_OPTIMIZATION_PASSES) {
          throw new Error(
            `The export did not fit the file limit after ${MAX_SIZE_OPTIMIZATION_PASSES} passes. Raise the limit or lower the dimensions.`,
          );
        }
        pass += 1;
        const layout = makeLayout(width, height);
        options.onLayout?.(layout, pass);
        const settings: ExportSettings = {
          format: options.format,
          width: layout.width,
          height: layout.height,
          fps: options.fps,
          frameCount,
          quality: options.quality,
          transparent: options.format === "mp4" ? false : options.transparent,
          ...overrides,
        };
        const session = this.#client.createSession(settings);

        await session.start();
        try {
          for (let index = 0; index < frameCount; index += 1) {
            if (options.signal?.aborted) throw new DOMException("Export canceled.", "AbortError");
            const rgba = renderer.capture({
              width: layout.width,
              height: layout.height,
              bounds: layout.bounds,
              padding: layout.padding,
              time: index / options.fps,
              delta: index === 0 ? 0 : 1 / options.fps,
              transparent: options.format === "mp4" ? false : options.transparent,
              background: options.background,
              firstFrame: index === 0,
            });
            await session.addFrame(rgba);
            options.onProgress?.(index + 1, frameCount, pass);
            if (index % 4 === 3) {
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
          }
          const result = await session.finish();
          return {
            ...result,
            width: layout.width,
            height: layout.height,
            bounds: layout.bounds,
            passes: pass,
          };
        } catch (error) {
          await session.cancel().catch(() => undefined);
          throw error;
        }
      };

      let initialWidth = options.width;
      let initialHeight = options.height;
      if (maxBytes !== undefined && options.format === "gif") {
        const initialLayout = makeLayout(initialWidth, initialHeight);
        const rawFrameBytes = initialLayout.width * initialLayout.height * 4 * frameCount;
        if (rawFrameBytes > MAX_GIF_RAW_FRAME_BYTES) {
          const dimensions = scaleDimensionsToFit(
            initialLayout.width,
            initialLayout.height,
            MAX_GIF_RAW_FRAME_BYTES,
            rawFrameBytes,
            false,
          );
          initialWidth = dimensions.width;
          initialHeight = dimensions.height;
        }
      }

      const initial = await encodePass(initialWidth, initialHeight);
      if (maxBytes === undefined || initial.blob.size <= maxBytes) return initial;

      const result =
        options.format === "gif"
          ? await this.#fitGifToLimit(initial, options, maxBytes, encodePass)
          : await this.#fitVideoToLimit(initial, options, maxBytes, frameCount, encodePass);
      if (result.blob.size <= maxBytes) return result;

      const targetMegabytes = maxBytes / 1_000_000;
      throw new Error(
        `The export could not fit within ${targetMegabytes.toLocaleString(undefined, { maximumFractionDigits: 2 })} MB. Raise the file limit or lower the dimensions.`,
      );
    } finally {
      renderer.dispose();
    }
  }

  async #fitGifToLimit(
    initial: AnimationExportResult,
    options: AnimationExportOptions,
    maxBytes: number,
    encodePass: (
      width: number,
      height: number,
      overrides?: Pick<ExportSettings, "bitrate" | "gifPaletteSize">,
    ) => Promise<AnimationExportResult>,
  ): Promise<AnimationExportResult> {
    const preferredPalette = qualityToGifPaletteSize(options.quality);
    let width = initial.width;
    let height = initial.height;
    let oversized = initial;
    let palette = Math.min(preferredPalette, MIN_GIF_PALETTE_SIZE);
    let fitting: AnimationExportResult | undefined;

    let latest = initial;
    while (latest.passes < MAX_SIZE_OPTIMIZATION_PASSES) {
      const candidate = await encodePass(width, height, { gifPaletteSize: palette });
      latest = candidate;
      if (candidate.blob.size <= maxBytes) {
        fitting = candidate;
        break;
      }

      oversized = candidate;
      const dimensions = scaleDimensionsToFit(
        candidate.width,
        candidate.height,
        maxBytes,
        candidate.blob.size,
        false,
      );
      if (dimensions.width === candidate.width && dimensions.height === candidate.height) break;
      width = dimensions.width;
      height = dimensions.height;
    }

    if (!fitting) return oversized;
    let low = palette;
    let high = preferredPalette;
    while (latest.passes < MAX_SIZE_OPTIMIZATION_PASSES && high - low > 1) {
      const candidatePalette = Math.floor((low + high) / 2);
      const candidate = await encodePass(width, height, { gifPaletteSize: candidatePalette });
      latest = candidate;
      if (candidate.blob.size <= maxBytes) {
        fitting = candidate;
        low = candidatePalette;
      } else {
        high = candidatePalette;
      }
    }
    return fitting;
  }

  async #fitVideoToLimit(
    initial: AnimationExportResult,
    options: AnimationExportOptions,
    maxBytes: number,
    frameCount: number,
    encodePass: (
      width: number,
      height: number,
      overrides?: Pick<ExportSettings, "bitrate" | "gifPaletteSize">,
    ) => Promise<AnimationExportResult>,
  ): Promise<AnimationExportResult> {
    const encodedDuration = frameCount / options.fps;
    let width = initial.width;
    let height = initial.height;
    let oversized = initial;
    let bitrate = targetVideoBitrate(maxBytes, encodedDuration);

    while (oversized.passes < MAX_SIZE_OPTIMIZATION_PASSES) {
      const candidate = await encodePass(width, height, { bitrate });
      if (candidate.blob.size <= maxBytes) return candidate;

      oversized = candidate;
      const reducedBitrate = reduceVideoBitrate(bitrate, maxBytes, candidate.blob.size);
      if (oversized.passes < 4 && reducedBitrate < bitrate) {
        bitrate = reducedBitrate;
        continue;
      }

      const dimensions = scaleDimensionsToFit(
        candidate.width,
        candidate.height,
        maxBytes,
        candidate.blob.size,
        options.format === "mp4",
      );
      if (dimensions.width === candidate.width && dimensions.height === candidate.height) break;
      width = dimensions.width;
      height = dimensions.height;
      bitrate = reducedBitrate;
    }
    return oversized;
  }

  /** Captures a transparent PNG. Auto-fit uses the current pose bounds. */
  async captureStill(
    source: AnimationExportSource,
    options: StillCaptureOptions,
  ): Promise<StillCaptureResult> {
    const captureCanvas = document.createElement("canvas");
    const renderer = new SpineRenderer(captureCanvas, () => undefined, {
      background: options.background,
      interactive: false,
      premultipliedAlpha: options.premultipliedAlpha,
    });

    try {
      await renderer.load(source.json, source.bundle);
      renderer.setLooping(options.looping);
      renderer.selectAnimations(source.animations);
      if (source.skin) renderer.selectSkin(source.skin);
      renderer.setPlaying(false);
      renderer.seek(options.time);

      const bounds = options.manualBounds ?? renderer.measurePoseBounds();
      const layout = fitExportLayout(
        bounds,
        options.width,
        options.height,
        options.padding,
        options.autoFit,
      );
      const rgba = renderer.capture({
        width: layout.width,
        height: layout.height,
        bounds: layout.bounds,
        padding: layout.padding,
        time: options.time,
        delta: 0,
        transparent: true,
        background: options.background,
        firstFrame: true,
      });
      const blob = await encodePng(rgba, layout.width, layout.height);
      return { blob, width: layout.width, height: layout.height };
    } finally {
      renderer.dispose();
    }
  }

  dispose(): void {
    this.#client.dispose();
  }
}
