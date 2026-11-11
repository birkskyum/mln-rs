"""Writes the benchmark corpus to <out dir>: blobs.bin and index.txt
(`group offset len` per line).

Groups: the zlib blobs of the render suite's cache database (mvt: vector
tiles, png: raster tiles and sprites, other: glyphs, JSON and the rest), and
the gzip-compressed parts of the PMTiles fixtures (pmtiles-internal: root
directories and metadata). Blobs that don't inflate are left out.
"""

import os
import sqlite3
import struct
import sys
import zlib

root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
blobs = []

db = sqlite3.connect(
    "file:" + os.path.join(root, "tools/render-test/testdata/metrics/cache-style.db") + "?mode=ro", uri=True
)
for table in ("tiles", "resources"):
    for (data,) in db.execute(f"select data from {table} where compressed = 1 and data is not null"):
        try:
            raw = zlib.decompress(data)
        except zlib.error:
            continue
        if raw[:4] == b"\x89PNG":
            group = "png"
        elif table == "tiles":
            group = "mvt"
        else:
            group = "other"
        blobs.append((group, data))

pmtiles = os.path.join(root, "crates/mln_storage/testdata/test/fixtures/storage/pmtiles")
for name in sorted(os.listdir(pmtiles)):
    data = open(os.path.join(pmtiles, name), "rb").read()
    root_offset, root_len, meta_offset, meta_len = struct.unpack("<4Q", data[8:40])
    if data[97] != 2:  # internal compression: gzip
        continue
    for offset, length in ((root_offset, root_len), (meta_offset, meta_len)):
        part = data[offset : offset + length]
        try:
            zlib.decompress(part, 16 + zlib.MAX_WBITS)
        except zlib.error:
            continue
        blobs.append(("pmtiles-internal", part))

order = {"mvt": 0, "png": 1, "other": 2, "pmtiles-internal": 3}
blobs.sort(key=lambda b: order[b[0]])
with open(os.path.join(out, "blobs.bin"), "wb") as bin_file, open(os.path.join(out, "index.txt"), "w") as index:
    offset = 0
    for group, data in blobs:
        bin_file.write(data)
        index.write(f"{group} {offset} {len(data)}\n")
        offset += len(data)
print(f"{len(blobs)} blobs, {offset} bytes in {out}")
