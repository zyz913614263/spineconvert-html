import { describe, expect, it } from "vitest";

import sourceConfig from "@/config/gallery-sources.json";
import {
  BUILT_IN_GALLERY_SOURCES,
  createCustomSource,
  normalizeManifestUrl,
  builtInSourcesConfig,
  storedGallerySources,
  sourceHost,
  suggestSourceLabel,
} from "./sources";

describe("the shipped gallery-sources.json", () => {
  it("parses and exposes at least one library", () => {
    expect(() => builtInSourcesConfig.assert(sourceConfig)).not.toThrow();
    expect(BUILT_IN_GALLERY_SOURCES.length).toBeGreaterThan(0);
  });

  it("includes every catalog shipped by the source repository", () => {
    expect(BUILT_IN_GALLERY_SOURCES.map((source) => source.id)).toEqual([
      "langrisser",
      "ark-models",
      "bd2-l2d-viewer",
      "blue-archive-viewer",
      "nikke-db",
      "konosuba-fantastic-days",
      "counterside",
      "epic-seven",
      "daiblos-core",
      "shadowverse",
    ]);
  });

  it("declares every library over https with a stable id and a label", () => {
    for (const source of BUILT_IN_GALLERY_SOURCES) {
      expect(source.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(source.label.length).toBeGreaterThan(0);
      expect(new URL(source.manifestUrl).protocol).toBe("https:");
      expect(source.builtIn).toBe(true);
    }
  });

  it("defaults the galleries that require it to premultiplied alpha", () => {
    const premultipliedSourceIds = BUILT_IN_GALLERY_SOURCES.filter(
      (source) => source.defaults?.premultipliedAlpha === "premultiplied",
    ).map((source) => source.id);

    expect(premultipliedSourceIds).toEqual([
      "konosuba-fantastic-days",
      "epic-seven",
      "daiblos-core",
    ]);
  });
});

describe("builtInSourcesConfig", () => {
  const valid = {
    sources: [{ id: "one", label: "One", manifestUrl: "https://example.test/data.json" }],
  };

  it("rejects a config with no libraries", () => {
    expect(() => builtInSourcesConfig.assert({ sources: [] })).toThrow(/at least one/);
    expect(() => builtInSourcesConfig.assert({})).toThrow(/sources must be an array/);
  });

  it("rejects a duplicated id", () => {
    expect(() =>
      builtInSourcesConfig.assert({ sources: [...valid.sources, ...valid.sources] }),
    ).toThrow(/duplicated/);
  });

  it("rejects an attribution link with an unsupported scheme", () => {
    expect(() =>
      builtInSourcesConfig.assert({
        sources: [
          {
            ...valid.sources[0],
            attribution: { label: "Example", url: "javascript:alert(1)" },
          },
        ],
      }),
    ).toThrow(/http 或 https/);
  });

  it("rejects an unstable library ID", () => {
    expect(() =>
      builtInSourcesConfig.assert({
        sources: [{ ...valid.sources[0], id: "Bad ID" }],
      }),
    ).toThrow(/lowercase identifier/);
  });

  it("rejects an unsupported alpha default", () => {
    expect(() =>
      builtInSourcesConfig.assert({
        sources: [
          {
            ...valid.sources[0],
            defaults: { premultipliedAlpha: "guess" },
          },
        ],
      }),
    ).toThrow(/premultipliedAlpha/);
  });

  it("names the offending entry when a field is missing", () => {
    expect(() => builtInSourcesConfig.assert({ sources: [{ label: "No id" }] })).toThrow(
      /sources\[0\]\.id/,
    );
  });
});

describe("normalizeManifestUrl", () => {
  it("accepts an absolute http(s) URL", () => {
    expect(normalizeManifestUrl(" https://example.test/data.json#ignored ")).toBe(
      "https://example.test/data.json",
    );
  });

  it("rejects a relative URL, an unsupported scheme, and embedded credentials", () => {
    expect(() => normalizeManifestUrl("data.json")).toThrow(/完整网址/);
    expect(() => normalizeManifestUrl("ftp://example.test/data.json")).toThrow(/http 或 https/);
    expect(() => normalizeManifestUrl("https://user:pw@example.test/d.json")).toThrow(/密码/);
  });
});

describe("createCustomSource", () => {
  it("derives an id from the normalized URL so the same library is added once", () => {
    expect(createCustomSource("https://example.test/a/data.json").id).toBe(
      createCustomSource(" https://example.test/a/data.json ").id,
    );
  });

  it("prefers a supplied label over the derived one", () => {
    expect(createCustomSource("https://example.test/a/data.json", "Studio").label).toBe("Studio");
  });
});

describe("suggestSourceLabel", () => {
  it("skips a filename that names nothing and uses the directory above it", () => {
    expect(suggestSourceLabel("https://example.test/spine-rigs/data.json")).toBe("spine rigs");
  });

  it("falls back to the host when the path carries no name", () => {
    expect(suggestSourceLabel("https://cdn.example.test/index.json")).toBe("cdn.example.test");
  });
});

describe("storedGallerySources", () => {
  it("filters invalid and duplicate stored entries", () => {
    const parsed = storedGallerySources.assert([
      { manifestUrl: "https://example.test/a/data.json", label: "A" },
      { manifestUrl: "not a url" },
      { label: "no url at all" },
      null,
      { manifestUrl: "https://example.test/a/data.json", label: "duplicate" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.label).toBe("A");
    expect(parsed[0]?.builtIn).toBe(false);
  });

  it("returns nothing for a value that is not an array", () => {
    expect(storedGallerySources.assert("corrupted")).toEqual([]);
  });
});

describe("sourceHost", () => {
  it("shows the host a library is fetched from", () => {
    expect(sourceHost(createCustomSource("https://cdn.example.test/a/data.json"))).toBe(
      "cdn.example.test",
    );
  });
});
