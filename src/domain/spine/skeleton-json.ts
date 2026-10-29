/** Spine JSON skins: 3.8+ list form or older map form. */
type SkinAttachments = Record<string, Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walkSkinAttachments(
  attachments: SkinAttachments,
  visit: (attachment: Record<string, unknown>) => void,
): void {
  for (const slotAttachments of Object.values(attachments)) {
    if (!isRecord(slotAttachments)) continue;
    for (const attachment of Object.values(slotAttachments)) {
      if (isRecord(attachment)) visit(attachment);
    }
  }
}

function forEachSkinAttachments(
  skins: unknown,
  visit: (attachment: Record<string, unknown>) => void,
): void {
  if (Array.isArray(skins)) {
    for (const skin of skins) {
      if (!isRecord(skin) || !isRecord(skin.attachments)) continue;
      walkSkinAttachments(skin.attachments as SkinAttachments, visit);
    }
    return;
  }
  if (!isRecord(skins)) return;
  for (const skin of Object.values(skins)) {
    if (!isRecord(skin)) continue;
    // Older JSON stores the slot map directly under the skin name.
    walkSkinAttachments(
      (isRecord(skin.attachments) ? skin.attachments : skin) as SkinAttachments,
      visit,
    );
  }
}

/**
 * Native conversion may omit empty mesh `triangles` arrays. Spine Editor then fails with
 * `Child not found with name: triangles` when importing the JSON.
 */
export function ensureMeshTrianglesInSkeletonJson(bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const data: unknown = JSON.parse(text);
  if (!isRecord(data)) return bytes;

  let changed = false;
  forEachSkinAttachments(data.skins, (attachment) => {
    if (attachment.type !== "mesh") return;
    if (Array.isArray(attachment.triangles)) return;
    attachment.triangles = [];
    changed = true;
  });

  if (!changed) return bytes;
  return new TextEncoder().encode(JSON.stringify(data));
}
