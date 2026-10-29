import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = join(projectRoot, "native", "source.lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const argumentsPassed = process.argv.slice(2);
const invalidArgument = argumentsPassed.find((argument) => argument !== "--update");
if (invalidArgument) {
  throw new Error(`Unknown argument: ${invalidArgument}`);
}
if (argumentsPassed.filter((argument) => argument === "--update").length > 1) {
  throw new Error("The --update argument may be passed once.");
}
const updateLock = argumentsPassed.includes("--update");

function run(command, args, options = {}) {
  let executable = command;
  let executableArgs = args;
  if (
    process.platform === "win32" &&
    command === "em++" &&
    process.env.EMSDK &&
    process.env.EMSDK_PYTHON
  ) {
    executable = process.env.EMSDK_PYTHON;
    executableArgs = [join(process.env.EMSDK, "upstream", "emscripten", "em++.py"), ...args];
  }
  const result = spawnSync(executable, executableArgs, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}`);
  }
}

function hasConverterSources(path) {
  return (
    existsSync(join(path, "include", "SkeletonData.h")) &&
    existsSync(join(path, "src", "SkeletonData33BinaryReader.cpp")) &&
    existsSync(join(path, "src", "SkeletonData42JsonWriter.cpp"))
  );
}

function revisionOf(path) {
  const result = spawnSync("git", ["-C", path, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function hasCleanWorkingTree(path) {
  const result = spawnSync("git", ["-C", path, "status", "--short"], {
    encoding: "utf8",
    shell: false,
  });
  return result.status === 0 && result.stdout.trim() === "";
}

function remoteRevisionOf(repository, ref) {
  const result = spawnSync("git", ["ls-remote", repository, ref], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Could not resolve converter ref ${ref}: ${result.stderr.trim() || `git exited with status ${result.status ?? "unknown"}`}`,
    );
  }

  const revision = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u))
    .find(([, remoteRef]) => remoteRef === ref)?.[0];
  if (!revision) throw new Error(`Converter ref ${ref} was not found in ${repository}.`);
  return revision;
}

function resolveSource() {
  const configured = process.env.SPINE_CONVERTER_SOURCE;
  if (configured) {
    const source = resolve(configured);
    if (!hasConverterSources(source)) {
      throw new Error(`SPINE_CONVERTER_SOURCE is not a converter checkout: ${source}`);
    }
    const revision = revisionOf(source);
    if (revision && revision !== lock.commit) {
      console.warn(
        `Building configured converter revision ${revision}; the lock file pins ${lock.commit}.`,
      );
    }
    return { path: source, revision, updatesLock: false };
  }

  const revision =
    process.env.SPINE_CONVERTER_COMMIT ||
    (updateLock ? remoteRevisionOf(lock.repository, lock.ref) : lock.commit);
  const sibling = resolve(projectRoot, "..", "SpineSkeletonDataConverter");
  if (
    hasConverterSources(sibling) &&
    revisionOf(sibling) === revision &&
    hasCleanWorkingTree(sibling)
  ) {
    return { path: sibling, revision, updatesLock: updateLock };
  }

  const cached = join(projectRoot, ".cache", "SpineSkeletonDataConverter");
  if (!hasConverterSources(cached)) {
    mkdirSync(dirname(cached), { recursive: true });
    run("git", ["clone", "--filter=blob:none", lock.repository, cached]);
  }
  run("git", ["-C", cached, "fetch", "--depth=1", "origin", revision]);
  run("git", ["-C", cached, "checkout", "--detach", revision]);
  if (!hasCleanWorkingTree(cached)) {
    throw new Error(`Converter cache has local changes: ${cached}`);
  }
  return { path: cached, revision, updatesLock: updateLock };
}

const resolvedSource = resolveSource();
const sourceRoot = resolvedSource.path;
const sourceDirectory = join(sourceRoot, "src");
const conversionSources = readdirSync(sourceDirectory)
  .filter(
    (file) =>
      file === "common.cpp" ||
      file.endsWith("Converter.cpp") ||
      /^SkeletonData(?:33|34|35|36|37|38|40|41|42)(?:Binary|Json)(?:Reader|Writer)\.cpp$/.test(
        file,
      ),
  )
  .toSorted()
  .map((file) => join(sourceDirectory, file));

if (conversionSources.length !== 41) {
  throw new Error(`Expected 41 converter sources, found ${conversionSources.length}`);
}

const outputDirectory = join(projectRoot, "public", "wasm");
mkdirSync(outputDirectory, { recursive: true });

const compiler = process.env.EMXX || "em++";
const output = join(outputDirectory, "converter.js");
const args = [
  "-std=c++20",
  "-O3",
  "-flto",
  "-fexceptions",
  // The shared enum includes timeline values absent from some format-specific switches.
  "-Wno-switch",
  "-I",
  join(sourceRoot, "include"),
  join(projectRoot, "native", "converter_api.cpp"),
  ...conversionSources,
  "-sWASM=1",
  "-sMODULARIZE=1",
  "-sEXPORT_ES6=1",
  "-sENVIRONMENT=worker",
  "-sFILESYSTEM=0",
  "-sALLOW_MEMORY_GROWTH=1",
  "-sDISABLE_EXCEPTION_CATCHING=0",
  "-sASSERTIONS=0",
  "-sINCOMING_MODULE_JS_API=['locateFile','onAbort']",
  "-sEXPORTED_FUNCTIONS=['_malloc','_free','_st_detect_version','_st_convert','_st_output_data','_st_output_size','_st_last_error']",
  "-sEXPORTED_RUNTIME_METHODS=['UTF8ToString','HEAPU8']",
  "-o",
  output,
];

console.log(`Compiling ${conversionSources.length} sources from ${sourceRoot}`);
run(compiler, args);
if (resolvedSource.updatesLock && resolvedSource.revision !== lock.commit) {
  writeFileSync(
    lockPath,
    `${JSON.stringify({ ...lock, commit: resolvedSource.revision }, null, 2)}\n`,
    "utf8",
  );
  console.log(`Recorded converter revision ${resolvedSource.revision} in ${lockPath}`);
}
console.log(`Wrote ${output}`);
