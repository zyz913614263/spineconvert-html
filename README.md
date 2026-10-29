# Spine Thing

Spine Thing is a browser-based Spine animation viewer, JSON/SKEL converter, and
media exporter. It reads Spine 3.3 through 4.2 JSON and SKEL files, converts them
between supported versions and formats, and previews them with the official
Spine WebGL runtime. Local assets stay on the device. Gallery mode downloads
read-only bundles from configured servers into the same workspace.

## Run it

Use Node.js 20.19 or newer in the Node 20 line, or Node.js 22.12 or newer. You
also need a browser with WebGL.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. In Canvas mode, choose or drop the complete
bundle at once:

- one JSON or binary skeleton, including Unity names such as `.json.bytes` and `.skel.bytes`
- one atlas, including `.atlas.txt`
- each PNG, JPEG, or WebP texture page named by the atlas

The loader inspects payload structure and byte signatures before it falls back
to filenames or MIME types. Conversion and media encoding run in dedicated
workers.

GIF export works without WebCodecs. WebM needs VP8 or VP9 support through
`VideoEncoder`, and MP4 needs H.264 support. The app checks those codecs and
disables formats the browser cannot encode.

## Deploy to Vercel

Import the public GitHub repository into Vercel. Use `npm run build` as the build
command and `dist` as the output directory; Vercel normally detects both from
the Vite project automatically.

The production build generates `robots.txt`, `sitemap.xml`, a canonical URL,
Open Graph metadata, and structured application data. It resolves the public
site URL in this order:

1. `SITE_URL`, when explicitly configured;
2. Vercel's `VERCEL_PROJECT_PRODUCTION_URL` system variable;
3. `https://spine-thing.vercel.app/` as the local-build fallback.

Enable **Automatically expose System Environment Variables** in the Vercel
project, or set `SITE_URL` to the full production URL. This is especially
important when using a custom domain. After deployment, verify `/robots.txt`
and `/sitemap.xml`, add the site to Google Search Console, and submit the
sitemap. Search engines decide when and whether to index a site; these files
make the deployed app crawlable and provide the intended canonical URL.

For GitHub discovery, give the public repository a concise About description,
set the Vercel deployment as its website, and add relevant topics such as
`spine`, `spine-animation`, `animation-viewer`, `webgl`, `wasm`, and
`skeleton-animation`.

## Gallery sources

The built-in source list lives in `src/config/gallery-sources.json`. It contains
ten catalogs by default, including the
[`langrisser-spiner-db` catalog](https://github.com/OldBernhardt/langrisser-spiner-db).
Users can add other HTTP or HTTPS manifest URLs in Gallery mode. The browser
must be able to fetch each manifest and its assets under the host's CORS policy.

Set `VITE_GALLERY_MANIFEST_URL` during development to replace the first built-in
manifest URL. Custom sources added through the UI stay in local storage on that
device.

A version 1 manifest may declare `skeleton`, `atlas`, and `textures`, or supply an
`assets` array for content-based role detection. Relative asset URLs resolve
against the manifest URL. The app can check declared byte counts and SHA-256
digests.

TanStack Query cancels abandoned requests and retries network or server failures.
It caches catalogs and selected bundles. Requests omit credentials. Loader IDs
resolve through the local registry in `src/services/gallery-client.ts`; a
manifest cannot load remote code. Register application-owned loaders with
`registerGalleryBundleLoader`.

## Support matrix

| Capability               | 3.3 | 3.4 | 3.5 | 3.6 | 3.7 | 3.8 | 4.0 | 4.1 | 4.2 |
| ------------------------ | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| JSON read/write          | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| SKEL read/write          | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Cross-version conversion | yes | yes | yes | yes | yes | yes | yes | yes | yes |

The converter detects input versions from file content. Enter a complete
`major.minor.patch` target because the converter writes that value into the
output. A downgrade cannot retain data that the older Spine format cannot
represent, so keep the source file and test the result in its target runtime.
Conversion downloads contain skeleton data. The app uses the atlas and textures
for preview without rewriting them.

## Implementation

- A C++ reader and writer core from `SpineSkeletonDataConverter` compiles to
  WebAssembly behind an in-memory C API. `native/source.lock.json` records the
  commit used for the checked-in artifact.
- The converter creates canonical Spine 4.2 JSON for preview. It creates the
  requested download in a separate conversion, so preview normalization does not
  change the downloaded file.
- Before animation export, the renderer samples each output timestamp and
  combines the attachment bounds. Automatic sizing keeps the combined aspect
  ratio, applies the requested padding, and treats width and height as upper
  limits.
- The encoding worker caps GIF frame input at 512 MiB and encodes it with
  modern-gif. Mediabunny writes WebM with VP9 or VP8 and MP4 with H.264 through
  the browser's `VideoEncoder`.

See [docs/architecture.md](docs/architecture.md) for the data flow and
[native/README.md](native/README.md) for native build details.

## Development

Run every required check with:

```sh
npm run verify
```

That command checks formatting, lint rules, unit tests, the production build,
and Playwright tests. You can run each step on its own:

```sh
npm run typecheck
npm run test
npm run lint
npm run format
npm run build
npm run test:e2e
```

The project uses TypeScript 7, type-aware Oxlint rules, and Oxfmt. The repository
tracks the generated converter files, so web development does not require
Emscripten.

Install Emscripten before rebuilding the converter:

```sh
npm run build:converter
```

The default build uses the commit in `native/source.lock.json`. It uses a clean,
matching sibling checkout when one exists and otherwise uses a cached checkout.
Run `npm run build:converter:update` to resolve the configured ref and update the
lock after compilation succeeds. `SPINE_CONVERTER_COMMIT` selects an exact commit.
The update command records that selection in the lock. `SPINE_CONVERTER_SOURCE`
selects a local checkout without changing the lock, and `EMXX` selects the
Emscripten C++ compiler.

The Playwright matrix covers JSON readers, JSON writers, and JSON to SKEL to JSON
round trips for all nine supported version families. Other browser tests cover
local upload, gallery loading, WebGL preview, layered clips, PNG capture, and GIF,
WebM, and supported MP4 downloads. The reference-corpus test checks real JSON and
SKEL exports when a matching sibling converter checkout is available.

## Licensing

Spine Thing's original project code is available under the permissive
[MIT License](LICENSE). That license allows use, modification, distribution,
sublicensing, and commercial use of the original code.

The MIT license does not relicense third-party components. The complete build
integrates software with additional downstream conditions:

- the official Spine runtime has its own license and may require each user to own
  a Spine Editor license;
- the converter core and the generated `public/wasm/converter.js` and
  `public/wasm/converter.wasm` artifacts remain under PolyForm Noncommercial
  1.0.0, so the complete build is not licensed for unrestricted commercial use;
- all other third-party packages remain under their respective licenses.

Read the [third-party notices](THIRD_PARTY_NOTICES.md) and the notice shipped with
the built app before redistributing the application.
