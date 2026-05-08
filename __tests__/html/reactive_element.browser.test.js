import { compileActor } from '../helpers.js';
import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';
import { domManifest as HTML_MANIFEST } from '../../src/codegen/browser/runtime.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Reactive singleton DOM elements — `@decl` in element attr blocks
//
// Q1: Wire shape — actor emits DomConstructor with reactive attr closure refs
//     → compileActor / expectEmission (no browser required)
//
// Q2: Browser — reactive attr reflects initial state
//
// Q3: Browser — external set on lifted ref cell updates reactive attr in DOM
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

// ── Q1: Wire encoding ────────────────────────────────────────────────────────
//
// @name *Type = value inside element attrs is lifted to the parent actor.
// Reactive attrs (functions reading a lifted ref) become closure_ref entries
// in the DomConstructor payload, addressed as '#<main @N>'.

describe('Q1: reactive element wire encoding', () => {
  it('reactive attr sends closure ref', async () => {
    const script = `
      *(HTML: (:div))
      =
      @create = -> <div @color *Text = "black" style={ 'color: ' + @color }>click me</div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: ['click me'], style: '#<main @0>' }, '#new'],
        to: 'HTML @div',
      }) },
    );
  });

  it('static text attr alongside reactive attr', async () => {
    const script = `
      *(HTML: (:div))
      =
      @create = -> <div class="btn" @color *Text = "black" style={ 'color: ' + @color }>click me</div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: ['click me'], class: 'btn', style: '#<main @0>' }, '#new'],
        to: 'HTML @div',
      }) },
    );
  });

  it('no reactive attrs — element without @decl is a plain DomConstructor', async () => {
    const script = `
      *(HTML: (:div))
      =
      @create = -> <div class="plain">hello</div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: ['hello'], class: 'plain' }, '#new'],
        to: 'HTML @div',
      }) },
    );
  });

  it('element with only @decl — no static attrs', async () => {
    const script = `
      *(HTML: (:div))
      =
      @create = -> <div @color *Text = "red" style={ 'color: ' + @color }></div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: [], style: '#<main @0>' }, '#new'],
        to: 'HTML @div',
      }) },
    );
  });

  it('@decl creates a public ref on the parent actor', async () => {
    const script = `
      *(HTML: (:div))
      =
      @create = -> <div @color *Text = "black" style={ 'color: ' + @color }>text</div>
    `;
    const compiled = await compileActor(script, {
      compileOptions: {
        remotes: [{ path: 'HTML', service: HTML_MANIFEST }],
        selfAddr: 'main',
      },
    });
    const actor = await compiled.spawn();
    // Sending @color to the actor returns the current value
    await actor.sendAsync({ id: '2', op: '@color', from: 'c' });
    expect(actor.posts[actor.posts.length - 1]).toEqual(
      expect.objectContaining({ re: ['black'] }),
    );
  });
});

// ── Q2: Browser — reactive attr reflects initial state ───────────────────────

describe('Q2: reactive element renders initial state', () => {
  const factorySource = `
    *(:document, HTML: (:div))
    =
    el = <div @color *Text = "black" style={ 'color: ' + @color }>I change color!</div>
    body = document.body()
    body.append!(el)
  `;

  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" src="/factory.bv"></script>
    </head><body></body></html>`;

  it('renders div with initial style', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': factorySource } });
    const style = await page.evaluate(() => document.querySelector('div').getAttribute('style'));
    expect(style).toBe('color: black');
  });

  it('renders div text content', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': factorySource } });
    const text = await page.evaluate(() => document.querySelector('div').textContent);
    expect(text).toBe('I change color!');
  });
});

// ── Q3: External set on lifted ref cell updates reactive attr ────────────────
//
// @color *Text = "black" inside the element attr block is hoisted to the
// parent file actor as a public ref. An outside actor can set it via
// { op: [[v], '#set'], to: '#<factory.bv @color>' } and the reactive style
// attr re-evaluates.

describe('Q3: external set on lifted ref cell', () => {
  const factorySource = `
    *(:document, HTML: (:div))
    =
    el = <div @color *Text = "black" style={ 'color: ' + @color }>I change color!</div>
    body = document.body()
    body.append!(el)
  `;

  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" src="/factory.bv"></script>
    </head><body></body></html>`;

  it('initial style is color: black', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': factorySource } });
    const style = await page.evaluate(() => document.querySelector('div').getAttribute('style'));
    expect(style).toBe('color: black');
  });

  it('external set on @color updates style to red', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': factorySource } });
    await page.send({ id: '1', op: [['red'], '#set'], to: '#<factory.bv @color>', from: 'test', 'bv-a': [['Text']] });
    const style = await page.evaluate(() => document.querySelector('div').getAttribute('style'));
    expect(style).toBe('color: red');
  });

  it('external set on @color updates style to blue', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': factorySource } });
    await page.send({ id: '1', op: [['blue'], '#set'], to: '#<factory.bv @color>', from: 'test', 'bv-a': [['Text']] });
    const style = await page.evaluate(() => document.querySelector('div').getAttribute('style'));
    expect(style).toBe('color: blue');
  });
});
