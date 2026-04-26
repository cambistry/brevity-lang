// Playwright + static server harness, one per jest worker.
//
// Two roles:
//
//   - Runner harness: a single persistent "harness page" per worker.
//     brevity.js is loaded as an ESM module and exposes
//     globalThis.__bv_harness__. Runner methods in ./index.js round-trip
//     through this page via callHarness().
//
//   - Test pages: .browser.test.js files need pages with custom HTML.
//     loadPage() mounts the HTML on the server, navigates a fresh page
//     to it, waits for brevity.js bootstrap, and returns a Node-side
//     wrapper with async send() and async register().

import http from 'http';
import { readFile } from 'fs/promises';
import { extname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../..');

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bv': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const HARNESS_PAGE = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>brevity harness</title>
  <script type="module" src="/src/codegen/browser/brevity.js"></script>
</head>
<body></body>
</html>`;

async function startServer(testPages) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    if (path === '/__page__') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HARNESS_PAGE);
      return;
    }

    if (path.startsWith('/__t/')) {
      const id = path.slice('/__t/'.length);
      const html = testPages.get(id);
      if (html != null) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      res.writeHead(404); res.end(`Unknown test page: ${id}`); return;
    }

    const filePath = resolve(PROJECT_ROOT, '.' + path);
    if (!filePath.startsWith(PROJECT_ROOT)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    try {
      const data = await readFile(filePath);
      const ext = extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end(`Not found: ${path}`);
    }
  });
  await new Promise((r, rej) => {
    server.once('error', rej);
    server.listen(0, '127.0.0.1', r);
  });
  server.unref(); // don't keep the event loop alive during jest teardown
  const { port } = server.address();
  return { server, baseURL: `http://127.0.0.1:${port}` };
}

const HARNESS_KEY = Symbol.for('brevity-lang.browser.harness');

export async function getHarness() {
  if (globalThis[HARNESS_KEY]) return globalThis[HARNESS_KEY];

  const { chromium } = await import('playwright');
  const testPages = new Map();
  const { server, baseURL } = await startServer(testPages);
  const browser = await chromium.launch({ headless: true });

  const runnerContext = await browser.newContext({ baseURL });
  const runnerPage = await runnerContext.newPage();
  wireLogs(runnerPage, 'runner');

  await runnerPage.goto('/__page__');
  await runnerPage.waitForFunction(() => !!globalThis.__bv_harness__, null, { timeout: 30000 });

  const testContext = await browser.newContext({ baseURL });

  let nextTestId = 0;
  function mountTestPage(html) {
    const id = String(++nextTestId);
    testPages.set(id, html);
    return `/__t/${id}`;
  }

  const harness = {
    server, browser, runnerContext, runnerPage, testContext,
    baseURL, testPages, mountTestPage,
  };
  globalThis[HARNESS_KEY] = harness;

  const cleanup = () => {
    try { browser.close(); } catch { /* ignore */ }
    try { server.close(); } catch { /* ignore */ }
  };
  process.once('exit', cleanup);
  process.once('SIGINT', () => { cleanup(); process.exit(130); });
  process.once('SIGTERM', () => { cleanup(); process.exit(143); });

  return harness;
}

function wireLogs(page, label) {
  page.on('pageerror', err => {
    console.error(`[${label} pageerror]`, err.message);
  });
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    // Suppress Chromium's auto-generated network-loader noise. Tests
    // intentionally use bogus asset URLs (e.g. <img src="/i.png">) to
    // verify attributes land on elements; they don't care that the
    // browser then 404s fetching the resource. Real test failures from
    // script imports etc. surface as `pageerror` (uncaught exceptions),
    // not as this prefix.
    const text = msg.text();
    if (text.startsWith('Failed to load resource:')) return;
    console.error(`[${label} console.error]`, text);
  });
}

export async function closeHarness() {
  const h = globalThis[HARNESS_KEY];
  if (!h) return;
  globalThis[HARNESS_KEY] = null;
  try { await h.browser.close(); } catch { /* ignore */ }
  try { h.server.close(); } catch { /* ignore */ }
}

// Call an in-page harness method on the runner page.
export async function callHarness(method, args) {
  const { runnerPage } = await getHarness();
  return runnerPage.evaluate(
    ([m, a]) => globalThis.__bv_harness__[m](a),
    [method, args],
  );
}

// ── Test page loader for .browser.test.js ────────────────────────────────────
//
// Each call creates a fresh page in the test context, mounts the provided HTML
// on the server, navigates to it, and returns a wrapper:
//   async send(msg) — sends a message and awaits reply-dispatch microtasks
//   async register(id, handler) — registers a Node-side reply handler for an addr
//
// opts.sources: { '/app.bv': '...' } — stubs .bv (and other) fetches via
//               page.route, so tests can exercise the <script src> path
//               without a real file on disk.

export async function loadTestPage(html, opts = {}) {
  const { testContext, mountTestPage } = await getHarness();
  const page = await testContext.newPage();
  wireLogs(page, 'test');

  if (opts.sources) {
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (Object.prototype.hasOwnProperty.call(opts.sources, url.pathname)) {
        const body = opts.sources[url.pathname];
        return route.fulfill({
          status: 200,
          contentType: 'text/plain; charset=utf-8',
          body,
        });
      }
      return route.continue();
    });
  }

  const path = mountTestPage(html);
  await page.goto(path);
  await page.waitForFunction(() => !!globalThis.brevity || !!globalThis.__bv_bootstrap_error__);
  const bootErr = await page.evaluate(() => globalThis.__bv_bootstrap_error__ || null);
  if (bootErr) throw new Error(`brevity.js bootstrap error: ${bootErr}`);

  // Install a test helper on the page that mirrors the old send/register API
  // but routes reply dispatch through a drainable outbox so Node can read it
  // synchronously after awaiting send().
  await page.evaluate(() => {
    // BigInt can't cross the CDP boundary; normalize to Number when safe.
    function normalizeBigInts(val) {
      if (typeof val === 'bigint') {
        if (val >= Number.MIN_SAFE_INTEGER && val <= Number.MAX_SAFE_INTEGER) return Number(val);
        return val;
      }
      if (Array.isArray(val)) return val.map(normalizeBigInts);
      if (val !== null && typeof val === 'object') {
        if (typeof val.toNumber === 'function' && 'c' in val && 's' in val) return val.toNumber();
        const out = {};
        for (const [k, v] of Object.entries(val)) out[k] = normalizeBigInts(v);
        return out;
      }
      return val;
    }
    const outbox = new Map();
    globalThis.__bv_test__ = {
      register(id) {
        if (outbox.has(id)) return;
        outbox.set(id, []);
        globalThis.brevity.register(id, msg => outbox.get(id).push(msg));
      },
      drainAll(ids) {
        const out = {};
        for (const id of ids) {
          out[id] = (outbox.get(id) || []).map(normalizeBigInts);
          outbox.set(id, []);
        }
        return out;
      },
      async send(msg) {
        globalThis.brevity.send(msg);
        // Two ticks: first lets Promise.resolve().then() queued replies fire,
        // second lets any chained microtasks settle.
        await new Promise(r => setTimeout(r, 0));
        await new Promise(r => setTimeout(r, 0));
      },
    };
  });

  const handlers = new Map();

  const wrapper = {
    async send(msg) {
      await page.evaluate(m => globalThis.__bv_test__.send(m), msg);
      if (handlers.size === 0) return;
      const ids = [...handlers.keys()];
      const drained = await page.evaluate(
        is => globalThis.__bv_test__.drainAll(is),
        ids,
      );
      for (const id of ids) for (const m of drained[id]) handlers.get(id)(m);
    },
    async register(id, handler) {
      handlers.set(id, handler);
      await page.evaluate(i => globalThis.__bv_test__.register(i), id);
    },
    // Pass-through to Playwright's page.evaluate so tests can assert against
    // the real HTML directly, rather than routing queries back through brevity.
    evaluate: (fn, ...args) => page.evaluate(fn, ...args),
    async connectActor(address) {
      const testAddr = `__connect_${address}`;
      const posts = [];
      await wrapper.register(testAddr, msg => posts.push(msg));
      return {
        posts,
        async sendAsync(msg) {
          await wrapper.send({ ...msg, from: testAddr, to: address });
        },
      };
    },
    async close() {
      try { await page.close(); } catch { /* ignore */ }
    },
  };
  return wrapper;
}
