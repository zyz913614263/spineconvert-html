export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ExportLayout = {
  width: number;
  height: number;
  padding: number;
  scale: number;
  bounds: Bounds;
};

const FALLBACK_BOUNDS: Bounds = { x: -50, y: -50, width: 100, height: 100 };

export function boundsFromPoints(
  points: ReadonlyArray<Readonly<{ x: number; y: number }>>,
  minimumExtent = 1,
): Bounds | null {
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minimumX = Math.min(minimumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumX = Math.max(maximumX, point.x);
    maximumY = Math.max(maximumY, point.y);
  }

  if (![minimumX, minimumY, maximumX, maximumY].every(Number.isFinite)) return null;
  const safeExtent = Number.isFinite(minimumExtent)
    ? Math.max(Number.EPSILON, Math.abs(minimumExtent))
    : 1;
  if (maximumX - minimumX < safeExtent) {
    const center = minimumX + (maximumX - minimumX) / 2;
    minimumX = center - safeExtent / 2;
    maximumX = center + safeExtent / 2;
  }
  if (maximumY - minimumY < safeExtent) {
    const center = minimumY + (maximumY - minimumY) / 2;
    minimumY = center - safeExtent / 2;
    maximumY = center + safeExtent / 2;
  }

  const width = maximumX - minimumX;
  const height = maximumY - minimumY;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  return {
    x: minimumX,
    y: minimumY,
    width,
    height,
  };
}

export function unionBounds(...candidates: ReadonlyArray<Bounds | null | undefined>): Bounds {
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    if (
      !candidate ||
      !Number.isFinite(candidate.x) ||
      !Number.isFinite(candidate.y) ||
      !Number.isFinite(candidate.width) ||
      !Number.isFinite(candidate.height) ||
      candidate.width <= 0 ||
      candidate.height <= 0
    ) {
      continue;
    }
    minimumX = Math.min(minimumX, candidate.x);
    minimumY = Math.min(minimumY, candidate.y);
    maximumX = Math.max(maximumX, candidate.x + candidate.width);
    maximumY = Math.max(maximumY, candidate.y + candidate.height);
  }

  if (![minimumX, minimumY, maximumX, maximumY].every(Number.isFinite)) {
    return { ...FALLBACK_BOUNDS };
  }
  const width = maximumX - minimumX;
  const height = maximumY - minimumY;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return { ...FALLBACK_BOUNDS };
  return {
    x: minimumX,
    y: minimumY,
    width,
    height,
  };
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  const integer = Number.isFinite(value) ? Math.round(value) : minimum;
  return Math.min(maximum, Math.max(minimum, integer));
}

export function normalizeBounds(bounds: Bounds): Bounds {
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width < Number.EPSILON ||
    bounds.height < Number.EPSILON ||
    !Number.isFinite(bounds.x + bounds.width) ||
    !Number.isFinite(bounds.y + bounds.height)
  ) {
    return { ...FALLBACK_BOUNDS };
  }
  return { ...bounds };
}

/** Adds breathing room and expands an envelope to a target aspect ratio. */
export function expandBoundsToAspect(
  bounds: Bounds,
  targetWidth: number,
  targetHeight: number,
  margin = 0,
): Bounds {
  const normalized = normalizeBounds(bounds);
  const safeMargin = Number.isFinite(margin) ? Math.min(1, Math.max(0, margin)) : 0;
  const aspect =
    Number.isFinite(targetWidth) &&
    Number.isFinite(targetHeight) &&
    targetWidth > 0 &&
    targetHeight > 0
      ? targetWidth / targetHeight
      : 1;
  const centerX = normalized.x + normalized.width / 2;
  const centerY = normalized.y + normalized.height / 2;
  let width = normalized.width * (1 + safeMargin * 2);
  let height = normalized.height * (1 + safeMargin * 2);

  if (width / height > aspect) height = width / aspect;
  else width = height * aspect;

  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

export function fitExportLayout(
  bounds: Bounds,
  maxWidth: number,
  maxHeight: number,
  requestedPadding: number,
  autoFit: boolean,
): ExportLayout {
  const normalized = normalizeBounds(bounds);
  const widthLimit = clampInteger(maxWidth, 2, 4096);
  const heightLimit = clampInteger(maxHeight, 2, 4096);
  const maximumPadding = Math.floor((Math.min(widthLimit, heightLimit) - 1) / 2);
  const padding = clampInteger(requestedPadding, 0, maximumPadding);
  const availableWidth = Math.max(1, widthLimit - padding * 2);
  const availableHeight = Math.max(1, heightLimit - padding * 2);
  const scale = Math.min(availableWidth / normalized.width, availableHeight / normalized.height);

  if (!autoFit) {
    return {
      width: widthLimit,
      height: heightLimit,
      padding,
      scale,
      bounds: normalized,
    };
  }

  const contentWidth = Math.min(availableWidth, Math.max(1, Math.ceil(normalized.width * scale)));
  const contentHeight = Math.min(
    availableHeight,
    Math.max(1, Math.ceil(normalized.height * scale)),
  );
  return {
    width: Math.max(2, contentWidth + padding * 2),
    height: Math.max(2, contentHeight + padding * 2),
    padding,
    scale,
    bounds: normalized,
  };
}
