import { describe, expect, it } from "vitest";

import {
  boundsFromPoints,
  expandBoundsToAspect,
  fitExportLayout,
  normalizeBounds,
  unionBounds,
} from "./layout";

describe("fitExportLayout", () => {
  it("uses the minimum height needed for a landscape animation", () => {
    expect(fitExportLayout({ x: -50, y: -25, width: 100, height: 50 }, 100, 100, 2, true)).toEqual({
      width: 100,
      height: 52,
      padding: 2,
      scale: 0.96,
      bounds: { x: -50, y: -25, width: 100, height: 50 },
    });
  });

  it("uses the minimum width needed for a portrait animation", () => {
    const layout = fitExportLayout({ x: 10, y: 20, width: 25, height: 100 }, 200, 100, 0, true);
    expect(layout).toMatchObject({ width: 25, height: 100, padding: 0, scale: 1 });
  });

  it("keeps exact dimensions when automatic sizing is disabled", () => {
    const layout = fitExportLayout({ x: 0, y: 0, width: 100, height: 50 }, 320, 240, 4, false);
    expect(layout).toMatchObject({ width: 320, height: 240, padding: 4 });
  });

  it("normalizes invalid bounds and clamps dimensions and padding", () => {
    expect(normalizeBounds({ x: Number.NaN, y: 0, width: 0, height: -1 })).toEqual({
      x: -50,
      y: -50,
      width: 100,
      height: 100,
    });
    expect(fitExportLayout({ x: 0, y: 0, width: 1, height: 1 }, 2, 2, 20, true)).toMatchObject({
      width: 2,
      height: 2,
      padding: 0,
    });
  });
});

describe("bounds helpers", () => {
  it("centers a safe frame on the source bounds at the requested aspect", () => {
    const source = { x: 10, y: 20, width: 20, height: 100 };
    const framed = expandBoundsToAspect(source, 1_024, 1_024, 0.05);

    expect(framed.x).toBeCloseTo(-35);
    expect(framed.y).toBeCloseTo(15);
    expect(framed.width).toBeCloseTo(110);
    expect(framed.height).toBeCloseTo(110);
    expect(framed.x).toBeLessThanOrEqual(source.x);
    expect(framed.y).toBeLessThanOrEqual(source.y);
    expect(framed.x + framed.width).toBeGreaterThanOrEqual(source.x + source.width);
    expect(framed.y + framed.height).toBeGreaterThanOrEqual(source.y + source.height);
  });

  it("falls back to a square aspect for invalid target dimensions", () => {
    const framed = expandBoundsToAspect({ x: 0, y: 0, width: 80, height: 20 }, 0, NaN);
    expect(framed).toEqual({ x: 0, y: -30, width: 80, height: 80 });
  });

  it("unions visual, bone, and setup envelopes", () => {
    expect(
      unionBounds(
        { x: -8, y: -4, width: 16, height: 8 },
        { x: -40, y: -2, width: 80, height: 4 },
        { x: -10, y: -20, width: 20, height: 40 },
      ),
    ).toEqual({ x: -40, y: -20, width: 80, height: 40 });
  });

  it("turns a line of bone points into a usable non-zero envelope", () => {
    expect(
      boundsFromPoints(
        [
          { x: 0, y: 5 },
          { x: 120, y: 5 },
        ],
        4,
      ),
    ).toEqual({ x: 0, y: 3, width: 120, height: 4 });
  });

  it("falls back when an extent or edge overflows", () => {
    expect(boundsFromPoints([{ x: 4, y: 8 }], Number.POSITIVE_INFINITY)).toEqual({
      x: 3.5,
      y: 7.5,
      width: 1,
      height: 1,
    });
    expect(
      normalizeBounds({ x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 1 }),
    ).toEqual({ x: -50, y: -50, width: 100, height: 100 });
    expect(
      boundsFromPoints([
        { x: -Number.MAX_VALUE, y: 0 },
        { x: Number.MAX_VALUE, y: 1 },
      ]),
    ).toBeNull();
    expect(
      unionBounds(
        { x: -Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 1 },
        { x: 0, y: 0, width: Number.MAX_VALUE, height: 1 },
      ),
    ).toEqual({ x: -50, y: -50, width: 100, height: 100 });
  });
});
