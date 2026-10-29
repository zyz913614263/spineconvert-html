import { describe, expect, it } from "vitest";

import {
  decimalMegabytesToBytes,
  MAX_GIF_PALETTE_SIZE,
  MIN_GIF_PALETTE_SIZE,
  qualityToGifPaletteSize,
  reduceVideoBitrate,
  scaleDimensionsToFit,
  targetVideoBitrate,
} from "./optimization";

describe("export size optimization", () => {
  it("converts decimal megabytes and clamps invalid limits", () => {
    expect(decimalMegabytesToBytes(4)).toBe(4_000_000);
    expect(decimalMegabytesToBytes(0)).toBe(100_000);
    expect(decimalMegabytesToBytes(Number.NaN)).toBe(4_000_000);
  });

  it("maps the quality range onto valid GIF palette sizes", () => {
    expect(qualityToGifPaletteSize(0)).toBe(2);
    expect(qualityToGifPaletteSize(1)).toBe(MAX_GIF_PALETTE_SIZE);
    expect(qualityToGifPaletteSize(0.8)).toBeGreaterThan(MIN_GIF_PALETTE_SIZE);
  });

  it("reserves container headroom in the video bitrate", () => {
    expect(targetVideoBitrate(4_000_000, 2)).toBe(14_400_000);
    expect(() => targetVideoBitrate(4_000_000, 0)).toThrow("duration");
  });

  it("reduces bitrate after an oversized pass", () => {
    expect(reduceVideoBitrate(8_000_000, 4_000_000, 8_000_000)).toBe(3_600_000);
    expect(reduceVideoBitrate(8_000_000, 4_000_000, 3_000_000)).toBe(8_000_000);
  });

  it("shrinks dimensions without changing aspect ratio or MP4 parity", () => {
    const dimensions = scaleDimensionsToFit(1024, 512, 1_000_000, 4_000_000, true);
    expect(dimensions.width % 2).toBe(0);
    expect(dimensions.height % 2).toBe(0);
    expect(dimensions.width / dimensions.height).toBeCloseTo(2, 1);
    expect(dimensions.width).toBeLessThan(1024);
  });
});
