// Local dev server for the Brevity examples site.
//
// Serves docs/ as the site root, and the compiler/runtime source tree at
// /src/ (brevity.js compiles in-page from plain ESM, so there is no build).
//
//   node docs/serve.js [port]

import http from 'http';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { serveStatic } from '../src/codegen/browser/static_server.js';

const DOCS = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const REPO = resolve(DOCS, '..');
const NO_CACHE = { 'Cache-Control': 'no-store' };

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname.startsWith('/src/')) serveStatic(res, REPO, pathname, NO_CACHE);
  else serveStatic(res, DOCS, pathname, NO_CACHE);
});

const port = Number(process.argv[2]) || 8000;
server.listen(port, '127.0.0.1', () => {
  console.log(`Brevity site: http://127.0.0.1:${port}/site/`);
});
