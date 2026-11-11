// Runs one backend's module over the corpus and POSTs the results to /result.
// Query: backend=<name>&passes=<n>.
const params = new URLSearchParams(location.search);
const backend = params.get('backend');
const passes = Number(params.get('passes') ?? 15);

async function main() {
  const mod = await import(`./pkg-${backend}/zlib_bench.js`);
  await mod.default();
  const [bin, index] = await Promise.all([
    fetch('corpus/blobs.bin').then((r) => r.arrayBuffer()),
    fetch('corpus/index.txt').then((r) => r.text()),
  ]);
  const n = mod.load(new Uint8Array(bin), index);
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const g = mod.group(i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(i);
  }
  groups.set('all', [...Array(n).keys()]);

  // The DecompressionStream path must give the same bytes' length.
  for (let i = 0; i < n; i++) {
    const [a, b] = [mod.inflate(i), await mod.inflate_stream(i)];
    if (a !== b) throw new Error(`blob ${i}: sync ${a} != stream ${b}`);
  }

  const limited = async (ids, limit) => {
    let next = 0;
    const worker = async () => {
      while (next < ids.length) await mod.inflate_stream(ids[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, worker));
  };
  const modes = {
    sync: async (ids) => {
      for (const i of ids) mod.inflate(i);
    },
    'stream, 1 in flight': async (ids) => {
      for (const i of ids) await mod.inflate_stream(i);
    },
    'stream, 16 in flight': (ids) => limited(ids, 16),
    'stream, all in flight': (ids) => Promise.all(ids.map((i) => mod.inflate_stream(i))),
  };
  const median = (v) => {
    v.sort((a, b) => a - b);
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const rows = [];
  for (const [mode, run] of Object.entries(modes)) {
    for (const [group, ids] of groups) {
      await run(ids); // warm-up
      const times = [];
      for (let p = 0; p < passes; p++) {
        const t = performance.now();
        await run(ids);
        times.push(performance.now() - t);
      }
      const total = median(times);
      rows.push({ mode, group, blobs: ids.length, total_ms: total, us_per_call: (total * 1000) / ids.length });
    }
  }
  return { backend: mod.backend(), crossOriginIsolated, userAgent: navigator.userAgent, rows };
}

main()
  .then((result) => fetch('/result', { method: 'POST', body: JSON.stringify(result) }))
  .catch((e) => fetch('/result', { method: 'POST', body: JSON.stringify({ error: String(e?.stack ?? e) }) }));
