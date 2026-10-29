import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  normalizeSpineExportName,
  spineBundleZipFilename,
  zipSpineAssetBundle,
} from "./spine-bundle-zip";

describe("normalizeSpineExportName", () => {
  it("strips Unity TextAsset and bytes suffixes", () => {
    expect(normalizeSpineExportName("hero/hero.skel.bytes")).toBe("hero.skel");
    expect(normalizeSpineExportName("hero.atlas.txt")).toBe("hero.atlas");
    expect(normalizeSpineExportName("hero.json.bytes")).toBe("hero.json");
    expect(normalizeSpineExportName("hero.skel")).toBe("hero.skel");
    expect(normalizeSpineExportName("hero.atlas")).toBe("hero.atlas");
  });
});

describe("spineBundleZipFilename", () => {
  it("strips Spine and Unity-style suffixes", () => {
    expect(spineBundleZipFilename("hero.skel.bytes")).toBe("hero.zip");
    expect(spineBundleZipFilename("hero.json")).toBe("hero.zip");
    expect(spineBundleZipFilename("path/to/hero.skel")).toBe("hero.zip");
  });
});

describe("zipSpineAssetBundle", () => {
  it("packs the skeleton, atlas, and texture pages into one zip", async () => {
    const skeleton = new File([new Uint8Array([1, 2, 3])], "hero/hero.skel.bytes");
    const atlas = new File(
      [new TextEncoder().encode("hero.png\nsize: 32,32\n")],
      "hero/hero.atlas.txt",
    );
    const texture = new File([new Uint8Array([9, 8, 7])], "hero/hero.png");
    const zipped = await zipSpineAssetBundle({
      skeleton,
      skeletonFormat: "skel",
      atlas,
      atlasText: "hero.png\nsize: 32,32\n",
      images: new Map([["hero.png", texture]]),
      pageNames: ["hero.png"],
    });

    const entries = unzipSync(zipped);
    expect(Object.keys(entries).sort()).toEqual(["hero.atlas", "hero.png", "hero.skel"]);
    expect(entries["hero.skel"]).toEqual(new Uint8Array([1, 2, 3]));
    expect(entries["hero.png"]).toEqual(new Uint8Array([9, 8, 7]));
    expect(new TextDecoder().decode(entries["hero.atlas"])).toBe("hero.png\nsize: 32,32\n");
  });

  it("resolves texture pages via basename when map keys are normalized paths", async () => {
    const skeleton = new File([new Uint8Array([1])], "Abishai.skel.bytes");
    const atlasText = "Abishai.png\nsize: 64,64\nformat: RGBA8888\n";
    const atlas = new File([new TextEncoder().encode(atlasText)], "Abishai.atlas.txt");
    const texture = new File([new Uint8Array([4, 5, 6])], "Abishai.png");
    const zipped = await zipSpineAssetBundle({
      skeleton,
      skeletonFormat: "skel",
      atlas,
      atlasText,
      // Gallery bundles key images with lowercase/normalized paths.
      images: new Map([["abishai.png", texture]]),
      pageNames: ["Abishai.png"],
    });

    const entries = unzipSync(zipped);
    expect(Object.keys(entries).sort()).toEqual(["Abishai.atlas", "Abishai.png", "Abishai.skel"]);
    expect(entries["Abishai.png"]).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("flattens nested atlas page paths inside the exported atlas", async () => {
    const skeleton = new File([new Uint8Array([1])], "hero.skel");
    const atlasText = "textures/hero.png\nsize: 8,8\n";
    const atlas = new File([new TextEncoder().encode(atlasText)], "hero.atlas");
    const texture = new File([new Uint8Array([7])], "textures/hero.png");
    const zipped = await zipSpineAssetBundle({
      skeleton,
      skeletonFormat: "skel",
      atlas,
      atlasText,
      images: new Map([["textures/hero.png", texture]]),
      pageNames: ["textures/hero.png"],
    });

    const entries = unzipSync(zipped);
    expect(Object.keys(entries).sort()).toEqual(["hero.atlas", "hero.png", "hero.skel"]);
    expect(new TextDecoder().decode(entries["hero.atlas"])).toBe("hero.png\nsize: 8,8\n");
  });
});
