import { normalizeBounds, type Bounds } from "../domain/export/layout";

export type ViewState = {
  zoomPercent: number;
  cameraX: number;
  cameraY: number;
  zoom: number;
  canvasWidth: number;
  canvasHeight: number;
  viewportWidth: number;
  viewportHeight: number;
};

export type ProjectedBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function projectBoundsToViewport(bounds: Bounds, view: ViewState): ProjectedBounds {
  const normalized = normalizeBounds(bounds);
  const pixelRatioX = view.viewportWidth / Math.max(1, view.canvasWidth);
  const pixelRatioY = view.viewportHeight / Math.max(1, view.canvasHeight);
  const left = (view.canvasWidth / 2 + (normalized.x - view.cameraX) / view.zoom) * pixelRatioX;
  const right =
    (view.canvasWidth / 2 + (normalized.x + normalized.width - view.cameraX) / view.zoom) *
    pixelRatioX;
  const top =
    (view.canvasHeight / 2 - (normalized.y + normalized.height - view.cameraY) / view.zoom) *
    pixelRatioY;
  const bottom = (view.canvasHeight / 2 - (normalized.y - view.cameraY) / view.zoom) * pixelRatioY;
  return { left, top, width: right - left, height: bottom - top };
}
