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

const PHASE_PERCENT: Record<ConverterProgressPhase | "finalize", number> = {
  wasm: 4,
  detect: 12,
  convert: 20,
  finalize: 96,
};

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
  convertStartedAt: number | null;
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

function convertTauMs(inputBytes: number): number {
  // Larger skeletons spend longer inside the blocking native convert call.
  return Math.min(90_000, Math.max(6_000, inputBytes / 40));
}

function convertPercent(elapsedMs: number, inputBytes: number): number {
  const span = 75;
  const ratio = 1 - Math.exp(-elapsedMs / convertTauMs(inputBytes));
  return PHASE_PERCENT.convert + span * ratio;
}

function warmupPercent(elapsedMs: number, phase: ConverterProgressPhase): number {
  const base = PHASE_PERCENT[phase];
  const ceiling = phase === "convert" ? base : PHASE_PERCENT.convert - 1;
  const ratio = 1 - Math.exp(-elapsedMs / 2_500);
  return base + (ceiling - base) * ratio;
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

    emitFinalize(PHASE_PERCENT.finalize);

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

  #emit(pending: PendingRequest, percent: number): void {
    pending.onProgress?.({
      phase: pending.phase,
      percent: Math.min(99, Math.max(0, percent)),
      detail: PHASE_DETAIL[pending.phase],
      elapsedMs: Math.max(0, performance.now() - pending.startedAt),
    });
  }

  /** Drives UI even if the worker build is stale and never posts progress events. */
  #startProgressTicker(pending: PendingRequest): void {
    this.#stopTicker(pending);
    this.#emit(pending, PHASE_PERCENT[pending.phase]);
    pending.ticker = setInterval(() => {
      if (pending.phase === "convert" && pending.convertStartedAt !== null) {
        const convertElapsed = performance.now() - pending.convertStartedAt;
        this.#emit(pending, convertPercent(convertElapsed, pending.inputBytes));
        return;
      }
      const elapsed = performance.now() - pending.startedAt;
      this.#emit(pending, warmupPercent(elapsed, pending.phase));
    }, 200);
  }

  #setPhase(pending: PendingRequest, phase: ConverterProgressPhase): void {
    pending.phase = phase;
    if (phase === "convert" && pending.convertStartedAt === null) {
      pending.convertStartedAt = performance.now();
    }
    this.#emit(pending, PHASE_PERCENT[phase]);
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
        convertStartedAt: null,
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
      this.#setPhase(pending, response.phase);
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
