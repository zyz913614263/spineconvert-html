export const DEFAULT_MAX_FILE_SIZE_MEGABYTES = 4;
export const MIN_MAX_FILE_SIZE_MEGABYTES = 0.1;
export const MAX_MAX_FILE_SIZE_MEGABYTES = 1024;
export const MIN_GIF_PALETTE_SIZE = 16;
export const MAX_GIF_PALETTE_SIZE = 255;
export const MAX_SIZE_OPTIMIZATION_PASSES = 7;
export const MAX_GIF_RAW_FRAME_BYTES = 1024 * 1024 * 1024;

const DECIMAL_MEGABYTE = 1_000_000;
const SIZE_HEADROOM = 0.9;
const MIN_VIDEO_BITRATE = 1_000;
const MIN_EXPORT_DIMENSION = 2;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function decimalMegabytesToBytes(megabytes: number): number {
  const bounded = clamp(
    Number.isFinite(megabytes) ? megabytes : DEFAULT_MAX_FILE_SIZE_MEGABYTES,
    MIN_MAX_FILE_SIZE_MEGABYTES,
    MAX_MAX_FILE_SIZE_MEGABYTES,
  );
  return Math.round(bounded * DECIMAL_MEGABYTE);
}

export function qualityToGifPaletteSize(quality: number): number {
  const bounded = clamp(Number.isFinite(quality) ? quality : 0.8, 0, 1);
  return Math.round(2 + bounded * (MAX_GIF_PALETTE_SIZE - 2));
}

export function targetVideoBitrate(maxBytes: number, durationSeconds: number): number {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error("The file-size limit must be greater than zero bytes.");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("The animation duration must be greater than zero seconds.");
  }
  return Math.max(MIN_VIDEO_BITRATE, Math.floor((maxBytes * 8 * SIZE_HEADROOM) / durationSeconds));
}

export function reduceVideoBitrate(
  currentBitrate: number,
  maxBytes: number,
  encodedBytes: number,
): number {
  if (encodedBytes <= maxBytes) return currentBitrate;
  const measuredRatio = maxBytes / encodedBytes;
  const reduced = Math.floor(currentBitrate * measuredRatio * SIZE_HEADROOM);
  return Math.max(MIN_VIDEO_BITRATE, Math.min(currentBitrate - 1, reduced));
}

export type ScaledExportDimensions = {
  width: number;
  height: number;
};

export function scaleDimensionsToFit(
  width: number,
  height: number,
  maxBytes: number,
  encodedBytes: number,
  requireEvenDimensions: boolean,
): ScaledExportDimensions {
  if (encodedBytes <= maxBytes) return { width, height };

  const measuredScale = Math.sqrt(maxBytes / encodedBytes) * 0.94;
  const scale = Math.min(0.9, measuredScale);
  let nextWidth = Math.max(MIN_EXPORT_DIMENSION, Math.floor(width * scale));
  let nextHeight = Math.max(MIN_EXPORT_DIMENSION, Math.floor(height * scale));

  if (requireEvenDimensions) {
    nextWidth = Math.max(MIN_EXPORT_DIMENSION, nextWidth - (nextWidth % 2));
    nextHeight = Math.max(MIN_EXPORT_DIMENSION, nextHeight - (nextHeight % 2));
  }

  if (nextWidth === width && width > MIN_EXPORT_DIMENSION)
    nextWidth -= requireEvenDimensions ? 2 : 1;
  if (nextHeight === height && height > MIN_EXPORT_DIMENSION) {
    nextHeight -= requireEvenDimensions ? 2 : 1;
  }
  return { width: nextWidth, height: nextHeight };
}
