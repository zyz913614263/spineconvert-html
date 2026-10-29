import type {
  ConversionRequest,
  ConversionResponse,
  ConverterProgressPhase,
  ConverterRequest,
  ConverterResponse,
  DetectionRequest,
  DetectionResponse,
} from "../domain/conversion/protocol";
import type { SkeletonFormat } from "../domain/spine/assets";
import { ensureMeshTrianglesInSkeletonJson } from "../domain/spine/skeleton-json";
import {
  DEFAULT_TARGETS,
  isSupportedVersion,
  peekJsonSpineVersion,
  versionFamily,
  type SpineVersion,
} from "../domain/spine/version";

const PHASE_DETAIL: Record<ConverterProgressPhase | "finalize", string> = {
  wasm: "加载转换运行时",
  detect: "识别骨骼版本",
  convert: "转换骨骼数据",
  finalize: "整理输出",
};

export type ConversionProgress = {
  phase: ConverterProgressPhase | "finalize";
  percent: number;
  detail: string;
  elapsedMs: number;
};

type PendingRequest = {
  resolve: (response: ConversionResponse | DetectionResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: ConversionProgress) => void;
  startedAt: number;
  inputBytes: number;
  phase: ConverterProgressPhase;
  ticker: ReturnType<typeof setInterval> | null;
};

type ConverterRequestWithoutId = Omit<ConversionRequest, "id"> | Omit<DetectionRequest, "id">;

type ConverterWorker = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<ConverterResponse>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<ConverterResponse>) => void,
  ): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  postMessage(message: ConverterRequest, transfer: Transferable[]): void;
  terminate(): void;
};

export type ConvertOptions = {
  input: Uint8Array;
  inputFormat: SkeletonFormat;
  outputFormat: SkeletonFormat;
  outputVersion: SpineVersion;
  removeCurves?: boolean;
  onProgress?: (progress: ConversionProgress) => void;
};

export type ConversionResult = {
  inputVersion: SpineVersion;
  data: Uint8Array;
};

/** Expected wall time for native convert; larger inputs take longer. */
function convertTauMs(inputBytes: number): number {
  return Math.min(120_000, Math.max(8_000, inputBytes / 30));
}

/**
 * Single elapsed-time curve for the whole wait. Native convert cannot report real
 * percentages, so this keeps moving until completion instead of capping on a phase.
 */
function overallPercent(elapsedMs: number, inputBytes: number): number {
  const ratio = 1 - Math.exp(-elapsedMs / convertTauMs(inputBytes));
  return 3 + 92 * ratio;
}

function inferredPhase(elapsedMs: number, reported: ConverterProgressPhase): ConverterProgressPhase {
  if (reported === "convert") return "convert";
  // Worker progress may be missing after HMR; after a short warmup assume convert.
  if (elapsedMs >= 3_000) return "convert";
  return reported;
}

export class ConverterClient {
  readonly #worker: ConverterWorker;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #failure: Error | null = null;

  constructor(
    worker: ConverterWorker = new Worker(
      new URL("../workers/converter.worker.ts", import.meta.url),
      {
        type: "module",
      },
    ),
  ) {
    this.#worker = worker;
    this.#worker.addEventListener("message", this.#handleMessage);
    this.#worker.addEventListener("error", this.#handleWorkerError);
  }

  async detect(input: Uint8Array): Promise<SpineVersion> {
    const response = await this.#request({ type: "detect", input: this.#copyBuffer(input) });
    if (response.type !== "detected") throw new Error("Converter returned an unexpected response.");
    return response.version;
  }

  async convert(options: ConvertOptions): Promise<ConversionResult> {
    const startedAt = performance.now();
    const emitFinalize = (percent: number): void => {
      options.onProgress?.({
        phase: "finalize",
        percent,
        detail: PHASE_DETAIL.finalize,
        elapsedMs: Math.max(0, performance.now() - startedAt),
      });
    };

    const response = await this.#request(
      {
        type: "convert",
        input: this.#copyBuffer(options.input),
        inputFormat: options.inputFormat,
        outputFormat: options.outputFormat,
        outputVersion: options.outputVersion,
        removeCurves: options.removeCurves ?? false,
      },
      options.onProgress,
      options.input.byteLength,
    );
    if (response.type !== "converted")
      throw new Error("Converter returned an unexpected response.");

    emitFinalize(96);

    let data = new Uint8Array(response.data);
    // Spine Editor requires mesh `triangles` even when empty; the native converter may omit them.
    if (options.outputFormat === "json") data = ensureMeshTrianglesInSkeletonJson(data);
    emitFinalize(100);
    return { inputVersion: response.inputVersion, data };
  }

  /**
   * Builds Spine 4.2 preview JSON. Already-4.2 JSON skips the native converter so large
   * bundles open quickly; older or binary skeletons still convert to 4.2.11.
   */
  async preparePreviewJson(
    input: Uint8Array,
    inputFormat: SkeletonFormat,
    onProgress?: (progress: ConversionProgress) => void,
  ): Promise<ConversionResult> {
    if (inputFormat === "json") {
      // Avoid waking the WASM converter just to read skeleton.spine from JSON.
      const detected = peekJsonSpineVersion(input) ?? (await this.detect(input));
      if (isSupportedVersion(detected) && versionFamily(detected) === "4.2") {
        return { inputVersion: detected, data: input.slice() };
      }
    }
    return this.convert({
      input,
      inputFormat,
      outputFormat: "json",
      outputVersion: DEFAULT_TARGETS["4.2"],
      onProgress,
    });
  }

  dispose(): void {
    this.#worker.removeEventListener("message", this.#handleMessage);
    this.#worker.removeEventListener("error", this.#handleWorkerError);
    this.#worker.terminate();
    this.#failure = new Error("Converter was disposed.");
    for (const pending of this.#pending.values()) {
      this.#stopTicker(pending);
      pending.reject(this.#failure);
    }
    this.#pending.clear();
  }

  #copyBuffer(input: Uint8Array): ArrayBuffer {
    return input.slice().buffer;
  }

  #stopTicker(pending: PendingRequest): void {
    if (pending.ticker !== null) {
      clearInterval(pending.ticker);
      pending.ticker = null;
    }
  }

  #emit(pending: PendingRequest): void {
    const elapsedMs = Math.max(0, performance.now() - pending.startedAt);
    const phase = inferredPhase(elapsedMs, pending.phase);
    pending.onProgress?.({
      phase,
      percent: Math.min(95, overallPercent(elapsedMs, pending.inputBytes)),
      detail: PHASE_DETAIL[phase],
      elapsedMs,
    });
  }

  #startProgressTicker(pending: PendingRequest): void {
    this.#stopTicker(pending);
    this.#emit(pending);
    pending.ticker = setInterval(() => this.#emit(pending), 200);
  }

  #request(
    request: ConverterRequestWithoutId,
    onProgress?: (progress: ConversionProgress) => void,
    inputBytes = 0,
  ): Promise<ConversionResponse | DetectionResponse> {
    if (this.#failure) return Promise.reject(this.#failure);
    const id = this.#nextId;
    this.#nextId += 1;
    const message: ConverterRequest = { ...request, id };

    return new Promise((resolve, reject) => {
      const pending: PendingRequest = {
        resolve,
        reject,
        onProgress,
        startedAt: performance.now(),
        inputBytes,
        phase: "wasm",
        ticker: null,
      };
      this.#pending.set(id, pending);
      if (onProgress) this.#startProgressTicker(pending);
      try {
        this.#worker.postMessage(message, [message.input]);
      } catch (error) {
        this.#stopTicker(pending);
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  readonly #handleMessage = (event: MessageEvent<ConverterResponse>): void => {
    const response = event.data;
    const pending = this.#pending.get(response.id);
    if (!pending) return;

    if (response.type === "progress") {
      pending.phase = response.phase;
      this.#emit(pending);
      return;
    }

    this.#stopTicker(pending);
    this.#pending.delete(response.id);
    if (response.type === "error") {
      pending.reject(new Error(response.message));
    } else {
      pending.resolve(response);
    }
  };

  readonly #handleWorkerError = (event: ErrorEvent): void => {
    const error = new Error(event.message || "The conversion worker stopped.");
    this.#failure = error;
    for (const pending of this.#pending.values()) {
      this.#stopTicker(pending);
      pending.reject(error);
    }
    this.#pending.clear();
  };
};
