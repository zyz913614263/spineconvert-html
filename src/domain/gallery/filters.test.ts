import { describe, expect, it } from "vitest";

import { galleryFacetKey, galleryItemFacetIndex, matchesGalleryFacetSelection } from "./filters";

describe("gallery facet filters", () => {
  const hero = galleryItemFacetIndex({
    collection: " Characters ",
    tags: [" Hero ", "Aim", "hero"],
  });

  it("normalizes collection and tag keys without merging their namespaces", () => {
    expect(hero.collectionKey).toBe("collection:characters");
    expect([...hero.tagKeys]).toEqual(["tag:hero", "tag:aim"]);
    expect(galleryFacetKey("tag", "Characters")).toBe("tag:characters");
    expect(galleryFacetKey("collection", "Characters")).toBe("collection:characters");
    expect(galleryFacetKey("tag", "   ")).toBeNull();
  });

  it("requires every selected tag", () => {
    expect(matchesGalleryFacetSelection(hero, ["tag:hero", "tag:aim"])).toBe(true);
    expect(matchesGalleryFacetSelection(hero, ["tag:hero", "tag:idle"])).toBe(false);
  });

  it("matches any selected collection and then intersects it with tags", () => {
    expect(
      matchesGalleryFacetSelection(hero, ["collection:effects", "collection:characters"]),
    ).toBe(true);
    expect(matchesGalleryFacetSelection(hero, ["collection:effects"])).toBe(false);
    expect(
      matchesGalleryFacetSelection(hero, [
        "collection:effects",
        "collection:characters",
        "tag:aim",
      ]),
    ).toBe(true);
    expect(
      matchesGalleryFacetSelection(hero, [
        "collection:effects",
        "collection:characters",
        "tag:idle",
      ]),
    ).toBe(false);
  });
});
