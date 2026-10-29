import { useSyncExternalStore } from "react";

/** Stores playback time outside React so the render loop does not rerender the app. */
export class PlaybackClock {
  #time = 0;
  readonly #listeners = new Set<() => void>();

  readonly get = (): number => this.#time;

  readonly set = (time: number): void => {
    if (time === this.#time) return;
    this.#time = time;
    for (const listener of this.#listeners) listener();
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
}

/** Subscribes one component to the playhead. */
export function usePlayhead(clock: PlaybackClock): number {
  return useSyncExternalStore(clock.subscribe, clock.get, clock.get);
}
