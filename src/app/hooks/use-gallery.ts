import { useQuery } from "@tanstack/react-query";

import type { GalleryItem } from "@/domain/gallery/manifest";
import type { GallerySource } from "@/domain/gallery/sources";
import {
  fetchGalleryCatalog,
  GalleryRequestError,
  loadGalleryBundle,
} from "@/services/gallery-client";

function shouldRetry(failureCount: number, error: Error): boolean {
  if (failureCount >= 2) return false;
  return !(
    error instanceof GalleryRequestError &&
    error.status !== undefined &&
    error.status < 500
  );
}

export function useGalleryCatalog(source: GallerySource, enabled: boolean) {
  return useQuery({
    queryKey: [
      "gallery",
      "catalog",
      source.manifestUrl,
      source.defaults?.premultipliedAlpha ?? "auto",
    ],
    queryFn: ({ signal }) => fetchGalleryCatalog(source.manifestUrl, signal, source.defaults),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: shouldRetry,
  });
}

export function useGalleryBundle(
  item: GalleryItem | null,
  catalogUrl: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["gallery", "bundle", catalogUrl, item?.id],
    queryFn: ({ signal }) => {
      if (!item || !catalogUrl) throw new Error("请先选择一个画廊条目。");
      return loadGalleryBundle(item, catalogUrl, signal);
    },
    enabled: enabled && item !== null && catalogUrl !== null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60_000,
    retry: shouldRetry,
  });
}
