import { describe, expect, it } from "vitest";

import { ensureMeshTrianglesInSkeletonJson } from "./skeleton-json";

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe("ensureMeshTrianglesInSkeletonJson", () => {
  it("restores omitted mesh triangles in list-form skins", () => {
    const input = encode({
      skeleton: { spine: "3.8.75" },
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
            },
          },
        },
      ],
    });

    const repaired = JSON.parse(new TextDecoder().decode(ensureMeshTrianglesInSkeletonJson(input)));
    expect(repaired.skins[0].attachments.front_arm_parts_2_arm.front_arm_parts_1.triangles).toEqual(
      [],
    );
  });

  it("leaves complete meshes and non-json payloads unchanged", () => {
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
