import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import antiSlopPlugin from "../../tools/oxlint/anti-slop/index";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const RULE_NAMES = [
  "no-chained-type-assertions",
  "no-conditional-empty-object-spread",
  "no-known-value-widening",
  "no-module-mocking",
  "no-object-parameters",
  "no-reflect-apply",
  "no-reflect-get",
  "no-runtime-typeof",
  "no-shape-in-symbol-names",
  "no-unknown-parameters",
  "no-unknown-returns",
  "no-unknown-type-aliases",
  "no-unsafe-dictionary-type",
  "no-widen-then-assert",
  "require-safety-comment-for-type-assertion",
] as const;

let temporaryDirectory = "";
let configPath = "";

beforeAll(async () => {
  const cacheDirectory = join(PROJECT_ROOT, ".cache");
  await mkdir(cacheDirectory, { recursive: true });
  temporaryDirectory = await mkdtemp(join(cacheDirectory, "anti-slop-test-"));
  configPath = join(temporaryDirectory, ".oxlintrc.json");
  const pluginUrl = pathToFileURL(
    resolve(PROJECT_ROOT, "tools", "oxlint", "anti-slop", "index.ts"),
  ).href;
  await writeFile(
    configPath,
    `${JSON.stringify({
      rules: { "anti-slop/no-reflect-get": "error" },
      jsPlugins: [{ name: "anti-slop", specifier: pluginUrl }],
    })}\n`,
  );
});

afterAll(async () => {
  const relativePath = relative(join(PROJECT_ROOT, ".cache"), temporaryDirectory);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Refusing to remove unexpected test directory: ${temporaryDirectory}`);
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("anti-slop Oxlint plugin", () => {
  it("exports the configured rule set", () => {
    expect(Object.keys(antiSlopPlugin.rules ?? {}).toSorted()).toEqual(RULE_NAMES.toSorted());
  });

  it("loads in Oxlint and reports a configured rule", async () => {
    const sourcePath = join(temporaryDirectory, "reflect-get.ts");
    await writeFile(sourcePath, 'const record = { name: "rig" };\nReflect.get(record, "name");\n');

    const result = spawnSync(
      process.execPath,
      [
        resolve(PROJECT_ROOT, "node_modules", "oxlint", "bin", "oxlint"),
        "--config",
        configPath,
        sourcePath,
      ],
      { cwd: PROJECT_ROOT, encoding: "utf8", shell: false },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("anti-slop(no-reflect-get)");
  });
});
