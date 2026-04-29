import { compileActor } from '../helpers.js';
import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';
import { domManifest as HTML_MANIFEST, documentManifest as DOC_MANIFEST } from '../../src/codegen/browser/runtime.js';

// ═══════════════════════════════════════════════════════════════════════════════
// onclick event handler — `onclick={ expr }` on a DOM element
//
// Q1: Does the DOM element wire message include onclick when onclick={} is used?
//     → compileActor / expectEmission (no browser required)
//
// Q2: Does a real DOM click fire the handler, update state, and reflect in DOM?
//     → loadPage + page.evaluate click via Playwright
//
// First pass: click only, no event payload.
// ═══════════════════════════════════════════════════════════════════════════════

async function expectEmission(script, ...steps) {
  const compiled = await compileActor(script, {
    compileOptions: {
      remotes: [{ path: 'HTML', service: HTML_MANIFEST }],
      selfAddr: 'main',
    },
  });
  const actor = await compiled.spawn();
  let postIndex = actor.posts.length;
  for (const step of steps) {
    if (step.input) await actor.sendAsync(step.input);
    else if (step.output) {
      expect(actor.posts[postIndex]).toEqual(step.output);
      postIndex++;
    }
  }
}

// ── Q1: Wire shape ──────────────────────────────────────────────────────────
//
// onclick={ expr } on a DOM element synthesizes a closure @N and emits
// onclick: '#<main @N>' flat in the constructor payload — same position as
// regular attrs, distinguished by key name (on* prefix).

describe('Q1: onclick wire encoding', () => {
  it('onclick on empty element emits onclick closure address', async () => {
    const script = `
      <HTML: (:div)>
      =
      count Integer! = 0
      @create = -> <div onclick={ count <- count + 1 }></div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: [], onclick: '#<main @0>' }, '#new'],
        to: 'HTML @div',
      }) },
    );
  });

  it('onclick with static text child', async () => {
    const script = `
      <HTML: (:div)>
      =
      count Integer! = 0
      @create = -> <div onclick={ count <- count + 1 }>click me</div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: ['click me'], onclick: '#<main @0>' }, '#new'],
        to: 'HTML @div',
      }) },
    );
  });

  it('onclick with reactive child — child gets @0, onclick gets @1', async () => {
    const script = `
      <HTML: (:div)>
      =
      count Integer! = 0
      @create = -> <div onclick={ count <- count + 1 }>{ count }</div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: ['#<main @0>'], onclick: '#<main @1>' }, '#new'],
        to: 'HTML @div',
      }) },
    );
  });

  it('element without onclick has no onclick field', async () => {
    const script = `
      <HTML: (:div)>
      =
      @create = -> <div>hello</div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: ['hello'] }, '#new'],
        to: 'HTML @div',
      }) },
    );
  });

  it('onclick alongside a literal attr', async () => {
    const script = `
      <HTML: (:div)>
      =
      count Integer! = 0
      @create = -> <div class="counter" onclick={ count <- count + 1 }></div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: [], class: 'counter', onclick: '#<main @0>' }, '#new'],
        to: 'HTML @div',
      }) },
    );
  });
});

// ── Q2: Real DOM click fires the handler ────────────────────────────────────

describe('Q2: click in real DOM', () => {
  const factorySource = `
    <:document, HTML: (:div)>
    =
    count Integer! = 0
    el = <div onclick={ count <- count + 1 }>{ count }</div>
    body = document.body()
    body.append!(el)
  `;

  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" src="/factory.bv"></script>
    </head><body></body></html>`;

  async function clickAndSettle(page, selector) {
    await page.evaluate(async (sel) => {
      document.querySelector(sel).click();
      await new Promise(r => setTimeout(r, 0));
      await new Promise(r => setTimeout(r, 0));
    }, selector);
  }

  it('element shows initial count of 0', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': factorySource } });
    const text = await page.evaluate(() => document.querySelector('div').textContent);
    expect(text).toBe('0');
  });

  it('clicking div fires handler and updates count to 1', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': factorySource } });
    await clickAndSettle(page, 'div');
    const text = await page.evaluate(() => document.querySelector('div').textContent);
    expect(text).toBe('1');
  });

  it('clicking three times increments count to 3', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': factorySource } });
    await clickAndSettle(page, 'div');
    await clickAndSettle(page, 'div');
    await clickAndSettle(page, 'div');
    const text = await page.evaluate(() => document.querySelector('div').textContent);
    expect(text).toBe('3');
  });
});

// ── Q3: External set on host ref cell updates DOM ───────────────────────────
//
// `@count Integer! = 0` declares a public ref cell. An outside actor sends
// `{ op: [[v], '#set'], to: '#<fileaddr @count>' }` — no click, no internal
// handler — and the reactive template closure re-evaluates.

describe('Q3: external set on host ref cell', () => {
  const constructorSource = `
    <:document, HTML: (:div)>
    =
    @count Integer! = 0
    el = <div>{ @count }</div>
    body = document.body()
    body.append!(el)
  `;

  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" src="/factory.bv"></script>
    </head><body></body></html>`;

  it('element shows initial count of 0', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': constructorSource } });
    const text = await page.evaluate(() => document.querySelector('div').textContent);
    expect(text).toBe('0');
  });

  it('external set on @count updates DOM to 1', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': constructorSource } });
    await page.send({ id: '1', op: [[1], '#set'], to: '#<factory.bv @count>', from: 'test', 'bv-a': [['Integer']] });
    const text = await page.evaluate(() => document.querySelector('div').textContent);
    expect(text).toBe('1');
  });

  it('external set on @count updates DOM to 5', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': constructorSource } });
    await page.send({ id: '1', op: [[5], '#set'], to: '#<factory.bv @count>', from: 'test', 'bv-a': [['Integer']] });
    const text = await page.evaluate(() => document.querySelector('div').textContent);
    expect(text).toBe('5');
  });
});
