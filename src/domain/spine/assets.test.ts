import { describe, expect, it, vi } from "vitest";

import {
  createAssetBundle,
  createAssetBundleFromParts,
  findAtlasImage,
  inspectSpineAsset,
  normalizeAssetPath,
  parseAtlasPageNames,
} from "./assets";

const MULTI_PAGE_ATLAS = `first.png
size: 64, 64
format: RGBA8888
filter: Linear, Linear
repeat: none
region-a
  rotate: false
  xy: 0, 0
  size: 16, 16

textures/second.webp
size: 32, 32
pma: true
region-b
  bounds: 0, 0, 8, 8
`;

describe("Spine asset bundles", () => {
  it("finds atlas page headers without treating regions as pages", () => {
    expect(parseAtlasPageNames(MULTI_PAGE_ATLAS)).toEqual(["first.png", "textures/second.webp"]);
  });

  it("parses atlas files that use carriage-return line endings", () => {
    expect(parseAtlasPageNames("page.png\rsize: 8, 8\rregion\r  xy: 0, 0\r")).toEqual(["page.png"]);
  });

  it("does not classify a versioned atlas filename as binary data", async () => {
    const atlas = new File(["hero-4.2.11.png\nsize: 8, 8\nregion\n  xy: 0, 0\n"], "hero.atlas");
    await expect(inspectSpineAsset(atlas)).resolves.toMatchObject({ kind: "atlas" });
  });

  it("normalizes Windows paths and resolves a unique basename fallback", () => {
    const texture = new File(["texture"], "second.webp", { type: "image/webp" });
    const images = new Map([
      ["second.webp", texture],
      ["bundle/textures/second.webp", texture],
    ]);
    expect(normalizeAssetPath(".\\Textures\\SECOND.webp")).toBe("textures/second.webp");
    expect(findAtlasImage(images, "textures/second.webp")).toBe(texture);
  });

  it("uses the requested relative path when different folders share a basename", () => {
    const first = new File(["first"], "page.png", { type: "image/png" });
    const second = new File(["second"], "page.png", { type: "image/png" });
    const images = new Map([
      ["bundle/a/page.png", first],
      ["bundle/b/page.png", second],
    ]);
    expect(findAtlasImage(images, "b/page.png")).toBe(second);
    expect(findAtlasImage(images, "page.png")).toBeUndefined();
  });

  it("validates a complete multi-page bundle", async () => {
    const skeleton = new File(['{"skeleton":{"spine":"4.2.11"}}'], "sample.json", {
      type: "application/json",
    });
    const atlas = new File([MULTI_PAGE_ATLAS], "sample.atlas");
    const first = new File(["first"], "first.png", { type: "image/png" });
    const second = new File(["second"], "second.webp", { type: "image/webp" });
    const bundle = await createAssetBundle([skeleton, atlas, first, second]);
    expect(bundle.skeletonFormat).toBe("json");
    expect(bundle.pageNames).toHaveLength(2);
  });

  it("reports every missing atlas page", async () => {
    const skeleton = new File(["data"], "sample.skel");
    const atlas = new File([MULTI_PAGE_ATLAS], "sample.atlas");
    await expect(createAssetBundle([skeleton, atlas])).rejects.toThrow(
      "Missing atlas texture pages: first.png, textures/second.webp.",
    );
  });

  it("identifies Unity compound suffixes from content without rewriting filenames", async () => {
    const skeleton = new File(['{"skeleton":{"spine":"4.2.11"}}'], "sample.skel.bytes");
    const atlas = new File([MULTI_PAGE_ATLAS], "sample.atlas.txt");

    await expect(inspectSpineAsset(skeleton)).resolves.toMatchObject({
      kind: "skeleton-json",
      evidence: "Spine JSON structure",
    });
    await expect(inspectSpineAsset(atlas)).resolves.toMatchObject({
      kind: "atlas",
      evidence: "Spine atlas page grammar",
    });
  });

  it("uses payload signatures for extensionless files and files with misleading names", async () => {
    const binary = new File([new Uint8Array([0, 1, 2]), "4.1.24", new Uint8Array([3, 4])], "hero");
    const png = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "texture.payload",
    );

    await expect(inspectSpineAsset(binary)).resolves.toMatchObject({ kind: "skeleton-binary" });
    await expect(inspectSpineAsset(png)).resolves.toMatchObject({ kind: "image" });
  });

  it("reads only the header when an image signature identifies the file", async () => {
    const png = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "texture.data",
    );
    const readWholeFile = vi.spyOn(png, "arrayBuffer");

    await expect(inspectSpineAsset(png)).resolves.toMatchObject({ kind: "image" });
    expect(readWholeFile).not.toHaveBeenCalled();
  });

  it("rejects a declared format that contradicts the skeleton bytes", async () => {
    const skeleton = new File(['{"skeleton":{"spine":"4.2.11"}}'], "hero.data");
    const atlas = new File([MULTI_PAGE_ATLAS], "hero.atlas");
    const first = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "first.png",
    );
    const second = new File(
      [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])],
      "second.webp",
    );

    await expect(
      createAssetBundleFromParts({
        skeleton,
        atlas,
        images: [first, second],
        skeletonFormat: "skel",
      }),
    ).rejects.toThrow("contains JSON data, but the manifest declares SKEL");
  });
});
