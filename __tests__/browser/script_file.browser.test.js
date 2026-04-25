import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';

// ═══════════════════════════════════════════════════════════════════════════════
// External script src — load .bv file via src attribute
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser external script — src attribute', () => {
  const html = `
    <html>
    <head>
      <script type="module" src="/src/codegen/browser/brevity.js"></script>
      <script type="text/brevity" id="main" src="/app.bv"></script>
    </head>
    <body></body>
    </html>
  `;

  it('fetches .bv source and runs the actor', async () => {
    const page = await loadPage(html, { sources: { '/app.bv': `x Integer! = 42` } });
    const replies = [];
    await page.register('t', msg => replies.push(msg));

    await page.send({ id: '1', test: { get: 'x' }, from: 't', to: 'app.bv' });

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Integer', re: 42, from: 'app.bv', to: 't' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// External script src — explicit document DI via <:document *>
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser external script — explicit document DI', () => {
  const html = `
    <html>
    <head>
      <script type="module" src="/src/codegen/browser/brevity.js"></script>
      <title>Page Title</title>
      <script type="text/brevity" id="main" src="/app.bv"></script>
    </head>
    <body></body>
    </html>
  `;

  it('reads document.title() when the .bv file requests <:document>', async () => {
    const page = await loadPage(html, {
      sources: { '/app.bv': `<:document>\n=\nti Text = document.title()\n` },
    });
    const replies = [];
    await page.register('t', msg => replies.push(msg));

    await page.send({ id: '1', test: { get: 'ti' }, from: 't', to: 'app.bv' });

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Text', re: 'Page Title', from: 'app.bv', to: 't' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// External script src — HTML mutation visible to Playwright
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser external script — append! to body', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" src="/app.bv"></script>
    </head><body></body></html>`;

  it('appends to the HTML from a fetched .bv file', async () => {
    const page = await loadPage(html, {
      sources: {
        '/app.bv': `<:document, HTML: (:p)>
=
body = document.body()
body.append!(<p>From file</p>)
`,
      },
    });
    const bodyHTML = await page.evaluate(() => document.body.innerHTML);
    expect(bodyHTML).toBe('<p>From file</p>');
  });
});
