// Close the shared Chromium (./jest.global_setup.js). The browser and dom
// projects both name this file; the first call closes it.
export default async function globalTeardown() {
  const server = globalThis.__bv_browser_server__;
  if (!server) return;
  globalThis.__bv_browser_server__ = null;
  delete process.env.BREVITY_PW_ENDPOINT;
  await server.close();
}
