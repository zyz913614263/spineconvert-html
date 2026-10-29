import type { ExportFormat } from "../domain/export/protocol";

export type ExportCapabilities = Record<ExportFormat, boolean>;

const FALLBACK_CAPABILITIES = {
  gif: true,
  webm: false,
  mp4: false,
} satisfies ExportCapabilities;

export async function detectExportCapabilities(
  width = 1024,
  height = 1024,
): Promise<ExportCapabilities> {
  if (!("VideoEncoder" in globalThis)) return { ...FALLBACK_CAPABILITIES };

  try {
    const { Quality, canEncodeVideo } = await import("mediabunny");
    const quality = new Quality({ quality: 0.8 });
    const [vp9, vp8, avc] = await Promise.all([
      canEncodeVideo("vp9", { width, height, quality }),
      canEncodeVideo("vp8", { width, height, quality }),
      canEncodeVideo("avc", { width, height, quality }),
    ]);
    return { gif: true, webm: vp9 || vp8, mp4: avc };
  } catch {
    return { ...FALLBACK_CAPABILITIES };
  }
}
