export type GalleryFacetKind = "collection" | "tag";

export type GalleryFacetIndex = {
  readonly collectionKey: string | null;
  readonly tagKeys: ReadonlySet<string>;
};

export function galleryFacetKey(kind: GalleryFacetKind, value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized ? `${kind}:${normalized}` : null;
}

export function galleryItemFacetIndex(item: {
  readonly collection?: string;
  readonly tags: readonly string[];
}): GalleryFacetIndex {
  const tagKeys = new Set<string>();
  for (const tag of item.tags) {
    const key = galleryFacetKey("tag", tag);
    if (key) tagKeys.add(key);
  }

  return {
    collectionKey: galleryFacetKey("collection", item.collection ?? ""),
    tagKeys,
  };
}

export function matchesGalleryFacetSelection(
  item: GalleryFacetIndex,
  selectedKeys: readonly string[],
): boolean {
  let hasCollectionSelection = false;
  let collectionMatches = false;

  for (const key of selectedKeys) {
    if (key.startsWith("tag:")) {
      if (!item.tagKeys.has(key)) return false;
      continue;
    }

    if (key.startsWith("collection:")) {
      hasCollectionSelection = true;
      if (item.collectionKey === key) collectionMatches = true;
    }
  }

  // An item has at most one collection, so collection selections broaden each other.
  return !hasCollectionSelection || collectionMatches;
}
