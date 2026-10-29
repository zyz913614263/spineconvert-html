# Native converter core

The browser converter compiles the C++ `SpineSkeletonDataConverter` sources named
by `native/source.lock.json`. The core has readers and writers for Spine 3.3
through 3.8 and 4.0 through 4.2 in JSON and binary form.

`native/converter_api.cpp` replaces the filesystem command-line interface with an
exception-safe, in-memory C API. `npm run build:converter` compiles that API and
the selected upstream sources with Emscripten.

The default build uses the commit in `source.lock.json`. It uses a sibling
`SpineSkeletonDataConverter` checkout if that checkout is clean and matches the
commit. For other cases, the script clones or updates
`.cache/SpineSkeletonDataConverter`.

`npm run build:converter:update` resolves the configured repository ref. After a
successful compilation, it updates the `commit` field in `source.lock.json`.

Use these environment variables for an override:

- `SPINE_CONVERTER_COMMIT` selects one commit. The update command records it in
  `source.lock.json`; the default command does not.
- `SPINE_CONVERTER_SOURCE` builds an explicit local checkout. The script warns
  when its commit differs from the lock.
- `EMXX` selects the Emscripten C++ compiler.

The build writes `public/wasm/converter.js` and `public/wasm/converter.wasm`. The
converter worker loads both files and performs version detection and format
conversion away from the main thread.
