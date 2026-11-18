// One Chromium for the whole run, shared by every worker and test file.
// Each test file connects to it (tens of ms) instead of launching its own
// (~1s), and closes only its own contexts (./harness.js). The browser and
// dom projects both name this file; the second call finds the first's browser.
// (A browser per worker measured no faster.)
export default async function globalSetup() {
  if (process.env.BREVITY_PW_ENDPOINT) return;
  const { chromium } = await import('playwright');
  const server = await chromium.launchServer({ headless: true });
  globalThis.__bv_browser_server__ = server;
  process.env.BREVITY_PW_ENDPOINT = server.wsEndpoint();
}
