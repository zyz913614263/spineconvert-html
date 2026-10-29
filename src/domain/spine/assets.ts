import { type } from "arktype";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const PAGE_PROPERTY_NAMES = new Set(["size", "format", "filter", "repeat", "pma", "scale"]);
const SPINE_VERSION_BYTES = /(?:3\.[3-8]|4\.[0-2])\.\d+/;

export type SkeletonFormat = "json" | "skel";

export type SpineAssetKind = "skeleton-json" | "skeleton-binary" | "atlas" | "image" | "unknown";

export type SpineAssetInspection = {
  kind: SpineAssetKind;
  confidence: number;
  evidence: string;
};

export type SpineAssetBundle = {
  skeleton: File;
  skeletonFormat: SkeletonFormat;
  atlas: File;
  atlasText: string;
  images: ReadonlyMap<string, File>;
  pageNames: readonly string[];
};

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function hasCompoundSuffix(name: string, suffix: string): boolean {
  return normalizeAssetPath(name).endsWith(suffix);
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function imageSignature(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "PNG";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "JPEG";
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "WebP";
  }
  return null;
}

function startsWithJsonObject(bytes: Uint8Array): boolean {
  let index = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (
    bytes[index] === 0x09 ||
    bytes[index] === 0x0a ||
    bytes[index] === 0x0d ||
    bytes[index] === 0x20
  ) {
    index += 1;
  }
  return bytes[index] === 0x7b;
}

function hasBinaryControlByte(bytes: Uint8Array): boolean {
  return bytes.some((value) => value < 0x09 || (value > 0x0d && value < 0x20));
}

function decodeText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return null;
  }
}

const spineJsonHeader = type({ skeleton: { spine: "string" } });

function isSpineJson(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{")) return false;
  try {
    return !(spineJsonHeader(JSON.parse(trimmed)) instanceof type.errors);
  } catch {
    return false;
  }
}

/** Uses file bytes before MIME type or filename suffixes. */
export async function inspectSpineAsset(file: File): Promise<SpineAssetInspection> {
  const headerBytes = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const signature = imageSignature(headerBytes);
  if (signature) {
    return { kind: "image", confidence: 1, evidence: `${signature} byte signature` };
  }

  const header = new TextDecoder("latin1").decode(headerBytes);
  if (
    SPINE_VERSION_BYTES.test(header) &&
    !startsWithJsonObject(headerBytes) &&
    hasBinaryControlByte(headerBytes)
  ) {
    return { kind: "skeleton-binary", confidence: 0.9, evidence: "Spine version metadata" };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = decodeText(bytes);
  if (text !== null) {
    if (isSpineJson(text)) {
      return { kind: "skeleton-json", confidence: 1, evidence: "Spine JSON structure" };
    }
    if (parseAtlasPageNames(text).length > 0) {
      return { kind: "atlas", confidence: 0.99, evidence: "Spine atlas page grammar" };
    }
  }

  if (SPINE_VERSION_BYTES.test(header)) {
    return { kind: "skeleton-binary", confidence: 0.9, evidence: "Spine version metadata" };
  }

  const suffix = extension(file.name);
  const mime = file.type.toLowerCase();
  if (IMAGE_EXTENSIONS.has(suffix) || mime.startsWith("image/")) {
    return { kind: "image", confidence: 0.5, evidence: "Image filename or MIME fallback" };
  }
  if (hasCompoundSuffix(file.name, ".atlas") || hasCompoundSuffix(file.name, ".atlas.txt")) {
    return { kind: "atlas", confidence: 0.45, evidence: "Atlas suffix fallback" };
  }
  if (hasCompoundSuffix(file.name, ".json") || hasCompoundSuffix(file.name, ".json.bytes")) {
    return { kind: "skeleton-json", confidence: 0.4, evidence: "JSON suffix fallback" };
  }
  if (hasCompoundSuffix(file.name, ".skel") || hasCompoundSuffix(file.name, ".skel.bytes")) {
    return { kind: "skeleton-binary", confidence: 0.4, evidence: "SKEL suffix fallback" };
  }
  return { kind: "unknown", confidence: 0, evidence: "No recognized Spine asset signature" };
}

export function normalizeAssetPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function filePaths(file: File): string[] {
  const relativePath = file.webkitRelativePath;
  return [file.name, ...(relativePath ? [relativePath] : [])].map(normalizeAssetPath);
}

function nextNonEmptyLine(lines: readonly string[], start: number): string | undefined {
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (line?.trim()) return line;
  }
  return undefined;
}

export function parseAtlasPageNames(atlasText: string): string[] {
  const lines = atlasText.replaceAll(/\r\n?/g, "\n").split("\n");
  const pages: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line?.trim() || /^\s/.test(line) || line.includes(":")) continue;

    const nextLine = nextNonEmptyLine(lines, index + 1);
    if (!nextLine) continue;
    const colon = nextLine.indexOf(":");
    if (colon < 0) continue;
    const property = nextLine.slice(0, colon).trim().toLowerCase();
    if (PAGE_PROPERTY_NAMES.has(property)) pages.push(line.trim());
  }

  return [...new Set(pages)];
}

export function findAtlasImage(
  images: ReadonlyMap<string, File>,
  pageName: string,
): File | undefined {
  const normalizedPage = normalizeAssetPath(pageName);
  const exact = images.get(normalizedPage);
  if (exact) return exact;

  const pageSegments = normalizedPage.split("/");
  const basename = pageSegments.at(-1);
  if (!basename) return undefined;

  const uniqueMatches = (predicate: (path: string) => boolean): File | undefined => {
    const matches = new Set(
      [...images.entries()].filter(([path]) => predicate(path)).map(([, file]) => file),
    );
    return matches.size === 1 ? [...matches][0] : undefined;
  };
  return (
    uniqueMatches((path) => path.endsWith(`/${normalizedPage}`)) ??
    uniqueMatches((path) => path === basename || path.endsWith(`/${basename}`))
  );
}

export type SpineAssetBundleParts = {
  skeleton: File;
  atlas: File;
  images: Iterable<File>;
  skeletonFormat?: SkeletonFormat;
};

function skeletonFormatFromInspection(
  inspection: SpineAssetInspection,
): SkeletonFormat | undefined {
  if (inspection.kind === "skeleton-json") return "json";
  if (inspection.kind === "skeleton-binary") return "skel";
  return undefined;
}

async function buildAssetBundle(
  parts: SpineAssetBundleParts,
  skeletonInspection: SpineAssetInspection,
  atlasInspection: SpineAssetInspection,
  imageInspections: readonly SpineAssetInspection[],
): Promise<SpineAssetBundle> {
  const {
    skeleton,
    atlas,
    images: imageFilesInput,
    skeletonFormat: declaredSkeletonFormat,
  } = parts;
  const detectedSkeletonFormat = skeletonFormatFromInspection(skeletonInspection);
  if (
    declaredSkeletonFormat &&
    detectedSkeletonFormat &&
    skeletonInspection.confidence >= 0.9 &&
    declaredSkeletonFormat !== detectedSkeletonFormat
  ) {
    throw new Error(
      `${skeleton.name} contains ${detectedSkeletonFormat.toUpperCase()} data, but the manifest declares ${declaredSkeletonFormat.toUpperCase()}.`,
    );
  }
  const skeletonFormat = declaredSkeletonFormat ?? detectedSkeletonFormat;
  if (!skeletonFormat) {
    throw new Error(`Could not identify ${skeleton.name} as Spine JSON or binary data.`);
  }
  if (atlasInspection.kind !== "atlas") {
    throw new Error(`Could not identify ${atlas.name} as Spine atlas text.`);
  }

  const imageFiles = [...imageFilesInput];
  const invalidImages = imageFiles.filter((_, index) => imageInspections[index]?.kind !== "image");
  if (invalidImages.length > 0) {
    throw new Error(
      `Could not identify texture image${invalidImages.length === 1 ? "" : "s"}: ${invalidImages.map((file) => file.name).join(", ")}.`,
    );
  }

  const atlasText = decodeText(new Uint8Array(await atlas.arrayBuffer()));
  if (atlasText === null) throw new Error(`${atlas.name} is not valid UTF-8 atlas text.`);
  const pageNames = parseAtlasPageNames(atlasText);
  if (pageNames.length === 0) throw new Error("The atlas has no recognizable texture pages.");

  const images = new Map<string, File>();
  const ambiguousPaths = new Set<string>();
  for (const image of imageFiles) {
    for (const path of filePaths(image)) {
      const existing = images.get(path);
      if (existing && existing !== image) {
        images.delete(path);
        ambiguousPaths.add(path);
      } else if (!ambiguousPaths.has(path)) {
        images.set(path, image);
      }
    }
  }

  const missingPages = pageNames.filter((name) => !findAtlasImage(images, name));
  if (missingPages.length > 0) {
    throw new Error(
      `Missing atlas texture page${missingPages.length === 1 ? "" : "s"}: ${missingPages.join(", ")}.`,
    );
  }

  return { skeleton, skeletonFormat, atlas, atlasText, images, pageNames };
}

export async function createAssetBundleFromParts({
  skeleton,
  atlas,
  images: imageFilesInput,
  skeletonFormat: declaredSkeletonFormat,
}: SpineAssetBundleParts): Promise<SpineAssetBundle> {
  const imageFiles = [...imageFilesInput];
  const [skeletonInspection, atlasInspection, ...imageInspections] = await Promise.all([
    inspectSpineAsset(skeleton),
    inspectSpineAsset(atlas),
    ...imageFiles.map((file) => inspectSpineAsset(file)),
  ]);
  return buildAssetBundle(
    { skeleton, atlas, images: imageFiles, skeletonFormat: declaredSkeletonFormat },
    skeletonInspection,
    atlasInspection,
    imageInspections,
  );
}

export async function createAssetBundle(files: Iterable<File>): Promise<SpineAssetBundle> {
  const inspected = await Promise.all(
    [...files].map(async (file) => ({ file, inspection: await inspectSpineAsset(file) })),
  );
  const skeletons = inspected.filter(({ inspection }) => inspection.kind.startsWith("skeleton-"));
  const atlases = inspected.filter(({ inspection }) => inspection.kind === "atlas");
  const imageFiles = inspected
    .filter(({ inspection }) => inspection.kind === "image")
    .map(({ file }) => file);

  if (skeletons.length !== 1) {
    throw new Error(`Choose exactly one Spine JSON or binary skeleton; found ${skeletons.length}.`);
  }
  if (atlases.length !== 1) {
    throw new Error(`Choose exactly one Spine atlas; found ${atlases.length}.`);
  }

  const skeletonEntry = skeletons[0];
  const atlasEntry = atlases[0];
  if (!skeletonEntry || !atlasEntry) throw new Error("The selected bundle is incomplete.");
  return buildAssetBundle(
    {
      skeleton: skeletonEntry.file,
      skeletonFormat: skeletonEntry.inspection.kind === "skeleton-json" ? "json" : "skel",
      atlas: atlasEntry.file,
      images: imageFiles,
    },
    skeletonEntry.inspection,
    atlasEntry.inspection,
    inspected
      .filter(({ inspection }) => inspection.kind === "image")
      .map(({ inspection }) => inspection),
  );
}
