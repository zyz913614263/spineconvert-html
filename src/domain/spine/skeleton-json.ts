/** Spine JSON skins: 3.8+ list form or older map form. */
type SkinAttachments = Record<string, Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function skinAttachmentMaps(skins: unknown): SkinAttachments[] {
  const maps: SkinAttachments[] = [];
  if (Array.isArray(skins)) {
    for (const skin of skins) {
      if (isRecord(skin) && isRecord(skin.attachments)) {
        maps.push(skin.attachments as SkinAttachments);
      }
    }
    return maps;
  }
  if (!isRecord(skins)) return maps;
  for (const skin of Object.values(skins)) {
    if (!isRecord(skin)) continue;
    maps.push((isRecord(skin.attachments) ? skin.attachments : skin) as SkinAttachments);
  }
  return maps;
}

function isBrokenMesh(attachment: Record<string, unknown>): boolean {
  if (attachment.type !== "mesh") return false;
  const triangles = attachment.triangles;
  return !Array.isArray(triangles) || triangles.length === 0;
}

function removeBrokenMeshesFromSkins(skins: unknown): Set<string> {
  /** Keys are `${slot}\0${attachment}`. */
  const removed = new Set<string>();
  for (const attachments of skinAttachmentMaps(skins)) {
    for (const [slotName, slotAttachments] of Object.entries(attachments)) {
      if (!isRecord(slotAttachments)) continue;
      for (const [attachmentName, attachment] of Object.entries(slotAttachments)) {
        if (!isRecord(attachment) || !isBrokenMesh(attachment)) continue;
        delete slotAttachments[attachmentName];
        removed.add(`${slotName}\0${attachmentName}`);
      }
      if (Object.keys(slotAttachments).length === 0) delete attachments[slotName];
    }
  }
  return removed;
}

function clearRemovedSlotAttachments(slots: unknown, removed: Set<string>): boolean {
  if (!Array.isArray(slots) || removed.size === 0) return false;
  let changed = false;
  for (const slot of slots) {
    if (!isRecord(slot) || typeof slot.name !== "string") continue;
    const attachment = slot.attachment;
    if (typeof attachment !== "string") continue;
    if (!removed.has(`${slot.name}\0${attachment}`)) continue;
    delete slot.attachment;
    changed = true;
  }
  return changed;
}

function scrubAnimationAttachmentKeys(timeline: unknown, slotName: string, removed: Set<string>): boolean {
  if (!Array.isArray(timeline)) return false;
  let changed = false;
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const key = timeline[index];
    if (!isRecord(key) || typeof key.name !== "string") continue;
    if (!removed.has(`${slotName}\0${key.name}`)) continue;
    timeline.splice(index, 1);
    changed = true;
  }
  return changed;
}

function scrubAnimations(animations: unknown, removed: Set<string>): boolean {
  if (!isRecord(animations) || removed.size === 0) return false;
  let changed = false;

  for (const animation of Object.values(animations)) {
    if (!isRecord(animation)) continue;

    const slots = animation.slots;
    if (isRecord(slots)) {
      for (const [slotName, slotTimeline] of Object.entries(slots)) {
        if (!isRecord(slotTimeline)) continue;
        if (scrubAnimationAttachmentKeys(slotTimeline.attachment, slotName, removed)) {
          changed = true;
        }
        if (Array.isArray(slotTimeline.attachment) && slotTimeline.attachment.length === 0) {
          delete slotTimeline.attachment;
          changed = true;
        }
        if (Object.keys(slotTimeline).length === 0) {
          delete slots[slotName];
          changed = true;
        }
      }
    }

    const deform = animation.deform;
    if (!isRecord(deform)) continue;
    for (const skinDeforms of Object.values(deform)) {
      if (!isRecord(skinDeforms)) continue;
      for (const [slotName, slotDeforms] of Object.entries(skinDeforms)) {
        if (!isRecord(slotDeforms)) continue;
        for (const attachmentName of Object.keys(slotDeforms)) {
          if (!removed.has(`${slotName}\0${attachmentName}`)) continue;
          delete slotDeforms[attachmentName];
          changed = true;
        }
        if (Object.keys(slotDeforms).length === 0) {
          delete skinDeforms[slotName];
          changed = true;
        }
      }
    }
  }

  return changed;
}

/**
 * Native conversion may omit empty mesh `triangles`. Spine Editor rejects both missing
 * and zero-length triangle lists (`Invalid number of triangles (0)`), so drop those
 * broken meshes and clear slot/animation references that point at them.
 */
export function ensureMeshTrianglesInSkeletonJson(bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const data: unknown = JSON.parse(text);
  if (!isRecord(data)) return bytes;

  const removed = removeBrokenMeshesFromSkins(data.skins);
  if (removed.size === 0) return bytes;

  clearRemovedSlotAttachments(data.slots, removed);
  scrubAnimations(data.animations, removed);
  return new TextEncoder().encode(JSON.stringify(data));
}
