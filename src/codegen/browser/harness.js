// Playwright + static server harness, one per test file. Under jest, the test
// files share one Chromium for the whole run (./jest.global_setup.js): a file
// connects to it, and closes its own contexts and server when it ends
// (./jest.setup.js). Outside jest, the harness launches a browser of its own.
//
// Two roles:
//
//   - Runner harness: a single persistent "harness page" per worker.
//     brevity.js is loaded as an ESM module and exposes
//     globalThis.__bv_harness__. Runner methods in ./index.js round-trip
//     through this page via callHarness().
//
//   - Test pages: .dom.test.js files need pages with custom HTML.
//     loadPage() mounts the HTML on the server, navigates a fresh page
//     to it, waits for brevity.js bootstrap, and returns a Node-side
//     wrapper with async send() and async register().

import http from 'http';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { serveStatic } from './static_server.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../..');

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

    // Cacheable for the life of this server: its port, and so its origin, is the
    // test file's own, and sources don't change during a run. Each page after the
    // first in a file loads the compiler's modules from cache.
    await serveStatic(res, PROJECT_ROOT, path, { 'Cache-Control': 'max-age=3600' });
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
  // The run's shared browser, when there is one (./jest.global_setup.js).
  const endpoint = process.env.BREVITY_PW_ENDPOINT || null;
  const browser = endpoint ? await chromium.connect(endpoint) : await chromium.launch({ headless: true });

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
    // Test pages, reused across tests (loadTestPage, releaseTestPages).
    pagePool: [], pagesInUse: new Set(),
  };
  globalThis[HARNESS_KEY] = harness;

  // A browser this harness launched itself dies with the process. A shared one
  // is closed by the global teardown.
  if (!endpoint) {
    const cleanup = () => {
      try { browser.close(); } catch { /* ignore */ }
      try { server.close(); } catch { /* ignore */ }
    };
    process.once('exit', cleanup);
    process.once('SIGINT', () => { cleanup(); process.exit(130); });
    process.once('SIGTERM', () => { cleanup(); process.exit(143); });
  }

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

// Close this file's harness. On a shared browser, `close()` closes this
// connection's contexts and disconnects; the browser stays up for other files.
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

// ── Test page loader for .dom.test.js ────────────────────────────────────
//
// Each call creates a fresh page in the test context, mounts the provided HTML
// on the server, navigates to it, and returns a wrapper:
//   async send(msg) — sends a message and awaits reply-dispatch microtasks
//   async register(id, handler) — registers a Node-side reply handler for an addr
//
// opts.sources: { '/app.bv': '...' } — stubs .bv (and other) fetches via
//               page.route, so tests can exercise the <script src> path
//               without a real file on disk.

// A page is reused from test to test: navigating it gives each test a fresh
// document and realm, and skips starting a renderer (~100ms). Pages a test used
// go back to the pool after it (releaseTestPages, from ./jest.setup.js).
export async function loadTestPage(html, opts = {}) {
  const h = await getHarness();
  const { testContext, mountTestPage } = h;
  let page = h.pagePool.pop();
  if (!page) {
    page = await testContext.newPage();
    wireLogs(page, 'test');
  }
  h.pagesInUse.add(page);

  if (opts.sources) {
    page.__bv_routed__ = true;
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
  await page.waitForFunction(() => !!globalThis.brevity || !!globalThis.__bv_bootstrap_error__, null, { polling: 5 });
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
      if (h.pagesInUse.has(page)) await releasePage(h, page);
    },
  };
  return wrapper;
}

// Back to the pool, with the test's routes gone.
async function releasePage(h, page) {
  h.pagesInUse.delete(page);
  if (page.isClosed()) return;
  if (page.__bv_routed__) {
    page.__bv_routed__ = false;
    try { await page.unroute('**/*'); } catch { /* ignore */ }
  }
  h.pagePool.push(page);
}

// Every page the current test loaded goes back to the pool.
export async function releaseTestPages() {
  const h = globalThis[HARNESS_KEY];
  if (!h) return;
  for (const page of [...h.pagesInUse]) await releasePage(h, page);
}
