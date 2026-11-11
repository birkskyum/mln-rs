#!/usr/bin/env bash
# Browser benchmark: ./web.sh <backend>... (libz-sys, zlib-rs, miniz).
# Builds each backend for wasm32-unknown-unknown as `just profile=release web`
# builds the browser build (opt-level s, then wasm-opt -Oz), then runs them in
# headless Chromium (web.mjs). Needs wasm-bindgen 0.2.130 and binaryen's
# wasm-opt on the PATH; libz-sys needs a clang that targets wasm32.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
corpus="$here/web/corpus"
mkdir -p "$corpus"
python3 -I "$here/extract.py" "$corpus"
for backend in "$@"; do
  CARGO_PROFILE_RELEASE_OPT_LEVEL=s CARGO_TARGET_DIR="$here/target/wasm-$backend" cargo build --release -q \
    --manifest-path "$here/Cargo.toml" --target wasm32-unknown-unknown --lib --features "$backend"
  pkg="$here/web/pkg-$backend"
  wasm-bindgen --target web --out-dir "$pkg" "$here/target/wasm-$backend/wasm32-unknown-unknown/release/zlib_bench.wasm"
  wasm-opt -Oz --converge --one-caller-inline-max-function-size=20 --zero-filled-memory --low-memory-unused \
    --strip-debug --strip-producers --strip-target-features "$pkg/zlib_bench_bg.wasm" -o "$pkg/zlib_bench_bg.wasm"
  echo "$backend: $(wc -c < "$pkg/zlib_bench_bg.wasm") bytes after wasm-opt"
done
node "$here/web.mjs" "$@"
