import type {
  ConversionRequest,
  ConversionResponse,
  ConverterRequest,
  ConverterResponse,
  DetectionRequest,
  DetectionResponse,
} from "../domain/conversion/protocol";
import type { SkeletonFormat } from "../domain/spine/assets";
import type { SpineVersion } from "../domain/spine/version";

type PendingRequest = {
  resolve: (response: ConversionResponse | DetectionResponse) => void;
  reject: (error: Error) => void;
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
};

export type ConversionResult = {
  inputVersion: SpineVersion;
  data: Uint8Array;
};

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
    const response = await this.#request({
      type: "convert",
      input: this.#copyBuffer(options.input),
      inputFormat: options.inputFormat,
      outputFormat: options.outputFormat,
      outputVersion: options.outputVersion,
      removeCurves: options.removeCurves ?? false,
    });
    if (response.type !== "converted")
      throw new Error("Converter returned an unexpected response.");
    return { inputVersion: response.inputVersion, data: new Uint8Array(response.data) };
  }

  dispose(): void {
    this.#worker.removeEventListener("message", this.#handleMessage);
    this.#worker.removeEventListener("error", this.#handleWorkerError);
    this.#worker.terminate();
    this.#failure = new Error("Converter was disposed.");
    for (const pending of this.#pending.values()) pending.reject(this.#failure);
    this.#pending.clear();
  }

  #copyBuffer(input: Uint8Array): ArrayBuffer {
    return input.slice().buffer;
  }

  #request(request: ConverterRequestWithoutId): Promise<ConversionResponse | DetectionResponse> {
    if (this.#failure) return Promise.reject(this.#failure);
    const id = this.#nextId;
    this.#nextId += 1;
    const message: ConverterRequest = { ...request, id };

    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        this.#worker.postMessage(message, [message.input]);
      } catch (error) {
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  readonly #handleMessage = (event: MessageEvent<ConverterResponse>): void => {
    const response = event.data;
    const pending = this.#pending.get(response.id);
    if (!pending) return;
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
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  };
}
