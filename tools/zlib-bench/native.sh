#!/usr/bin/env bash
# Native benchmark: ./native.sh <backend>... (libz-sys, zlib-rs, miniz, libz-ffi).
# Extracts the corpus, builds each backend in release, then runs every backend
# once per round, interleaved, for ROUNDS rounds (default 3) of PASSES passes
# (default 15).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
corpus=$(mktemp -d)
trap 'rm -rf "$corpus"' EXIT
python3 -I "$here/extract.py" "$corpus"
for backend in "$@"; do
  CARGO_TARGET_DIR="$here/target/$backend" cargo build --release -q \
    --manifest-path "$here/Cargo.toml" --features "$backend"
done
for round in $(seq "${ROUNDS:-3}"); do
  for backend in "$@"; do
    echo "## round $round"
    "$here/target/$backend/release/zlib-bench" "$corpus" "${PASSES:-15}"
  done
done
