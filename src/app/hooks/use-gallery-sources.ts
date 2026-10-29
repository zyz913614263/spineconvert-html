import { useCallback, useMemo } from "react";
import { type } from "arktype";

import {
  BUILT_IN_GALLERY_SOURCES,
  DEFAULT_GALLERY_SOURCE,
  DEFAULT_GALLERY_SOURCE_ID,
  persistedGallerySources,
  storedGallerySources,
  toStoredSource,
  type GallerySource,
} from "@/domain/gallery/sources";

import { usePersistentState } from "./use-persistent-state";

const CUSTOM_SOURCES_KEY = "spine-thing.gallery-sources";
const SELECTED_SOURCE_KEY = "spine-thing.gallery-source";
const persistedSourceId = type("string");

export type GallerySources = {
  readonly sources: readonly GallerySource[];
  readonly selected: GallerySource;
  readonly selectSource: (id: string) => void;
  /** Adds and selects a library. */
  readonly addSource: (source: GallerySource) => void;
  readonly removeSource: (id: string) => void;
};

/** Combines built-in libraries with custom libraries stored on this device. */
export function useGallerySources(): GallerySources {
  const [stored, setStored] = usePersistentState(CUSTOM_SOURCES_KEY, [], persistedGallerySources);
  const [selectedId, setSelectedId] = usePersistentState(
    SELECTED_SOURCE_KEY,
    DEFAULT_GALLERY_SOURCE_ID,
    persistedSourceId,
  );

  const custom = useMemo(() => storedGallerySources.assert(stored), [stored]);
  const sources = useMemo(() => [...BUILT_IN_GALLERY_SOURCES, ...custom], [custom]);

  // Fall back if the saved selection no longer exists.
  const selected = sources.find((source) => source.id === selectedId) ?? DEFAULT_GALLERY_SOURCE;

  const addSource = useCallback(
    (source: GallerySource) => {
      setStored((current) => {
        const next = storedGallerySources.assert(current).filter((entry) => entry.id !== source.id);
        return [...next.map(toStoredSource), toStoredSource(source)];
      });
      setSelectedId(source.id);
    },
    [setSelectedId, setStored],
  );

  const removeSource = useCallback(
    (id: string) => {
      setStored((current) =>
        storedGallerySources
          .assert(current)
          .filter((entry) => entry.id !== id)
          .map(toStoredSource),
      );
      setSelectedId((current) => (current === id ? DEFAULT_GALLERY_SOURCE_ID : current));
    },
    [setSelectedId, setStored],
  );

  const selectSource = useCallback((id: string) => setSelectedId(id), [setSelectedId]);

  return { sources, selected, selectSource, addSource, removeSource };
}
