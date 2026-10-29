import { expect, test } from "@playwright/test";

import { converterWorkerUrl } from "./converter-worker";

const TARGETS = [
  "3.3.07",
  "3.4.02",
  "3.5.51",
  "3.6.53",
  "3.7.94",
  "3.8.99",
  "4.0.64",
  "4.1.24",
  "4.2.11",
] as const;

test("reads and writes JSON and SKEL for each supported Spine family", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const workerUrl = await converterWorkerUrl();

  const report = await page.evaluate(
    async ({ targets, workerUrl }) => {
      type Format = "json" | "skel";
      type WorkerResponse =
        | { type: "converted"; id: number; inputVersion: string; data: ArrayBuffer }
        | { type: "error"; id: number; message: string };

      const worker = new Worker(workerUrl, { type: "module" });
      let nextId = 1;

      type WorkerRequest = {
        type: "convert";
        input: ArrayBuffer;
        inputFormat: Format;
        outputFormat: Format;
        outputVersion: string;
        removeCurves: boolean;
      };

      const call = (
        message: WorkerRequest,
      ): Promise<Extract<WorkerResponse, { type: "converted" }>> => {
        const id = nextId;
        nextId += 1;
        const input = message.input.slice(0);
        return new Promise((resolve, reject) => {
          const removeListeners = () => {
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
            worker.removeEventListener("messageerror", onMessageError);
          };
          const onMessage = (event: MessageEvent<WorkerResponse>) => {
            if (event.data.id !== id) return;
            removeListeners();
            if (event.data.type === "error") {
              reject(new Error(event.data.message));
              return;
            }
            resolve(event.data);
          };
          const onError = (event: ErrorEvent) => {
            removeListeners();
            reject(new Error(event.message || "Converter worker failed to load."));
          };
          const onMessageError = () => {
            removeListeners();
            reject(new Error("Converter worker returned an unreadable message."));
          };
          worker.addEventListener("message", onMessage);
          worker.addEventListener("error", onError);
          worker.addEventListener("messageerror", onMessageError);
          worker.postMessage({ ...message, id, input }, [input]);
        });
      };

      const convert = async (
        input: ArrayBuffer,
        inputFormat: Format,
        outputFormat: Format,
        outputVersion: string,
      ) =>
        call({
          type: "convert",
          input,
          inputFormat,
          outputFormat,
          outputVersion,
          removeCurves: false,
        });

      const declaredVersion = (data: ArrayBuffer): string | undefined => {
        // SAFETY: the converter emits JSON. The version checks below reject another format.
        const parsed = JSON.parse(new TextDecoder().decode(data)) as {
          skeleton?: { spine?: string };
        };
        return parsed.skeleton?.spine;
      };

      const encodeJson = (version: string) =>
        new TextEncoder().encode(
          JSON.stringify({
            skeleton: { spine: version, x: 0, y: 0, width: 1, height: 1 },
            bones: [{ name: "root" }],
            animations: {},
          }),
        ).buffer;

      const jsonReaders: string[] = [];
      for (const sourceVersion of targets) {
        let result: Extract<WorkerResponse, { type: "converted" }>;
        try {
          result = await convert(encodeJson(sourceVersion), "json", "json", "4.2.11");
        } catch (error) {
          throw new Error(
            `JSON reader ${sourceVersion}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        if (result.inputVersion !== sourceVersion)
          throw new Error(`Detected ${result.inputVersion}, expected ${sourceVersion}`);
        if (declaredVersion(result.data) !== "4.2.11")
          throw new Error(`Bad normalized JSON from ${sourceVersion}`);
        jsonReaders.push(sourceVersion);
      }

      const lateHeader = new TextEncoder().encode(
        JSON.stringify({
          metadata: "x".repeat(600),
          skeleton: { spine: "4.2.11-beta" },
          bones: [{ name: "root" }],
          animations: {},
        }),
      ).buffer;
      const lateHeaderResult = await convert(lateHeader, "json", "json", "4.2.11");
      if (lateHeaderResult.inputVersion !== "4.2.11")
        throw new Error("Failed to detect a late JSON version field");

      const canonical = encodeJson("4.2.11");
      const roundTrips: string[] = [];
      for (const target of targets) {
        let json: Extract<WorkerResponse, { type: "converted" }>;
        try {
          json = await convert(canonical, "json", "json", target);
        } catch (error) {
          throw new Error(
            `JSON writer ${target}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        if (declaredVersion(json.data) !== target) throw new Error(`Bad ${target} JSON writer`);

        let binary: Extract<WorkerResponse, { type: "converted" }>;
        try {
          binary = await convert(json.data, "json", "skel", target);
        } catch (error) {
          throw new Error(
            `SKEL writer ${target}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        let restored: Extract<WorkerResponse, { type: "converted" }>;
        try {
          restored = await convert(binary.data, "skel", "json", target);
        } catch (error) {
          throw new Error(
            `SKEL reader ${target}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        if (restored.inputVersion !== target) throw new Error(`Bad ${target} SKEL detection`);
        if (declaredVersion(restored.data) !== target)
          throw new Error(`Bad ${target} SKEL round trip`);
        roundTrips.push(target);
      }

      worker.terminate();
      return { jsonReaders, roundTrips };
    },
    { targets: TARGETS, workerUrl },
  );

  expect(report.jsonReaders).toEqual(TARGETS);
  expect(report.roundTrips).toEqual(TARGETS);
});
