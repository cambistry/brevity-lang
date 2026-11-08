// Static file serving shared by the browser test harness (./harness.js)
// and the examples-site dev server (docs/serve.js).

import { readFile } from 'fs/promises';
import { extname, resolve, sep } from 'path';

export const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bv': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// Serve `urlPath` from under `root`. A path ending in `/` serves its
// index.html. Paths that escape `root` get 403; missing files get 404.
export async function serveStatic(res, root, urlPath, headers = {}) {
  const rel = urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath;
  const filePath = resolve(root, '.' + decodeURIComponent(rel));
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', ...headers });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end(`Not found: ${urlPath}`);
  }
}
