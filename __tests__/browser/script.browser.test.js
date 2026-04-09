import { extract, compile } from '../../index.js';
import { start } from '../../src/codegen/browser/runtime.js';

const tick = () => new Promise(r => setTimeout(r, 0));

async function loadPage(html) {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'http://localhost' });
  const doc = window.document;
  doc.write(html);
  return start(doc, { extract, compile });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Inline <script type="text/brevity"> actor — test.get
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser inline script — test.get', () => {
  const html = `
    <html>
    <head>
      <script type="text/brevity" id="main">
        x *Integer = 100
      </script>
    </head>
    <body></body>
    </html>
  `;

  it('reads state var from script actor by id', async () => {
    const page = await loadPage(html);
    const replies = [];
    page.register('t', msg => replies.push(msg));

    page.send({ id: '1', test: { get: 'x' }, from: 't', to: '#main' });
    await tick();

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Integer', re: 100, from: '#main', to: 't' },
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
    page.register('t', msg => replies.push(msg));

    page.send({ id: '1', test: { get: 'ti' }, from: 't', to: '#main' });
    await tick();

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Text', re: 'Page Title', from: '#main', to: 't' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Element rep — document.first() returns addressable handle
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser inline script — element rep', () => {
  const html = `<html><head>
    <script type="text/brevity" id="main">
    body = document.first(selector: "body")
    content Text = body.innerHTML()
    </script>
    </head><body>Hello</body></html>`;

  it('reads innerHTML from element rep via document.first()', async () => {
    const page = await loadPage(html);
    const replies = [];
    page.register('t', msg => replies.push(msg));

    page.send({ id: '1', test: { get: 'content' }, from: 't', to: '#main' });
    await tick();

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Text', re: 'Hello', from: '#main', to: 't' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Element rep — document.body() shorthand
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser inline script — document.body()', () => {
  const html = `<html><head>
    <script type="text/brevity" id="main">
    body = document.body()
    content Text = body.innerHTML()
    </script>
    </head><body>Hello</body></html>`;

  it('reads innerHTML from body via document.body()', async () => {
    const page = await loadPage(html);
    const replies = [];
    page.register('t', msg => replies.push(msg));

    page.send({ id: '1', test: { get: 'content' }, from: 't', to: '#main' });
    await tick();

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Text', re: 'Hello', from: '#main', to: 't' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Element rep — document.first() by ID selector
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser inline script — first by ID', () => {
  const html = `<html><head>
    <script type="text/brevity" id="main">
    el = document.first(selector: "#greeting")
    content Text = el.innerHTML()
    </script>
    </head><body><div id="greeting">Hi there</div></body></html>`;

  it('reads innerHTML from element found by ID selector', async () => {
    const page = await loadPage(html);
    const replies = [];
    page.register('t', msg => replies.push(msg));

    page.send({ id: '1', test: { get: 'content' }, from: 't', to: '#main' });
    await tick();

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Text', re: 'Hi there', from: '#main', to: 't' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Element mutation — append! with HTML literal variable
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser inline script — append! variable', () => {
  const html = `<html><head>
    <script type="text/brevity" id="main">
    el = <p>Test 1</p>
    body = document.body()
    body.append!(el)
    content Text = body.innerHTML()
    </script>
    </head><body></body></html>`;

  it('appends HTML element to body via variable', async () => {
    const page = await loadPage(html);
    const replies = [];
    page.register('t', msg => replies.push(msg));

    page.send({ id: '1', test: { get: 'content' }, from: 't', to: '#main' });
    await tick();

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Text', re: '<p>Test 1</p>', from: '#main', to: 't' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Element mutation — append! with inline HTML literal
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser inline script — append! inline', () => {
  const html = `<html><head>
    <script type="text/brevity" id="main">
    target = document.first(selector: "#target")
    target.append!(<p>Test 2</p>)
    content Text = target.innerHTML()
    </script>
    </head><body><div id="target"></div></body></html>`;

  it('appends inline HTML literal to element', async () => {
    const page = await loadPage(html);
    const replies = [];
    page.register('t', msg => replies.push(msg));

    page.send({ id: '1', test: { get: 'content' }, from: 't', to: '#main' });
    await tick();

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Text', re: '<p>Test 2</p>', from: '#main', to: 't' },
    ]);
  });
});
