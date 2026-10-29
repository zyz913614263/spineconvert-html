import {
  createAssetBundle,
  createAssetBundleFromParts,
  type SkeletonFormat,
  type SpineAssetBundle,
} from "@/domain/spine/assets";
import {
  galleryCatalogFrom,
  type GalleryAssetReference,
  type GalleryBundleDefaults,
  type GalleryCatalog,
  type GalleryItem,
} from "@/domain/gallery/manifest";
import type { PremultipliedAlphaMode } from "@/render/spine-renderer";

export class GalleryRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GalleryRequestError";
  }
}

export type GalleryBundleLoad = {
  bundle: SpineAssetBundle;
  bytes: Uint8Array;
  loaderId: string;
  diagnostics: readonly string[];
  defaultAnimation?: string;
  defaultSkin?: string;
  premultipliedAlpha: PremultipliedAlphaMode;
};

export type GalleryBundleLoader = {
  id: string;
  load(item: GalleryItem, catalogUrl: string, signal: AbortSignal): Promise<GalleryBundleLoad>;
};

const galleryBundleLoaders = new Map<string, GalleryBundleLoader>();

export function registerGalleryBundleLoader(loader: GalleryBundleLoader): () => void {
  if (galleryBundleLoaders.has(loader.id)) {
    throw new Error(`Gallery bundle loader is already registered: ${loader.id}.`);
  }
  galleryBundleLoaders.set(loader.id, loader);
  return () => {
    if (galleryBundleLoaders.get(loader.id) === loader) galleryBundleLoaders.delete(loader.id);
  };
}

function resolveAssetUrl(assetUrl: string, catalogUrl: string): string {
  try {
    const resolved = new URL(assetUrl, catalogUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return resolved.href;
  } catch {
    throw new GalleryRequestError(`Gallery asset URL must use HTTP or HTTPS: ${assetUrl}.`);
  }
}

function filenameFromReference(
  reference: GalleryAssetReference,
  resolvedUrl: string,
  fallback: string,
): string {
  if (reference.page) return reference.page;
  if (reference.path) return reference.path;
  try {
    const pathname = new URL(resolvedUrl).pathname;
    const filename = decodeURIComponent(pathname.split("/").at(-1) ?? "");
    return filename || fallback;
  } catch {
    return fallback;
  }
}

async function digestHex(bytes: Uint8Array): Promise<string> {
  const source =
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
      ? bytes.buffer
      : bytes.slice().buffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function fetchAsset(
  reference: GalleryAssetReference,
  catalogUrl: string,
  fallbackName: string,
  signal: AbortSignal,
): Promise<File> {
  const url = resolveAssetUrl(reference.url, catalogUrl);
  let response: Response;
  try {
    response = await fetch(url, { signal, credentials: "omit" });
  } catch (error) {
    if (signal.aborted) throw new DOMException("画廊请求已取消。", "AbortError");
    throw new GalleryRequestError(
      `无法下载 ${fallbackName}。请检查资源主机及其 CORS 策略。${error instanceof Error ? error.message : ""}`.trim(),
    );
  }
  if (!response.ok) {
    throw new GalleryRequestError(
      `无法下载 ${fallbackName}：${response.status} ${response.statusText}。`,
      response.status,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (reference.bytes !== undefined && bytes.byteLength !== reference.bytes) {
    throw new GalleryRequestError(
      `${fallbackName} 大小不符：期望 ${reference.bytes} 字节，实际收到 ${bytes.byteLength}。`,
    );
  }
  if (reference.sha256) {
    const expected = reference.sha256.toLowerCase().replace(/^sha256:/, "");
    const actual = await digestHex(bytes);
    if (actual !== expected) throw new GalleryRequestError(`${fallbackName} 未通过 SHA-256 校验。`);
  }
  return new File([bytes], filenameFromReference(reference, url, fallbackName), {
    type: response.headers.get("content-type") ?? "application/octet-stream",
  });
}

async function finishBundleLoad(
  bundle: SpineAssetBundle,
  item: GalleryItem,
  loaderId: string,
  diagnostics: readonly string[],
): Promise<GalleryBundleLoad> {
  return {
    bundle,
    bytes: new Uint8Array(await bundle.skeleton.arrayBuffer()),
    loaderId,
    diagnostics,
    defaultAnimation: item.bundle.defaultAnimation,
    defaultSkin: item.bundle.defaultSkin,
    premultipliedAlpha: item.bundle.premultipliedAlpha ?? "auto",
  };
}

const declaredBundleLoader: GalleryBundleLoader = {
  id: "spine-bundle-v1",
  async load(item, catalogUrl, signal) {
    const { skeleton, atlas, textures } = item.bundle;
    if (!skeleton || !atlas || !textures?.length) {
      throw new GalleryRequestError(
        `${item.title} does not declare a skeleton, atlas, and texture list.`,
      );
    }
    const [skeletonFile, atlasFile, textureFiles] = await Promise.all([
      fetchAsset(skeleton, catalogUrl, "skeleton", signal),
      fetchAsset(atlas, catalogUrl, "atlas", signal),
      Promise.all(
        textures.map((texture, index) =>
          fetchAsset(texture, catalogUrl, `texture ${index + 1}`, signal),
        ),
      ),
    ]);
    const declaredFormat: SkeletonFormat | undefined =
      skeleton.format === "json" || skeleton.format === "skel" ? skeleton.format : undefined;
    const bundle = await createAssetBundleFromParts({
      skeleton: skeletonFile,
      atlas: atlasFile,
      images: textureFiles,
      skeletonFormat: declaredFormat,
    });
    return finishBundleLoad(bundle, item, this.id, [
      "资源角色：清单",
      `骨骼格式：${bundle.skeletonFormat.toUpperCase()}`,
      `匹配 ${bundle.pageNames.length} 张图集页`,
    ]);
  },
};

const inferredBundleLoader: GalleryBundleLoader = {
  id: "spine-auto-v1",
  async load(item, catalogUrl, signal) {
    const references = item.bundle.assets;
    if (!references?.length) throw new GalleryRequestError(`${item.title} 没有可检查的资源。`);
    const files = await Promise.all(
      references.map((asset, index) => fetchAsset(asset, catalogUrl, `asset ${index + 1}`, signal)),
    );
    const bundle = await createAssetBundle(files);
    return finishBundleLoad(bundle, item, this.id, [
      "资源角色：文件签名",
      `骨骼格式：${bundle.skeletonFormat.toUpperCase()}`,
      `匹配 ${bundle.pageNames.length} 张图集页`,
    ]);
  },
};

galleryBundleLoaders.set(declaredBundleLoader.id, declaredBundleLoader);
galleryBundleLoaders.set(inferredBundleLoader.id, inferredBundleLoader);

export async function fetchGalleryCatalog(
  manifestUrl: string,
  signal: AbortSignal,
  sourceDefaults: GalleryBundleDefaults = {},
): Promise<GalleryCatalog> {
  let response: Response;
  try {
    response = await fetch(manifestUrl, { signal, credentials: "omit" });
  } catch (error) {
    if (signal.aborted) throw new DOMException("画廊请求已取消。", "AbortError");
    throw new GalleryRequestError(
      `无法加载画廊目录。请检查 ${manifestUrl} 及其 CORS 策略。${error instanceof Error ? error.message : ""}`.trim(),
    );
  }
  if (!response.ok) {
    throw new GalleryRequestError(
      `无法加载画廊目录：${response.status} ${response.statusText}。`,
      response.status,
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new GalleryRequestError("画廊目录不是有效的 JSON。");
  }
  return galleryCatalogFrom(response.url || manifestUrl, sourceDefaults).assert(value);
}

export async function loadGalleryBundle(
  item: GalleryItem,
  catalogUrl: string,
  signal: AbortSignal,
): Promise<GalleryBundleLoad> {
  const loaderId =
    item.bundle.loader ??
    (item.bundle.assets?.length ? inferredBundleLoader.id : declaredBundleLoader.id);
  const loader = galleryBundleLoaders.get(loaderId);
  if (!loader) {
    throw new GalleryRequestError(
      `This catalog requires loader "${loaderId}". Register it before loading this source.`,
    );
  }
  return loader.load(item, catalogUrl, signal);
}
