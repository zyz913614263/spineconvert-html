export type ExportFormat = "gif" | "webm" | "mp4";

export type ExportSettings = {
  format: ExportFormat;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  quality: number;
  transparent: boolean;
  bitrate?: number;
  gifPaletteSize?: number;
};

export type ExportStartRequest = {
  type: "start";
  id: number;
  settings: ExportSettings;
};

export type ExportFrameRequest = {
  type: "frame";
  id: number;
  index: number;
  rgba: ArrayBuffer;
};

export type ExportFinishRequest = {
  type: "finish";
  id: number;
};

export type ExportCancelRequest = {
  type: "cancel";
  id: number;
};

export type ExportWorkerRequest =
  | ExportStartRequest
  | ExportFrameRequest
  | ExportFinishRequest
  | ExportCancelRequest;

export type ExportReadyResponse = {
  type: "ready";
  id: number;
  codec?: "avc" | "vp8" | "vp9";
};
export type ExportFrameResponse = { type: "frame-added"; id: number; index: number };
export type ExportDoneResponse = { type: "done"; id: number; mimeType: string; data: ArrayBuffer };
export type ExportCanceledResponse = { type: "canceled"; id: number };
export type ExportErrorResponse = { type: "error"; id: number; message: string };

export type ExportWorkerResponse =
  | ExportReadyResponse
  | ExportFrameResponse
  | ExportDoneResponse
  | ExportCanceledResponse
  | ExportErrorResponse;
