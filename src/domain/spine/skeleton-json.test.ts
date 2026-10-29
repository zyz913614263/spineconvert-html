import { describe, expect, it } from "vitest";

import { ensureMeshTrianglesInSkeletonJson } from "./skeleton-json";

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe("ensureMeshTrianglesInSkeletonJson", () => {
  it("removes meshes with missing or empty triangles and clears references", () => {
    const input = encode({
      skeleton: { spine: "3.8.75" },
      slots: [{ name: "front_arm_parts_2_arm", bone: "arm", attachment: "front_arm_parts_1" }],
      skins: [
        {
          name: "default",
          attachments: {
            front_arm_parts_2_arm: {
              front_arm_parts_1: {
                type: "mesh",
                uvs: [0, 0, 1, 0, 1, 1],
                vertices: [0, 0, 1, 0, 1, 1],
              },
              keep: {
                type: "mesh",
                triangles: [0, 1, 2],
                uvs: [0, 0, 1, 0, 1, 1],
                vertices: [0, 0, 1, 0, 1, 1],
              },
            },
          },
        },
      ],
      animations: {
        idle: {
          slots: {
            front_arm_parts_2_arm: {
              attachment: [
                { time: 0, name: "front_arm_parts_1" },
                { time: 0.5, name: "keep" },
              ],
            },
          },
          deform: {
            default: {
              front_arm_parts_2_arm: {
                front_arm_parts_1: [{ time: 0 }],
                keep: [{ time: 0 }],
              },
            },
          },
        },
      },
    });

    const repaired = JSON.parse(new TextDecoder().decode(ensureMeshTrianglesInSkeletonJson(input)));
    expect(repaired.skins[0].attachments.front_arm_parts_2_arm.front_arm_parts_1).toBeUndefined();
    expect(repaired.skins[0].attachments.front_arm_parts_2_arm.keep.triangles).toEqual([0, 1, 2]);
    expect(repaired.slots[0].attachment).toBeUndefined();
    expect(repaired.animations.idle.slots.front_arm_parts_2_arm.attachment).toEqual([
      { time: 0.5, name: "keep" },
    ]);
    expect(
      repaired.animations.idle.deform.default.front_arm_parts_2_arm.front_arm_parts_1,
    ).toBeUndefined();
    expect(repaired.animations.idle.deform.default.front_arm_parts_2_arm.keep).toEqual([{ time: 0 }]);
  });

  it("leaves complete meshes unchanged", () => {
    const complete = encode({
      skeleton: { spine: "3.8.75" },
      skins: {
        default: {
          slot: {
            mesh: { type: "mesh", triangles: [0, 1, 2], uvs: [0, 0], vertices: [0, 0] },
            region: { type: "region", width: 1, height: 1 },
          },
        },
      },
    });
    expect(ensureMeshTrianglesInSkeletonJson(complete)).toBe(complete);
  });
});
