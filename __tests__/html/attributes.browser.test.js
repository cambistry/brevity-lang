import { compileActor } from '../helpers.js';
import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';
import { domManifest as HTML_MANIFEST } from '../../src/codegen/browser/runtime.js';

// ═══════════════════════════════════════════════════════════════════════════════
// HTML element attributes — `attr="value"` and `attr={ expr }` syntax
//
// Four questions, in order of directness:
//
//   Q1: Does a real DOM element get the right literal attribute in the browser?
//       → loadPage + page.evaluate() via Playwright.
//
//   Q2: Does the CAM message encode non-reactive attrs as bare values in the
//       wire `attrs` field? → compileActor / expectEmission.
//
//   Q3: Does the CAM message encode reactive attrs as closure addresses?
//       → compileActor / expectEmission.
//
//   Q4: Does subscribing to a reactive attr closure return the current value,
//       and does a dep change replay the subscription?
//       → compileActor / expectEmission, no real DOM required.
//
// Plus an end-to-end integration test: create → initial attribute → bump →
// updated attribute, observed in the real DOM via Playwright.
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

// ── Q1: Real DOM — literal attr visible via Playwright ──────────────────────

describe('Q1: literal attr on real DOM element', () => {
  it('class="card" is set on the element in the browser', async () => {
    const html = `<html><head>
      <script type="module" src="/src/codegen/browser/brevity.js"></script>
      <script type="text/brevity">
      body = document.body()
      body.append!(<div class="card">hello</div>)
      </script>
      </head><body></body></html>`;
    const page = await loadPage(html);
    const cls = await page.evaluate(() => document.querySelector('div').getAttribute('class'));
    expect(cls).toBe('card');
  });

  it('multiple literal attrs are all set on the element', async () => {
    const html = `<html><head>
      <script type="module" src="/src/codegen/browser/brevity.js"></script>
      <script type="text/brevity">
      body = document.body()
      body.append!(<div id="root" class="card"></div>)
      </script>
      </head><body></body></html>`;
    const page = await loadPage(html);
    const id = await page.evaluate(() => document.querySelector('div').getAttribute('id'));
    const cls = await page.evaluate(() => document.querySelector('div').getAttribute('class'));
    expect(id).toBe('root');
    expect(cls).toBe('card');
  });
});

// ── Q2: Wire shape — non-reactive attrs as bare values ─────────────────────

describe('Q2: non-reactive attr wire encoding', () => {
  it('literal string attr="value" encodes in wire attrs as bare string', async () => {
    const script = `
      <HTML: (:div)>
      @create = -> <div class="basic"></div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: [], class: 'basic' }, 'new'],
        to: 'HTML @div',
      }) },
    );
  });

  it('multiple literal attrs encode as a flat attrs object', async () => {
    const script = `
      <HTML: (:div)>
      @create = -> <div id="main" class="card"></div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: [], id: 'main', class: 'card' }, 'new'],
        to: 'HTML @div',
      }) },
    );
  });

  it('literal attr with static children', async () => {
    const script = `
      <HTML: (:div)>
      @create = -> <div class="static">hello</div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: ['hello'], class: 'static' }, 'new'],
        to: 'HTML @div',
      }) },
    );
  });

  it('element without attrs omits the attrs field', async () => {
    const script = `
      <HTML: (:div)>
      @create = -> <div>hello</div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: ['hello'] }, 'new'],
        to: 'HTML @div',
      }) },
    );
  });
});

// ── Q3: Wire shape — reactive attrs as closure addresses ────────────────────

describe('Q3: reactive attr wire encoding as closure address', () => {
  it('reactive Text ref encodes as #<main @0> in attrs', async () => {
    const script = `
      <HTML: (:div)>
      cls Text! = "active"
      @create = -> <div class={ cls }></div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: [], class: '#<main @0>' }, 'new'],
        to: 'HTML @div',
      }) },
    );
  });

  it('mixed literal and reactive attrs: literal inline, reactive as address', async () => {
    const script = `
      <HTML: (:div)>
      cls Text! = "active"
      @create = -> <div id="root" class={ cls }></div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: [], id: 'root', class: '#<main @0>' }, 'new'],
        to: 'HTML @div',
      }) },
    );
  });

  // Children interps are synthesized before attr interps, so a reactive child
  // gets @0 and a reactive attr gets @1.
  it('reactive child (@0) and reactive attr (@1) get distinct addresses', async () => {
    const script = `
      <HTML: (:div)>
      label Text! = "hello"
      cls Text! = "active"
      @create = -> <div class={ cls }>{ label }</div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: ['#<main @0>'], class: '#<main @1>' }, 'new'],
        to: 'HTML @div',
      }) },
    );
  });
});

// ── Q4: Reactive attr subscription protocol ────────────────────────────────
//
// Once @create emits the closure address in attrs, the address is independently
// subscribable. A dep change replays the subscription with the same id.

describe('Q4: reactive attr closure subscription', () => {
  it('subscribe to reactive attr closure returns current value', async () => {
    const script = `
      <HTML: (:div)>
      cls Text! = "active"
      @create = -> <div class={ cls }></div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: [], class: '#<main @0>' }, 'new'],
        to: 'HTML @div',
      }) },
      { input: { id: 'sub1', op: 'subscribe', to: '@0', from: 'c' } },
      { output: expect.objectContaining({ id: 'sub1', re: ['active'] }) },
    );
  });

  it('dep change replays subscription with new value', async () => {
    const script = `
      <HTML: (:div)>
      cls Text! = "active"
      @bump = |:v Text| { cls <- v . }
      @create = -> <div class={ cls }></div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: [], class: '#<main @0>' }, 'new'],
        to: 'HTML @div',
      }) },
      { input: { id: 'sub1', op: 'subscribe', to: '@0', from: 'c' } },
      { output: expect.objectContaining({ id: 'sub1', re: ['active'] }) },
      { input: { id: 'b1', op: [{ v: 'highlighted' }, '@bump'], 'bv-a': [{ v: 'Text' }], from: 'c' } },
      { output: expect.objectContaining({ id: 'sub1', re: ['highlighted'] }) },
    );
  });

  it('multiple dep changes each replay the subscription', async () => {
    const script = `
      <HTML: (:div)>
      cls Text! = "a"
      @bump = |:v Text| { cls <- v . }
      @create = -> <div class={ cls }></div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: [], class: '#<main @0>' }, 'new'],
        to: 'HTML @div',
      }) },
      { input: { id: 'sub1', op: 'subscribe', to: '@0', from: 'c' } },
      { output: expect.objectContaining({ id: 'sub1', re: ['a'] }) },
      { input: { id: 'b1', op: [{ v: 'b' }, '@bump'], 'bv-a': [{ v: 'Text' }], from: 'c' } },
      { output: expect.objectContaining({ id: 'sub1', re: ['b'] }) },
      { input: { id: 'b2', op: [{ v: 'c' }, '@bump'], 'bv-a': [{ v: 'Text' }], from: 'c' } },
      { output: expect.objectContaining({ id: 'sub1', re: ['c'] }) },
    );
  });
});

// ── Integration: full reactive loop through real DOM ───────────────────────
//
// A Brevity script creates an element with a reactive class attr and appends
// it to body. The initial value is applied synchronously before @create
// resolves. @bump changes the ref; the subscription replays; the DOM updates.

describe('integration: reactive attr in real DOM', () => {
  const factorySource = `
    < "document": (document) >
    <HTML: (:div)>
    cls Text! = "initial"
    el = <div class={ cls }>content</div>
    body = document.body()
    body.append!(el)
    @bump = |:v Text| { cls <- v . }
  `;

  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" id="main" src="/factory.bv"></script>
    </head><body></body></html>`;

  it('element has initial class attribute after create', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': factorySource } });
    const cls = await page.evaluate(() => document.querySelector('div').getAttribute('class'));
    expect(cls).toBe('initial');
  });

  it('@bump updates class attribute in real DOM', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': factorySource } });
    const factory = await page.connectActor('factory.bv');

    await factory.sendAsync({
      id: 'b1',
      op: [{ v: 'updated' }, '@bump'],
      'bv-a': [{ v: 'Text' }],
      from: 'caller',
    });

    const cls = await page.evaluate(() => document.querySelector('div').getAttribute('class'));
    expect(cls).toBe('updated');
  });
});
