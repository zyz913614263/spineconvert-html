import type { SkeletonFormat } from "../spine/assets";
import type { SpineVersion } from "../spine/version";

export type ConversionRequest = {
  type: "convert";
  id: number;
  input: ArrayBuffer;
  inputFormat: SkeletonFormat;
  outputFormat: SkeletonFormat;
  outputVersion: SpineVersion;
  removeCurves: boolean;
};

export type DetectionRequest = {
  type: "detect";
  id: number;
  input: ArrayBuffer;
};

export type ConverterRequest = ConversionRequest | DetectionRequest;

export type ConversionResponse = {
  type: "converted";
  id: number;
  inputVersion: SpineVersion;
  data: ArrayBuffer;
};

export type DetectionResponse = {
  type: "detected";
  id: number;
  version: SpineVersion;
};

export type ConverterErrorResponse = {
  type: "error";
  id: number;
  message: string;
};

/** Coarse phases; native `st_convert` itself cannot report finer progress. */
export type ConverterProgressPhase = "wasm" | "detect" | "convert";

export type ConverterProgressResponse = {
  type: "progress";
  id: number;
  phase: ConverterProgressPhase;
};

export type ConverterResponse =
  | ConversionResponse
  | DetectionResponse
  | ConverterErrorResponse
  | ConverterProgressResponse;
