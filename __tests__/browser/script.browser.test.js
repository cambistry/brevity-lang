import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Inline <script type="text/brevity"> actor — test.get
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser inline script — test.get', () => {
  const html = `
    <html>
    <head>
      <script type="module" src="/src/codegen/browser/brevity.js"></script>
      <script type="text/brevity" id="main">
        x Integer! = 100
      </script>
    </head>
    <body></body>
    </html>
  `;

  it('reads state var from script actor by id', async () => {
    const page = await loadPage(html);
    const replies = [];
    await page.register('t', msg => replies.push(msg));

    await page.send({ id: '1', test: { get: 'x' }, from: 't', to: 'script#main' });

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Integer', re: 100, from: 'script#main', to: 't' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Document DI — document.title()
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser inline script — document DI', () => {
  const html = `
    <html>
    <head>
      <script type="module" src="/src/codegen/browser/brevity.js"></script>
      <title>Page Title</title>
      <script type="text/brevity" id="main">
        ti Text = document.title()
      </script>
    </head>
    <body></body>
    </html>
  `;

  it('reads document.title() via DI', async () => {
    const page = await loadPage(html);
    const replies = [];
    await page.register('t', msg => replies.push(msg));

    await page.send({ id: '1', test: { get: 'ti' }, from: 't', to: 'script#main' });

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Text', re: 'Page Title', from: 'script#main', to: 't' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Element rep — document.first() returns addressable handle
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser inline script — element rep', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" id="main">
    body = document.first(selector: "body")
    content Text = body.inner_html()
    </script>
    </head><body>Hello</body></html>`;

  it('reads innerHTML from element rep via document.first()', async () => {
    const page = await loadPage(html);
    const replies = [];
    await page.register('t', msg => replies.push(msg));

    await page.send({ id: '1', test: { get: 'content' }, from: 't', to: 'script#main' });

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Text', re: 'Hello', from: 'script#main', to: 't' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Element rep — document.body() shorthand
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser inline script — document.body()', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" id="main">
    body = document.body()
    content Text = body.inner_html()
    </script>
    </head><body>Hello</body></html>`;

  it('reads innerHTML from body via document.body()', async () => {
    const page = await loadPage(html);
    const replies = [];
    await page.register('t', msg => replies.push(msg));

    await page.send({ id: '1', test: { get: 'content' }, from: 't', to: 'script#main' });

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Text', re: 'Hello', from: 'script#main', to: 't' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Element rep — document.first() by ID selector
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser inline script — first by ID', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" id="main">
    el = document.first(selector: "#greeting")
    content Text = el.inner_html()
    </script>
    </head><body><div id="greeting">Hi there</div></body></html>`;

  it('reads innerHTML from element found by ID selector', async () => {
    const page = await loadPage(html);
    const replies = [];
    await page.register('t', msg => replies.push(msg));

    await page.send({ id: '1', test: { get: 'content' }, from: 't', to: 'script#main' });

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Text', re: 'Hi there', from: 'script#main', to: 't' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Element mutation — append! with HTML-constructed element variable
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser inline script — append! variable', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity">
    el = <p>Test 1</p>
    body = document.body()
    body.append!(el)
    </script>
    </head><body></body></html>`;

  it('appends HTML element to body via variable', async () => {
    const page = await loadPage(html);
    const bodyHTML = await page.evaluate(() => document.body.innerHTML);
    expect(bodyHTML).toBe('<p>Test 1</p>');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Element mutation — append! with inline HTML literal
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser inline script — append! inline', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity">
    target = document.first(selector: "#target")
    target.append!(<p>Test 2</p>)
    </script>
    </head><body><div id="target"></div></body></html>`;

  it('appends inline HTML literal to element', async () => {
    const page = await loadPage(html);
    const targetHTML = await page.evaluate(() => document.querySelector('#target').innerHTML);
    expect(targetHTML).toBe('<p>Test 2</p>');
  });
});
