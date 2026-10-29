import { describe, expect, it } from "vitest";

import {
  DEFAULT_TARGETS,
  SUPPORTED_VERSION_FAMILIES,
  isSupportedVersion,
  parseSupportedVersion,
  versionFamily,
} from "./version";

describe("Spine versions", () => {
  it("covers every family implemented by the native converter", () => {
    expect(SUPPORTED_VERSION_FAMILIES).toEqual([
      "3.3",
      "3.4",
      "3.5",
      "3.6",
      "3.7",
      "3.8",
      "4.0",
      "4.1",
      "4.2",
    ]);
    for (const family of SUPPORTED_VERSION_FAMILIES) {
      expect(isSupportedVersion(DEFAULT_TARGETS[family])).toBe(true);
      expect(versionFamily(DEFAULT_TARGETS[family])).toBe(family);
    }
  });

  it("requires a complete supported version", () => {
    expect(parseSupportedVersion(" 4.2.11 ")).toBe("4.2.11");
    expect(() => parseSupportedVersion("4.2")).toThrow(/complete Spine version/);
    expect(() => parseSupportedVersion("4.3.0")).toThrow(/3\.3\.x through 4\.2\.x/);
    expect(() => parseSupportedVersion("3.2.99")).toThrow(/3\.3\.x through 4\.2\.x/);
  });
});
