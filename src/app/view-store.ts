import { useSyncExternalStore } from "react";

import {
  projectBoundsToViewport,
  type ProjectedBounds,
  type ViewState,
} from "@/render/view-projection";
import type { Bounds } from "@/domain/export/layout";

const INITIAL_VIEW_STATE: ViewState = {
  zoomPercent: 100,
  cameraX: 0,
  cameraY: 0,
  zoom: 1,
  canvasWidth: 1,
  canvasHeight: 1,
  viewportWidth: 1,
  viewportHeight: 1,
};

function sameView(left: ViewState, right: ViewState): boolean {
  return (
    left.zoomPercent === right.zoomPercent &&
    left.cameraX === right.cameraX &&
    left.cameraY === right.cameraY &&
    left.zoom === right.zoom &&
    left.canvasWidth === right.canvasWidth &&
    left.canvasHeight === right.canvasHeight &&
    left.viewportWidth === right.viewportWidth &&
    left.viewportHeight === right.viewportHeight
  );
}

/** Stores camera state outside React so pointer movement does not rerender the app. */
export class ViewStore {
  #state: ViewState = INITIAL_VIEW_STATE;
  readonly #listeners = new Set<() => void>();

  readonly get = (): ViewState => this.#state;

  readonly set = (state: ViewState): void => {
    if (sameView(state, this.#state)) return;
    this.#state = state;
    for (const listener of this.#listeners) listener();
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
}

/** Subscribes to the zoom readout alone, so camera panning does not re-render it. */
export function useZoomPercent(store: ViewStore): number {
  return useSyncExternalStore(
    store.subscribe,
    () => store.get().zoomPercent,
    () => store.get().zoomPercent,
  );
}

/** Projects world bounds into viewport pixels, tracking the live camera. */
export function useProjectedBounds(store: ViewStore, bounds: Bounds): ProjectedBounds {
  const view = useSyncExternalStore(store.subscribe, store.get, store.get);
  return projectBoundsToViewport(bounds, view);
}
