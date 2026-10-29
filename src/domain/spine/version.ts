export const SUPPORTED_VERSION_FAMILIES = [
  "3.3",
  "3.4",
  "3.5",
  "3.6",
  "3.7",
  "3.8",
  "4.0",
  "4.1",
  "4.2",
] as const;

export type SpineVersionFamily = (typeof SUPPORTED_VERSION_FAMILIES)[number];

export type SpineVersion = `${SpineVersionFamily}.${number}`;

export const DEFAULT_TARGETS = {
  "3.3": "3.3.07",
  "3.4": "3.4.02",
  "3.5": "3.5.51",
  "3.6": "3.6.53",
  "3.7": "3.7.94",
  "3.8": "3.8.99",
  "4.0": "4.0.64",
  "4.1": "4.1.24",
  "4.2": "4.2.11",
} satisfies Readonly<Record<SpineVersionFamily, SpineVersion>>;

const COMPLETE_VERSION = /^(3\.[3-8]|4\.[0-2])\.(\d+)$/;

export function isSupportedVersion(value: string): value is SpineVersion {
  return COMPLETE_VERSION.test(value);
}

export function versionFamily(value: SpineVersion): SpineVersionFamily {
  const family = SUPPORTED_VERSION_FAMILIES.find((candidate) => value.startsWith(`${candidate}.`));
  if (!family) throw new Error(`Unsupported Spine version: ${value}.`);
  return family;
}

export function parseSupportedVersion(value: string): SpineVersion {
  const normalized = value.trim();
  if (!isSupportedVersion(normalized)) {
    throw new Error("Use a complete Spine version from 3.3.x through 4.2.x, such as 4.2.11.");
  }
  return normalized;
}
