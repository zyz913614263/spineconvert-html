import { describe, expect, it } from "vitest";

import type {
  ExportSettings,
  ExportWorkerRequest,
  ExportWorkerResponse,
} from "../domain/export/protocol";
import { ExportClient } from "./export-client";

type MessageListener = (event: MessageEvent<ExportWorkerResponse>) => void;
type ErrorListener = (event: ErrorEvent) => void;

class ExportWorkerStub {
  readonly requests: ExportWorkerRequest[] = [];
  failNextPost = false;
  #messageListener: MessageListener | null = null;

  addEventListener(type: "message" | "error", listener: MessageListener | ErrorListener): void {
    if (type !== "message") return;
    // SAFETY: type is "message", so listener has the MessageListener overload.
    this.#messageListener = listener as MessageListener;
  }

  removeEventListener(_type: "message" | "error", _listener: MessageListener | ErrorListener) {}

  postMessage(request: ExportWorkerRequest, _transfer: Transferable[]): void {
    if (this.failNextPost) {
      this.failNextPost = false;
      throw new DOMException("Clone failed.", "DataCloneError");
    }
    this.requests.push(request);
    queueMicrotask(() => {
      let response: ExportWorkerResponse;
      if (request.type === "start") response = { type: "ready", id: request.id };
      else if (request.type === "frame") {
        response = { type: "frame-added", id: request.id, index: request.index };
      } else if (request.type === "finish") {
        response = {
          type: "done",
          id: request.id,
          mimeType: "image/gif",
          data: new ArrayBuffer(0),
        };
      } else response = { type: "canceled", id: request.id };
      this.#messageListener?.(new MessageEvent("message", { data: response }));
    });
  }

  terminate(): void {}
}

const SETTINGS: ExportSettings = {
  format: "gif",
  width: 2,
  height: 2,
  fps: 30,
  frameCount: 1,
  quality: 0.8,
  transparent: true,
};

describe("ExportClient", () => {
  it("can retry start after postMessage throws", async () => {
    const worker = new ExportWorkerStub();
    worker.failNextPost = true;
    const client = new ExportClient(worker);
    const session = client.createSession(SETTINGS);

    await expect(session.start()).rejects.toThrow("Clone failed");
    await expect(session.start()).resolves.toBeUndefined();
    client.dispose();
  });

  it("copies settings when the session is created", async () => {
    const worker = new ExportWorkerStub();
    const client = new ExportClient(worker);
    const settings = { ...SETTINGS };
    const session = client.createSession(settings);
    settings.width = 400;

    await session.start();
    expect(worker.requests[0]).toMatchObject({ type: "start", settings: { width: 2 } });
    client.dispose();
  });
});
