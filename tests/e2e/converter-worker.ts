import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

export async function converterWorkerUrl(): Promise<string> {
  const assetNames = await readdir(resolve(process.cwd(), "dist", "assets"));
  const workerNames = assetNames.filter((name) => /^converter\.worker-[^.]+\.js$/u.test(name));
  if (workerNames.length !== 1) {
    throw new Error(`Expected one converter worker in dist/assets, found ${workerNames.length}.`);
  }
  return `/assets/${workerNames[0]}`;
}
