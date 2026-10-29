import { type } from "arktype";

import sourceConfig from "@/config/gallery-sources.json";
import type { GalleryBundleDefaults } from "@/domain/gallery/manifest";

/** A built-in or user-added gallery catalog. */
export type GallerySource = {
  readonly id: string;
  readonly label: string;
  readonly manifestUrl: string;
  readonly description?: string;
  readonly attribution?: { readonly label: string; readonly url?: string };
  /** Fallbacks used when neither the manifest nor an item declares a value. */
  readonly defaults?: GalleryBundleDefaults;
  /** Only user-added libraries can be removed. */
  readonly builtIn: boolean;
};

/** Fields stored for a user-added library. */
export type StoredGallerySource = {
  readonly id: string;
  readonly label: string;
  readonly manifestUrl: string;
};

export class GallerySourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GallerySourceError";
  }
}

const requiredString = type("string")
  .pipe((value) => value.trim())
  .narrow((value, ctx) => value.length > 0 || ctx.mustBe("a non-empty string"));

const optionalString = type("string").pipe((value) => value.trim() || undefined);
const builtInSourceId = requiredString.narrow(
  (value, ctx) =>
    /^[a-z0-9][a-z0-9-]*$/.test(value) ||
    ctx.mustBe("a lowercase identifier containing letters, digits, or hyphens"),
);

/** Returns an absolute HTTP(S) URL without embedded credentials. */
export function normalizeManifestUrl(value: string, label = "清单地址"): string {
  const trimmed = value.trim();
  if (!trimmed) throw new GallerySourceError(`${label}不能为空。`);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new GallerySourceError(`${label}必须是包含 https:// 的完整网址。`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new GallerySourceError(`${label}必须使用 http 或 https。`);
  }
  if (url.username || url.password) {
    throw new GallerySourceError(`${label}不能包含用户名或密码。`);
  }
  url.hash = "";
  return url.href;
}

/** Returns the host, or the stored URL when parsing fails. */
export function sourceHost(source: GallerySource): string {
  try {
    return new URL(source.manifestUrl).host;
  } catch {
    return source.manifestUrl;
  }
}

const builtInSourceEntry = type({
  id: builtInSourceId,
  label: requiredString,
  manifestUrl: requiredString,
  "description?": optionalString,
  "attribution?": { label: requiredString, "url?": optionalString },
  "defaults?": {
    "premultipliedAlpha?": "'auto' | 'premultiplied' | 'straight'",
  },
});

/** Validates built-in sources, their URLs, and unique IDs. */
export const builtInSourcesConfig = type({ sources: builtInSourceEntry.array() }).pipe(
  (config): readonly GallerySource[] => {
    if (config.sources.length === 0) {
      throw new GallerySourceError("gallery-sources.json must declare at least one library.");
    }
    const seen = new Set<string>();
    return config.sources.map((entry) => {
      if (seen.has(entry.id)) {
        throw new GallerySourceError(`gallery-sources.json library id is duplicated: ${entry.id}.`);
      }
      seen.add(entry.id);
      return {
        ...entry,
        manifestUrl: normalizeManifestUrl(entry.manifestUrl, `${entry.id}.manifestUrl`),
        attribution: entry.attribution && {
          ...entry.attribution,
          url: entry.attribution.url
            ? normalizeManifestUrl(entry.attribution.url, `${entry.id}.attribution.url`)
            : undefined,
        },
        builtIn: true,
      };
    });
  },
);

const MANIFEST_URL_OVERRIDE = import.meta.env.VITE_GALLERY_MANIFEST_URL;

export const BUILT_IN_GALLERY_SOURCES: readonly GallerySource[] = (() => {
  const sources = builtInSourcesConfig.assert(sourceConfig);
  if (!MANIFEST_URL_OVERRIDE) return sources;
  return sources.map((source, index) =>
    index === 0
      ? {
          ...source,
          manifestUrl: normalizeManifestUrl(MANIFEST_URL_OVERRIDE, "VITE_GALLERY_MANIFEST_URL"),
        }
      : source,
  );
})();

/** Initial gallery source. */
export const DEFAULT_GALLERY_SOURCE: GallerySource = (() => {
  const [first] = BUILT_IN_GALLERY_SOURCES;
  if (!first) throw new GallerySourceError("gallery-sources.json declared no libraries.");
  return first;
})();

export const DEFAULT_GALLERY_SOURCE_ID = DEFAULT_GALLERY_SOURCE.id;

/** Derives a label from the manifest path or host. */
export function suggestSourceLabel(manifestUrl: string): string {
  try {
    const url = new URL(manifestUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    // Generic manifest filenames use their parent directory as the label.
    const named = segments.at(-2) ?? segments.at(-1);
    if (named && !/^(data|index|manifest|catalog)\.[a-z]+$/i.test(named)) {
      return named.replace(/[-_]+/g, " ").replace(/\.[a-z]+$/i, "");
    }
    return url.host;
  } catch {
    return "自定义库";
  }
}

/** Validates and creates a user-added library. */
export function createCustomSource(manifestUrl: string, label?: string): GallerySource {
  const normalized = normalizeManifestUrl(manifestUrl);
  return {
    id: `custom:${normalized}`,
    label: label?.trim() || suggestSourceLabel(normalized),
    manifestUrl: normalized,
    builtIn: false,
  };
}

const storedSourceEntry = type({ manifestUrl: requiredString, "label?": optionalString });

/** Decodes saved custom sources and skips invalid or duplicate entries. */
export const storedGallerySources = type("unknown").pipe((value): readonly GallerySource[] => {
  if (!Array.isArray(value)) return [];
  const sources: GallerySource[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const parsed = storedSourceEntry(entry);
    if (parsed instanceof type.errors) continue;
    try {
      const source = createCustomSource(parsed.manifestUrl, parsed.label);
      if (seen.has(source.id)) continue;
      seen.add(source.id);
      sources.push(source);
    } catch {
      continue;
    }
  }
  return sources;
});

export function toStoredSource(source: GallerySource): StoredGallerySource {
  return { id: source.id, label: source.label, manifestUrl: source.manifestUrl };
}

/** Returns stored fields for each valid custom source in saved JSON. */
export const persistedGallerySources = type("unknown").pipe(
  (value): readonly StoredGallerySource[] => storedGallerySources.assert(value).map(toStoredSource),
);
