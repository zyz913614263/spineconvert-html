# Architecture

## Runtime and conversion

The app previews animations with `@esotericsoftware/spine-webgl` 4.2. The
converter first writes canonical 4.2 JSON for that runtime. A separate conversion
writes the requested target version and format, so preview setup cannot mutate
the download.

The preview renderer and converter have separate jobs. The renderer owns WebGL
playback and frame capture. The WebAssembly converter owns version detection plus
JSON and SKEL translation. Conversion does not depend on private renderer state.

## Data flow

1. Local selection and gallery loaders produce a `SpineAssetBundle`. The loader
   checks payload structure and signatures first, then MIME types and suffix
   chains such as `.skel.bytes` and `.atlas.txt`.
2. The conversion worker detects the input version and calls the pinned C++ WebAssembly module.
3. Canonical 4.2 JSON feeds the WebGL renderer. A separate worker request creates the target download.
4. For animation export, the renderer samples every output frame and combines the
   rendered attachment bounds. Automatic sizing fits that box inside the
   requested width and height, keeps its aspect ratio, and adds the requested
   padding.
5. The main thread transfers each RGBA frame buffer to the encoding worker.
   modern-gif handles GIF output and accepts at most 512 MiB of input frames.
   Mediabunny uses browser WebCodecs for VP9 or VP8 WebM and H.264 MP4 output. The
   worker reports unsupported codecs instead of substituting another format.

Local files stay in the browser. The app has no upload endpoint or analytics
request. Gallery mode fetches the manifest and the bundle a user selects, then
sends that bundle through the same conversion, preview, and export code.

## Gallery loading

TanStack Query manages catalog and bundle requests. Catalogs remain fresh for five
minutes and cached for thirty minutes. Selected bundles remain fresh while cached
and leave the cache after five unused minutes. Queries pass TanStack Query's
`AbortSignal` to `fetch`, omit credentials, and retry network or server failures
at most twice.

The manifest parser accepts schema version 1. ArkType validates the catalog in
`src/domain/gallery/manifest.ts`, then the parser resolves relative URLs against
the final manifest response URL. Hosts that use another catalog shape must
convert it before the app reads it.

A manifest can set `defaults.premultipliedAlpha` to `auto`, `premultiplied`, or
`straight` for every bundle in the catalog. An item's
`bundle.premultipliedAlpha` overrides that catalog default. Built-in sources can
also declare the same default in `src/config/gallery-sources.json`; the resolved
precedence is item, remote manifest, built-in source, then `auto`.

The local loader registry contains:

- `spine-bundle-v1` for declared skeleton, atlas, and texture roles
- `spine-auto-v1` for unordered assets classified from their contents

Trusted application code can add a loader with `registerGalleryBundleLoader`.
Remote manifests can name a registered loader but cannot import or execute code.
Asset entries may include byte counts and SHA-256 digests for download checks.

Built-in gallery sources live in `src/config/gallery-sources.json`. Users can add
custom HTTP or HTTPS manifest URLs. `src/domain/gallery/sources.ts` validates
them, and `src/app/hooks/use-gallery-sources.ts` stores valid entries in local
storage.
