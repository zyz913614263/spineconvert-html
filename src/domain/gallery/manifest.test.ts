import { describe, expect, it } from "vitest";

import { galleryCatalogFrom } from "./manifest";

describe("gallery manifests", () => {
  it("parses a bundle with explicit skeleton, atlas, and texture roles", () => {
    const catalog = galleryCatalogFrom("https://assets.example/gallery/manifest.json").assert({
      schemaVersion: 1,
      catalog: { id: "demo", title: "Demo rigs" },
      items: [
        {
          id: "hero/default",
          title: "Hero",
          variant: "Default",
          thumbnail: { url: "./hero/thumb.png" },
          bundle: {
            skeleton: { url: "hero.skel.bytes", format: "auto" },
            atlas: { url: "hero.atlas.txt" },
            textures: [{ url: "hero.png", page: "hero.png" }],
          },
        },
      ],
    });

    expect(catalog.id).toBe("demo");
    expect(catalog.items[0]?.bundle.skeleton?.url).toBe("hero.skel.bytes");
    expect(catalog.items[0]?.thumbnailUrl).toBe("https://assets.example/gallery/hero/thumb.png");
  });

  it("preserves loader IDs for the gallery client to validate", () => {
    const catalog = galleryCatalogFrom("https://assets.example/manifest.json").assert({
      schemaVersion: 1,
      items: [
        {
          id: "wrapped",
          title: "Wrapped",
          bundle: { loader: "game-wrapper-v2", assets: [{ url: "bundle.dat" }] },
        },
      ],
    });
    expect(catalog.items[0]?.bundle.loader).toBe("game-wrapper-v2");
  });

  it("applies source and manifest alpha defaults while preserving item overrides", () => {
    const sourceDefault = galleryCatalogFrom("https://assets.example/manifest.json", {
      premultipliedAlpha: "premultiplied",
    }).assert({
      schemaVersion: 1,
      items: [
        { id: "source-default", title: "Source default", bundle: { assets: [{ url: "a" }] } },
      ],
    });
    expect(sourceDefault.items[0]?.bundle.premultipliedAlpha).toBe("premultiplied");

    const manifestDefault = galleryCatalogFrom("https://assets.example/manifest.json", {
      premultipliedAlpha: "straight",
    }).assert({
      schemaVersion: 1,
      defaults: { premultipliedAlpha: "premultiplied" },
      items: [
        { id: "inherited", title: "Inherited", bundle: { assets: [{ url: "a" }] } },
        {
          id: "overridden",
          title: "Overridden",
          bundle: { premultipliedAlpha: "auto", assets: [{ url: "b" }] },
        },
      ],
    });
    expect(manifestDefault.items[0]?.bundle.premultipliedAlpha).toBe("premultiplied");
    expect(manifestDefault.items[1]?.bundle.premultipliedAlpha).toBe("auto");
  });

  it("rejects a payload that is not a v1 manifest", () => {
    expect(() => galleryCatalogFrom("https://assets.example/manifest.json").assert({})).toThrow(
      /schemaVersion/,
    );
  });

  it("rejects a bundle that declares neither assets nor a skeleton trio", () => {
    expect(() =>
      galleryCatalogFrom("https://assets.example/manifest.json").assert({
        schemaVersion: 1,
        items: [{ id: "bare", title: "Bare", bundle: {} }],
      }),
    ).toThrow(/assets/);
  });

  it("rejects a duplicated item id", () => {
    const item = {
      id: "hero",
      title: "Hero",
      bundle: { assets: [{ url: "hero.skel.bytes" }] },
    };
    expect(() =>
      galleryCatalogFrom("https://assets.example/manifest.json").assert({
        schemaVersion: 1,
        items: [item, item],
      }),
    ).toThrow(/duplicated/);
  });

  it("rejects links with executable URL schemes", () => {
    expect(() =>
      galleryCatalogFrom("https://assets.example/manifest.json").assert({
        schemaVersion: 1,
        items: [
          {
            id: "unsafe",
            title: "Unsafe",
            attribution: { label: "Bad link", url: "javascript:alert(1)" },
            bundle: { assets: [{ url: "hero.skel" }] },
          },
        ],
      }),
    ).toThrow(/HTTP or HTTPS/);
  });

  it("rejects invalid asset sizes and hashes", () => {
    const parse = galleryCatalogFrom("https://assets.example/manifest.json");
    expect(() =>
      parse.assert({
        schemaVersion: 1,
        items: [
          {
            id: "fractional",
            title: "Fractional size",
            bundle: { assets: [{ url: "hero.skel", bytes: 1.5 }] },
          },
        ],
      }),
    ).toThrow(/integer/);
    expect(() =>
      parse.assert({
        schemaVersion: 1,
        items: [
          {
            id: "bad-hash",
            title: "Bad hash",
            bundle: { assets: [{ url: "hero.skel", sha256: "not-a-hash" }] },
          },
        ],
      }),
    ).toThrow(/SHA-256/);
  });
});
