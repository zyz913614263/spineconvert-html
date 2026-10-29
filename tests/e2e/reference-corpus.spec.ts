import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { converterWorkerUrl } from "./converter-worker";

const CORPUS_ROOT = resolve(process.cwd(), "..", "SpineSkeletonDataConverter", "data");
type CorpusFixture = {
  family: string;
  stem: string;
  formats?: readonly ("json" | "skel")[];
};

const FIXTURES: readonly CorpusFixture[] = [
  { family: "3.3", stem: "33/tank/export/tank", formats: ["json"] },
  { family: "3.4", stem: "34/goblins/export/goblins-mesh", formats: ["json"] },
  { family: "3.6", stem: "35/spinosaurus/export/spinosaurus" },
  { family: "3.6", stem: "36/spinosaurus/export/spinosaurus-ess" },
  { family: "3.7", stem: "37/coin/export/coin-pro" },
  { family: "3.8", stem: "38/coin/export/coin-pro" },
  { family: "4.0", stem: "40/coin/export/coin-pro" },
  { family: "4.1", stem: "41/coin/export/coin-pro" },
  { family: "4.2", stem: "42/coin/export/coin-pro" },
];

test("normalizes JSON and SKEL files from the reference corpus", async ({ page }) => {
  test.skip(!existsSync(CORPUS_ROOT), "The optional sibling reference corpus is not installed.");
  test.setTimeout(60_000);
  const workerUrl = await converterWorkerUrl();

  const samples = await Promise.all(
    FIXTURES.flatMap(({ family, stem, formats = ["json", "skel"] as const }) =>
      formats.map(async (format) => ({
        family,
        format,
        name: `${stem}.${format}`,
        bytes: [...(await readFile(resolve(CORPUS_ROOT, `${stem}.${format}`)))],
      })),
    ),
  );

  await page.goto("/");
  const converted = await page.evaluate(
    async ({ items, workerUrl }) => {
      type WorkerResponse =
        | { type: "converted"; id: number; inputVersion: string; data: ArrayBuffer }
        | { type: "error"; id: number; message: string };
      const worker = new Worker(workerUrl, { type: "module" });
      let id = 0;

      const convert = (item: (typeof items)[number]) =>
        new Promise<string>((resolveResult, reject) => {
          id += 1;
          const requestId = id;
          const input = new Uint8Array(item.bytes).buffer;
          const removeListeners = () => {
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
            worker.removeEventListener("messageerror", onMessageError);
          };
          const onMessage = (event: MessageEvent<WorkerResponse>) => {
            if (event.data.id !== requestId) return;
            removeListeners();
            if (event.data.type === "error") {
              reject(new Error(`${item.name}: ${event.data.message}`));
              return;
            }
            if (!event.data.inputVersion.startsWith(`${item.family}.`)) {
              reject(new Error(`${item.name}: detected ${event.data.inputVersion}`));
              return;
            }
            // SAFETY: a successful conversion emits JSON. The version check rejects other data.
            const json = JSON.parse(new TextDecoder().decode(event.data.data)) as {
              skeleton?: { spine?: string };
            };
            if (json.skeleton?.spine !== "4.2.11") {
              reject(
                new Error(
                  `${item.name}: canonical version is ${json.skeleton?.spine ?? "missing"}`,
                ),
              );
              return;
            }
            resolveResult(item.name);
          };
          const onError = (event: ErrorEvent) => {
            removeListeners();
            reject(new Error(`${item.name}: ${event.message || "converter worker failed"}`));
          };
          const onMessageError = () => {
            removeListeners();
            reject(new Error(`${item.name}: converter worker returned an unreadable message`));
          };
          worker.addEventListener("message", onMessage);
          worker.addEventListener("error", onError);
          worker.addEventListener("messageerror", onMessageError);
          worker.postMessage(
            {
              type: "convert",
              id: requestId,
              input,
              inputFormat: item.format,
              outputFormat: "json",
              outputVersion: "4.2.11",
              removeCurves: false,
            },
            [input],
          );
        });

      const results: string[] = [];
      for (const item of items) results.push(await convert(item));
      worker.terminate();
      return results;
    },
    { items: samples, workerUrl },
  );

  const expectedSamples = FIXTURES.reduce(
    (total, fixture) => total + (fixture.formats?.length ?? 2),
    0,
  );
  expect(converted).toHaveLength(expectedSamples);
});
