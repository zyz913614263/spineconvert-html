import { zipSync } from "fflate";

import { findAtlasImage, type SpineAssetBundle } from "@/domain/spine/assets";

/** Keeps only the final path segment so nested Unity-style names flatten in the zip. */
function zipEntryName(name: string): string {
  const normalized = name.replaceAll("\\", "/");
  const segment = normalized.split("/").at(-1)?.trim();
  return segment || "asset";
}

/**
 * Strips Unity TextAsset/bytes suffixes so exports use normal Spine names:
 * `hero.skel.bytes` → `hero.skel`, `hero.atlas.txt` → `hero.atlas`.
 */
export function normalizeSpineExportName(name: string): string {
  const leaf = zipEntryName(name);
  return leaf
    .replace(/\.skel\.bytes$/i, ".skel")
    .replace(/\.json\.bytes$/i, ".json")
    .replace(/\.atlas\.txt$/i, ".atlas");
}

/** Avoids collisions when several assets share a basename. */
function uniqueEntryName(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  const dot = preferred.lastIndexOf(".");
  const stem = dot > 0 ? preferred.slice(0, dot) : preferred;
  const extension = dot > 0 ? preferred.slice(dot) : "";
  let index = 2;
  let candidate = `${stem}-${index}${extension}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${stem}-${index}${extension}`;
  }
  used.add(candidate);
  return candidate;
}

async function fileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Builds a download name such as `hero.zip` from skeleton filenames like `hero.skel.bytes`. */
export function spineBundleZipFilename(skeletonName: string, fallback = "spine-bundle"): string {
  const leaf = zipEntryName(skeletonName);
  const withoutSpineExt = leaf.replace(/\.(json|skel)(?:\.bytes)?$/i, "");
  const stem = withoutSpineExt === leaf ? basenameStem(leaf) : withoutSpineExt;
  return `${stem || fallback}.zip`;
}

function basenameStem(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/**
 * Rewrites atlas page headers that contain folders so they match flattened zip entry names.
 * Only whole-line page names are replaced; region names are left alone.
 */
function flattenAtlasPageNames(atlasText: string, renames: ReadonlyMap<string, string>): string {
  if (renames.size === 0) return atlasText;
  const lines = atlasText.replaceAll(/\r\n?/g, "\n").split("\n");
  return lines
    .map((line) => {
      if (!line.trim() || /^\s/.test(line) || line.includes(":")) return line;
      const replacement = renames.get(line.trim());
      return replacement ?? line;
    })
    .join("\n");
}

/** Packs a Spine bundle into a zip containing the skeleton, atlas, and texture pages. */
export async function zipSpineAssetBundle(bundle: SpineAssetBundle): Promise<Uint8Array> {
  const used = new Set<string>();
  const entries: Record<string, Uint8Array> = {};
  const pageRenames = new Map<string, string>();

  const skeletonName = uniqueEntryName(normalizeSpineExportName(bundle.skeleton.name), used);
  entries[skeletonName] = await fileBytes(bundle.skeleton);

  for (const pageName of bundle.pageNames) {
    const image = findAtlasImage(bundle.images, pageName);
    if (!image) {
      throw new Error(`Missing atlas texture page in export: ${pageName}.`);
    }
    const preferred = zipEntryName(pageName);
    const entryName = uniqueEntryName(preferred, used);
    if (entryName !== pageName.trim()) {
      pageRenames.set(pageName.trim(), entryName);
    }
    entries[entryName] = await fileBytes(image);
  }

  const atlasName = uniqueEntryName(normalizeSpineExportName(bundle.atlas.name), used);
  const atlasBody = flattenAtlasPageNames(bundle.atlasText, pageRenames);
  entries[atlasName] = new TextEncoder().encode(atlasBody);

  return zipSync(entries);
}
