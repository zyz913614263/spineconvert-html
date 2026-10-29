import { describe, expect, it, vi } from "vitest";

import type { GalleryItem } from "@/domain/gallery/manifest";

import {
  loadGalleryBundle,
  registerGalleryBundleLoader,
  type GalleryBundleLoader,
} from "./gallery-client";

function itemWithLoader(loader: string): GalleryItem {
  return {
    id: "wrapped",
    title: "Wrapped rig",
    tags: [],
    bundle: { loader, assets: [{ url: "wrapped.dat" }] },
  };
}

describe("gallery bundle loader registry", () => {
  it("rejects non-HTTP asset URLs", async () => {
    await expect(
      loadGalleryBundle(
        {
          id: "data-url",
          title: "Data URL",
          tags: [],
          bundle: { assets: [{ url: "data:application/octet-stream,test" }] },
        },
        "https://assets.example/manifest.json",
        new AbortController().signal,
      ),
    ).rejects.toThrow(/HTTP or HTTPS/);
  });

  it("rejects loader IDs absent from the registry", async () => {
    await expect(
      loadGalleryBundle(
        itemWithLoader("missing-wrapper-v1"),
        "https://assets.example/manifest.json",
        new AbortController().signal,
      ),
    ).rejects.toThrow("missing-wrapper-v1");
  });

  it("calls a registered loader", async () => {
    const load = vi.fn<GalleryBundleLoader["load"]>(async () => {
      throw new Error("custom loader reached");
    });
    const unregister = registerGalleryBundleLoader({ id: "test-wrapper-v1", load });

    try {
      await expect(
        loadGalleryBundle(
          itemWithLoader("test-wrapper-v1"),
          "https://assets.example/manifest.json",
          new AbortController().signal,
        ),
      ).rejects.toThrow("custom loader reached");
      expect(load).toHaveBeenCalledOnce();
    } finally {
      unregister();
    }
  });

  it("keeps a replacement loader when stale cleanup runs", async () => {
    const firstLoad = vi.fn<GalleryBundleLoader["load"]>();
    const removeFirst = registerGalleryBundleLoader({ id: "replaceable-loader", load: firstLoad });
    removeFirst();

    const secondLoad = vi.fn<GalleryBundleLoader["load"]>(async () => {
      throw new Error("second loader reached");
    });
    const removeSecond = registerGalleryBundleLoader({
      id: "replaceable-loader",
      load: secondLoad,
    });

    try {
      removeFirst();
      await expect(
        loadGalleryBundle(
          itemWithLoader("replaceable-loader"),
          "https://assets.example/manifest.json",
          new AbortController().signal,
        ),
      ).rejects.toThrow("second loader reached");
      expect(secondLoad).toHaveBeenCalledOnce();
    } finally {
      removeSecond();
    }
  });
});
