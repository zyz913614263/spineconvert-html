import type { ConverterRequest, ConverterResponse } from "../domain/conversion/protocol";
import { isSupportedVersion } from "../domain/spine/version";
import { detached } from "../lib/detached";
import { errorMessage } from "../lib/utils";

type ConverterModule = {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _st_detect_version(input: number, size: number): number;
  _st_convert(
    input: number,
    size: number,
    inputFormat: number,
    outputFormat: number,
    outputVersion: number,
    removeCurves: number,
  ): number;
  _st_output_data(): number;
  _st_output_size(): number;
  _st_last_error(): number;
  UTF8ToString(pointer: number): string;
};

type ConverterModuleFactory = (options: {
  locateFile(path: string): string;
  onAbort(reason: string): void;
}) => Promise<ConverterModule>;

type WorkerScope = {
  location: Location;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<ConverterRequest>) => void,
  ): void;
  postMessage(message: ConverterResponse, transfer?: Transferable[]): void;
};

// TypeScript uses Window for `self` because this project includes lib.dom.
declare const self: WorkerScope;
const workerScope = self;
let modulePromise: Promise<ConverterModule> | undefined;

function wasmAsset(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}wasm/${path}`, workerScope.location.origin).href;
}

async function loadModule(): Promise<ConverterModule> {
  modulePromise ??= (async () => {
    const moduleUrl = wasmAsset("converter.js");
    // SAFETY: The local Emscripten build exports ConverterModuleFactory here.
    const imported = (await import(/* @vite-ignore */ moduleUrl)) as {
      default: ConverterModuleFactory;
    };
    const module = await imported.default({
      locateFile: (path) => wasmAsset(path),
      onAbort: (reason) => {
        throw new Error(`Converter WebAssembly aborted: ${reason}`);
      },
    });
    if (!(module.HEAPU8 instanceof Uint8Array)) {
      throw new Error(
        "Converter WebAssembly did not expose its byte heap. Rebuild the native artifact.",
      );
    }
    return module;
  })();
  return modulePromise;
}

function withBytes<T>(
  module: ConverterModule,
  bytes: ArrayBuffer,
  callback: (pointer: number) => T,
): T {
  const input = new Uint8Array(bytes);
  const pointer = module._malloc(input.byteLength || 1);
  if (!pointer) throw new Error("Converter WebAssembly could not allocate input memory.");
  try {
    module.HEAPU8.set(input, pointer);
    return callback(pointer);
  } finally {
    module._free(pointer);
  }
}

function withCString<T>(
  module: ConverterModule,
  value: string,
  callback: (pointer: number) => T,
): T {
  const encoded = new TextEncoder().encode(`${value}\0`);
  const pointer = module._malloc(encoded.byteLength);
  if (!pointer) throw new Error("Converter WebAssembly could not allocate string memory.");
  try {
    module.HEAPU8.set(encoded, pointer);
    return callback(pointer);
  } finally {
    module._free(pointer);
  }
}

function lastError(module: ConverterModule): string {
  const pointer = module._st_last_error();
  return pointer ? module.UTF8ToString(pointer) : "Conversion failed without an error message.";
}

function detect(module: ConverterModule, input: ArrayBuffer): string {
  return withBytes(module, input, (pointer) => {
    const result = module._st_detect_version(pointer, input.byteLength);
    if (!result) throw new Error(lastError(module));
    return module.UTF8ToString(result);
  });
}

function postProgress(id: number, phase: "wasm" | "detect" | "convert"): void {
  const response: ConverterResponse = { type: "progress", id, phase };
  workerScope.postMessage(response);
}

workerScope.addEventListener("message", (event: MessageEvent<ConverterRequest>) => {
  detached(
    (async () => {
      const request = event.data;
      try {
        postProgress(request.id, "wasm");
        const module = await loadModule();
        postProgress(request.id, "detect");
        const detected = detect(module, request.input);
        if (!isSupportedVersion(detected)) {
          throw new Error(`Unsupported Spine version: ${detected}`);
        }

        if (request.type === "detect") {
          const response: ConverterResponse = {
            type: "detected",
            id: request.id,
            version: detected,
          };
          workerScope.postMessage(response);
          return;
        }

        postProgress(request.id, "convert");
        const data = withBytes(module, request.input, (inputPointer) =>
          withCString(module, request.outputVersion, (versionPointer) => {
            const status = module._st_convert(
              inputPointer,
              request.input.byteLength,
              request.inputFormat === "json" ? 0 : 1,
              request.outputFormat === "json" ? 0 : 1,
              versionPointer,
              request.removeCurves ? 1 : 0,
            );
            if (status !== 0) throw new Error(lastError(module));

            const outputPointer = module._st_output_data();
            const outputSize = module._st_output_size();
            if (!outputPointer || outputSize === 0) {
              throw new Error("Converter produced an empty file.");
            }
            return module.HEAPU8.slice(outputPointer, outputPointer + outputSize).buffer;
          }),
        );

        const response: ConverterResponse = {
          type: "converted",
          id: request.id,
          inputVersion: detected,
          data,
        };
        workerScope.postMessage(response, [data]);
      } catch (error) {
        const response: ConverterResponse = {
          type: "error",
          id: event.data.id,
          message: errorMessage(error),
        };
        workerScope.postMessage(response);
      }
    })(),
    "converter-worker.handle-message",
  );
});
