// Static file serving shared by the browser test harness (./harness.js)
// and the examples-site dev server (docs/serve.js).

import { readFile, stat } from 'fs/promises';
import { extname, resolve, sep } from 'path';
import { brotliCompressSync, gzipSync, constants as zlib } from 'zlib';

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

// Text types worth compressing. Images like PNG are compressed already.
const COMPRESSIBLE = new Set(['.js', '.mjs', '.html', '.css', '.json', '.bv', '.txt', '.svg']);

// Compressed bodies, by encoding and file path. An entry is reused while the file's
// mtime and size are unchanged, so each file is compressed once per edit.
const compressed = new Map();

// The encoding to send: brotli if the client takes it, else gzip, else none.
function pickEncoding(req) {
  const accept = req?.headers['accept-encoding'] || '';
  if (/\bbr\b/.test(accept)) return 'br';
  if (/\bgzip\b/.test(accept)) return 'gzip';
  return null;
}

async function compressedBody(filePath, data, encoding) {
  const { mtimeMs, size } = await stat(filePath);
  const key = `${encoding} ${filePath}`;
  const hit = compressed.get(key);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.body;
  const body = encoding === 'br'
    ? brotliCompressSync(data, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: data.length } })
    : gzipSync(data, { level: 9 });
  compressed.set(key, { mtimeMs, size, body });
  return body;
}

// Serve `urlPath` from under `root`. A path ending in `/` serves its
// index.html. Paths that escape `root` get 403; missing files get 404.
// `compress`: send text files brotli- or gzip-encoded when the request accepts it.
export async function serveStatic(res, root, urlPath, headers = {}, { compress = false } = {}) {
  const rel = urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath;
  const filePath = resolve(root, '.' + decodeURIComponent(rel));
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const type = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    const encoding = compress && COMPRESSIBLE.has(ext) && data.length > 1024 ? pickEncoding(res.req) : null;
    if (encoding) {
      const body = await compressedBody(filePath, data, encoding);
      res.writeHead(200, { ...type, 'Content-Encoding': encoding, 'Vary': 'Accept-Encoding', ...headers });
      res.end(body);
      return;
    }
    res.writeHead(200, { ...type, ...(compress && COMPRESSIBLE.has(ext) ? { 'Vary': 'Accept-Encoding' } : {}), ...headers });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end(`Not found: ${urlPath}`);
  }
}
