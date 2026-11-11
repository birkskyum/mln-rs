// Serves web/ (cross-origin isolated, for 5 µs timers) and runs bench.js in
// headless Chromium once per backend: node web.mjs <backend>...
// CHROMIUM overrides the browser; the default is Playwright's Chromium build
// that examples/web/check uses (`npx playwright@1.61.1 install chromium`).
// PASSES sets the passes per measurement (default 15).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, platform, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web');
const build = 'chromium-1228';
const cache =
  process.env.PLAYWRIGHT_BROWSERS_PATH ??
  (platform() === 'darwin' ? path.join(homedir(), 'Library/Caches/ms-playwright') : path.join(homedir(), '.cache/ms-playwright'));
const candidates = [
  path.join(cache, build, 'chrome-linux64/chrome'),
  path.join(cache, build, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  path.join(cache, build, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
  path.join(cache, build, 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'),
];
const chromium = process.env.CHROMIUM ?? candidates.find(existsSync);
if (!chromium) throw new Error(`no Chromium in ${cache}/${build}: run \`npx playwright@1.61.1 install chromium\` or set CHROMIUM`);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
let deliver;
const server = createServer(async (req, res) => {
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.writeHead(204, headers).end();
    deliver(JSON.parse(body));
    return;
  }
  const file = path.join(here, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try {
    const data = await readFile(file);
    res.writeHead(200, { ...headers, 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' }).end(data);
  } catch {
    res.writeHead(404, headers).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

for (const backend of process.argv.slice(2)) {
  const profile = await mkdtemp(path.join(tmpdir(), 'zlib-bench-profile-'));
  const result = new Promise((resolve) => (deliver = resolve));
  const url = `http://127.0.0.1:${port}/index.html?backend=${backend}&passes=${process.env.PASSES ?? 15}`;
  const child = spawn(chromium, ['--headless=new', '--no-sandbox', '--no-first-run', `--user-data-dir=${profile}`, url], {
    stdio: 'ignore',
  });
  const r = await result;
  child.kill();
  await new Promise((resolve) => child.on('exit', resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 5 });
  if (r.error) throw new Error(`${backend}: ${r.error}`);
  console.log(`\n### ${r.backend} (crossOriginIsolated: ${r.crossOriginIsolated}; ${r.userAgent})\n`);
  console.log('| mode | group | blobs | total ms | µs/call |\n|---|---|---|---|---|');
  for (const row of r.rows) {
    console.log(`| ${row.mode} | ${row.group} | ${row.blobs} | ${row.total_ms.toFixed(2)} | ${row.us_per_call.toFixed(1)} |`);
  }
}
server.close();
