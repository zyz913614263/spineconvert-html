import type {
  ExportCanceledResponse,
  ExportDoneResponse,
  ExportFrameResponse,
  ExportReadyResponse,
  ExportSettings,
  ExportWorkerRequest,
  ExportWorkerResponse,
} from "../domain/export/protocol";

type PendingMessage<TResponse extends ExportWorkerResponse = ExportWorkerResponse> = {
  accept: (response: ExportWorkerResponse) => response is TResponse;
  resolve(response: TResponse): void;
  reject: (error: Error) => void;
};

export type ExportResult = {
  blob: Blob;
  mimeType: string;
};

type ExportWorker = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<ExportWorkerResponse>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<ExportWorkerResponse>) => void,
  ): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  postMessage(message: ExportWorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
};

export class ExportClient {
  readonly #worker: ExportWorker;
  readonly #pending = new Map<number, PendingMessage[]>();
  #nextId = 1;
  #failure: Error | null = null;

  constructor(
    worker: ExportWorker = new Worker(new URL("../workers/export.worker.ts", import.meta.url), {
      type: "module",
    }),
  ) {
    this.#worker = worker;
    this.#worker.addEventListener("message", this.#handleMessage);
    this.#worker.addEventListener("error", this.#handleError);
  }

  createSession(settings: ExportSettings): ExportSessionClient {
    const id = this.#nextId;
    this.#nextId += 1;
    return new ExportSessionClient(id, { ...settings }, this.#send, this.#waitFor);
  }

  dispose(): void {
    this.#worker.removeEventListener("message", this.#handleMessage);
    this.#worker.removeEventListener("error", this.#handleError);
    this.#worker.terminate();
    this.#failure = new Error("Export worker was disposed.");
    this.#rejectAll(this.#failure);
  }

  readonly #send = (request: ExportWorkerRequest, transfer: Transferable[] = []): void => {
    if (this.#failure) throw this.#failure;
    this.#worker.postMessage(request, transfer);
  };

  readonly #waitFor: WaitFor = <TResponse extends ExportWorkerResponse>(
    id: number,
    accept: (response: ExportWorkerResponse) => response is TResponse,
  ): Promise<TResponse> =>
    this.#failure
      ? Promise.reject(this.#failure)
      : new Promise<TResponse>((resolve, reject) => {
          const queue = this.#pending.get(id) ?? [];
          queue.push({
            accept,
            resolve: (response) => {
              if (accept(response)) resolve(response);
            },
            reject,
          });
          this.#pending.set(id, queue);
        });

  readonly #handleMessage = (event: MessageEvent<ExportWorkerResponse>): void => {
    const response = event.data;
    const queue = this.#pending.get(response.id);
    if (!queue) return;
    if (response.type === "error") {
      this.#pending.delete(response.id);
      for (const pending of queue) pending.reject(new Error(response.message));
      return;
    }
    const index = queue.findIndex((pending) => pending.accept(response));
    const pending = index >= 0 ? queue[index] : undefined;
    if (!pending) return;
    queue.splice(index, 1);
    if (queue.length === 0) this.#pending.delete(response.id);
    pending.resolve(response);
  };

  readonly #handleError = (event: ErrorEvent): void => {
    this.#failure = new Error(event.message || "The export worker stopped.");
    this.#rejectAll(this.#failure);
  };

  #rejectAll(error: Error): void {
    for (const queue of this.#pending.values()) {
      for (const pending of queue) pending.reject(error);
    }
    this.#pending.clear();
  }
}

type Send = (request: ExportWorkerRequest, transfer?: Transferable[]) => void;
type WaitFor = <TResponse extends ExportWorkerResponse>(
  id: number,
  accept: (response: ExportWorkerResponse) => response is TResponse,
) => Promise<TResponse>;

export class ExportSessionClient {
  readonly #id: number;
  readonly #settings: ExportSettings;
  readonly #send: Send;
  readonly #waitFor: WaitFor;
  #started = false;
  #finished = false;
  #operationPending = false;
  #nextFrame = 0;

  constructor(id: number, settings: ExportSettings, send: Send, waitFor: WaitFor) {
    this.#id = id;
    this.#settings = settings;
    this.#send = send;
    this.#waitFor = waitFor;
  }

  async start(): Promise<void> {
    if (this.#started || this.#operationPending) {
      throw new Error("Export session has already started.");
    }
    this.#operationPending = true;
    try {
      this.#send({ type: "start", id: this.#id, settings: this.#settings });
      await this.#waitFor(this.#id, (item): item is ExportReadyResponse => item.type === "ready");
      this.#started = true;
    } finally {
      this.#operationPending = false;
    }
  }

  async addFrame(rgba: Uint8Array): Promise<void> {
    if (!this.#started || this.#finished || this.#operationPending) {
      throw new Error("Export session is not accepting frames.");
    }
    const index = this.#nextFrame;
    const data =
      rgba.byteOffset === 0 &&
      rgba.byteLength === rgba.buffer.byteLength &&
      rgba.buffer instanceof ArrayBuffer
        ? rgba.buffer
        : rgba.slice().buffer;
    this.#operationPending = true;
    try {
      this.#send({ type: "frame", id: this.#id, index, rgba: data }, [data]);
      await this.#waitFor(
        this.#id,
        (item): item is ExportFrameResponse => item.type === "frame-added" && item.index === index,
      );
      this.#nextFrame += 1;
    } finally {
      this.#operationPending = false;
    }
  }

  async finish(): Promise<ExportResult> {
    if (!this.#started || this.#finished || this.#operationPending) {
      throw new Error("Export session cannot be finalized.");
    }
    this.#operationPending = true;
    try {
      this.#send({ type: "finish", id: this.#id });
      const response = await this.#waitFor(
        this.#id,
        (item): item is ExportDoneResponse => item.type === "done",
      );
      this.#finished = true;
      return {
        blob: new Blob([response.data], { type: response.mimeType }),
        mimeType: response.mimeType,
      };
    } finally {
      this.#operationPending = false;
    }
  }

  async cancel(): Promise<void> {
    if (this.#finished) return;
    if (this.#operationPending) throw new Error("Export session is busy.");
    this.#operationPending = true;
    try {
      this.#send({ type: "cancel", id: this.#id });
      await this.#waitFor(
        this.#id,
        (item): item is ExportCanceledResponse => item.type === "canceled",
      );
      this.#finished = true;
    } finally {
      this.#operationPending = false;
    }
  }
}
