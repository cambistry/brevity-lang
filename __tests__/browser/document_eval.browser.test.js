import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';

// ═══════════════════════════════════════════════════════════════════════════════
// document.eval — evaluate a JS string at global scope, return stringified result
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser inline script — document.eval', () => {
  const html = `
    <html>
    <head>
      <script type="module" src="/src/codegen/browser/brevity.js"></script>
      <script type="text/brevity" id="main">
        result Text = document.eval("1 + 2")
      </script>
    </head>
    <body></body>
    </html>
  `;

  it('evaluates a JS expression and returns its stringified value', async () => {
    const page = await loadPage(html);
    const replies = [];
    await page.register('t', msg => replies.push(msg));

    await page.send({ id: '1', test: { get: 'result' }, from: 't', to: 'script#main' });

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Text', re: '3', from: 'script#main', to: 't' },
    ]);
  });
});

describe('browser inline script — document.eval reads page state', () => {
  const html = `
    <html>
    <head>
      <script type="module" src="/src/codegen/browser/brevity.js"></script>
      <title>Hello Eval</title>
      <script type="text/brevity" id="main">
        result Text = document.eval("document.title")
      </script>
    </head>
    <body></body>
    </html>
  `;

  it('runs at global scope and can reach DOM globals', async () => {
    const page = await loadPage(html);
    const replies = [];
    await page.register('t', msg => replies.push(msg));

    await page.send({ id: '1', test: { get: 'result' }, from: 't', to: 'script#main' });

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Text', re: 'Hello Eval', from: 'script#main', to: 't' },
    ]);
  });
});
