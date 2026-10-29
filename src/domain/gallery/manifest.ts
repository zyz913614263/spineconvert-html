import { type } from "arktype";

/** Validates catalogs fetched from third-party hosts. */

/** Treats a blank optional string as absent. */
const optionalString = type("string").pipe((value) => value.trim() || undefined);

const requiredString = type("string")
  .pipe((value) => value.trim())
  .narrow((value, ctx) => value.length > 0 || ctx.mustBe("a non-empty string"));

const optionalSha256 = optionalString.narrow(
  (value, ctx) =>
    value === undefined ||
    /^(?:sha256:)?[\da-f]{64}$/i.test(value) ||
    ctx.mustBe("a 64-digit SHA-256 hash"),
);

const galleryAsset = type({
  url: requiredString,
  "path?": optionalString,
  "role?": "'skeleton' | 'atlas' | 'texture'",
  "page?": optionalString,
  "format?": "'auto' | 'json' | 'skel'",
  "bytes?": "number.integer >= 0",
  "sha256?": optionalSha256,
});

const galleryBundle = type({
  "loader?": optionalString,
  "assets?": galleryAsset.array(),
  "skeleton?": galleryAsset,
  "atlas?": galleryAsset,
  "textures?": galleryAsset.array(),
  "defaultAnimation?": optionalString,
  "defaultSkin?": optionalString,
  "premultipliedAlpha?": "'auto' | 'premultiplied' | 'straight'",
}).narrow(
  (bundle, ctx) =>
    !!bundle.assets?.length ||
    (bundle.skeleton !== undefined && bundle.atlas !== undefined && !!bundle.textures?.length) ||
    ctx.mustBe("a bundle with either assets[] for auto detection, or skeleton, atlas and textures"),
);

const galleryBundleDefaults = type({
  "premultipliedAlpha?": "'auto' | 'premultiplied' | 'straight'",
});

const manifestItem = type({
  id: requiredString,
  title: requiredString,
  "variant?": optionalString,
  "collection?": optionalString,
  "tags?": "string[]",
  "thumbnail?": { "url?": optionalString },
  "thumbnailUrl?": optionalString,
  "animationCount?": "number >= 0",
  "skinCount?": "number >= 0",
  "version?": optionalString,
  "format?": "'json' | 'skel'",
  bundle: galleryBundle,
  "attribution?": { label: requiredString, "url?": optionalString, "license?": optionalString },
});

const galleryManifest = type({
  schemaVersion: "1",
  "catalog?": { "id?": optionalString, "title?": optionalString, "updatedAt?": optionalString },
  "defaults?": galleryBundleDefaults,
  items: manifestItem.array(),
});

type GalleryManifest = typeof galleryManifest.infer;

export type GalleryAssetRole = "skeleton" | "atlas" | "texture";
export type GalleryAssetReference = typeof galleryAsset.infer;
export type GalleryBundleReference = typeof galleryBundle.infer;
export type GalleryBundleDefaults = typeof galleryBundleDefaults.infer;
type GalleryManifestItem = typeof manifestItem.infer;

export type GalleryItem = Omit<GalleryManifestItem, "tags" | "thumbnail" | "thumbnailUrl"> & {
  tags: string[];
  thumbnailUrl?: string;
};

export type GalleryCatalog = {
  schemaVersion: 1;
  sourceUrl: string;
  id: string;
  title: string;
  updatedAt?: string;
  items: GalleryItem[];
};

function resolveUrl(url: string | undefined, sourceUrl: string): string | undefined {
  if (!url) return undefined;
  try {
    const resolved = new URL(url, sourceUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return resolved.href;
  } catch {
    throw new Error(`Gallery URL must use HTTP or HTTPS: ${url}.`);
  }
}

function resolveItem(
  item: GalleryManifestItem,
  sourceUrl: string,
  defaults: GalleryBundleDefaults,
): GalleryItem {
  const { tags, thumbnail, thumbnailUrl, ...rest } = item;
  const premultipliedAlpha = item.bundle.premultipliedAlpha ?? defaults.premultipliedAlpha;
  return {
    ...rest,
    bundle: premultipliedAlpha ? { ...item.bundle, premultipliedAlpha } : item.bundle,
    tags: tags ?? [],
    thumbnailUrl: resolveUrl(thumbnail?.url ?? thumbnailUrl, sourceUrl),
    attribution: item.attribution && {
      ...item.attribution,
      url: resolveUrl(item.attribution.url, sourceUrl),
    },
  };
}

function resolveCatalog(
  manifest: GalleryManifest,
  sourceUrl: string,
  sourceDefaults: GalleryBundleDefaults,
): GalleryCatalog {
  // The manifest can replace a built-in source fallback, and an item can replace both.
  const defaults = { ...sourceDefaults, ...manifest.defaults };
  const items = manifest.items.map((item) => resolveItem(item, sourceUrl, defaults));
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`Gallery item id is duplicated: ${item.id}.`);
    seen.add(item.id);
  }
  return {
    schemaVersion: 1,
    sourceUrl,
    id: manifest.catalog?.id ?? "gallery",
    title: manifest.catalog?.title ?? "Animation gallery",
    updatedAt: manifest.catalog?.updatedAt,
    items,
  };
}

/** Builds a catalog parser that resolves URLs against `sourceUrl`. */
export function galleryCatalogFrom(sourceUrl: string, sourceDefaults: GalleryBundleDefaults = {}) {
  return galleryManifest.pipe((manifest) => resolveCatalog(manifest, sourceUrl, sourceDefaults));
}
