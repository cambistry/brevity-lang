import { compileSource } from '../helpers.js';
import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';
import { domManifest as HTML_MANIFEST } from '../../src/codegen/browser/runtime.js';

// ═══════════════════════════════════════════════════════════════════════════════
// <style> in a Brevity template
//
// `style` is a TextElement: its content is CSS text. A lone `{` / `}` in
// element content is literal, so CSS needs no escaping; `{{ }}` is still the
// reactive hole. An element child is a compile error.
// ═══════════════════════════════════════════════════════════════════════════════

const compileWithHTML = (src) =>
  compileSource(src, { remotes: [{ path: 'HTML', service: HTML_MANIFEST }] });

describe('<style> compile', () => {
  it('CSS reaches the style element as one text child, unchanged', () => {
    const { output } = compileWithHTML(`
      *
        HTML: (:style)
      *
      @t = -> <style>/* c */ h2 { margin: 0; } @media (min-width: 1px) { .a::before { content: "}"; } } p:hover{color:#f00}</style>
    `);
    expect(output).toContain(
      `{children: ["/* c */ h2 { margin: 0; } @media (min-width: 1px) { .a::before { content: \\"}\\"; } } p:hover{color:#f00}"]}, "#new"], "HTML @style")`,
    );
  });

  it('the media attribute compiles', () => {
    expect(() => compileWithHTML(`
      *
        HTML: (:style)
      *
      @t = -> <style media="print">p { color: red; }</style>
    `)).not.toThrow();
  });

  it('an element child of <style> is rejected', () => {
    expect(() => compileWithHTML(`
      *
        HTML: (:style, :p)
      *
      @t = -> <style><p>x</p></style>
    `)).toThrow(/<style> takes text only — <p> can't be its child/);
  });

  it('an element child of <textarea> is rejected', () => {
    expect(() => compileWithHTML(`
      *
        HTML: (:textarea, :p)
      *
      @t = -> <textarea>a<p>x</p></textarea>
    `)).toThrow(/<textarea> takes text only — <p> can't be its child/);
  });
});

describe('<style> runtime — a sheet appended to body applies', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" src="/builder.bv"></script>
    </head><body></body></html>`;

  const builderSource = `*
  :document
  HTML: (:style, :p)
*
@build. = {
  body = document.body()
  body.append!(<style>p.note { color: rgb(1, 2, 3); } /* } */ p.note::after { content: "}"; }</style>)
  body.append!(<style media="print">p.note { font-size: 40px; }</style>)
  body.append!(<p class="note">x</p>)
}
`;

  it('the CSS text lands unchanged, its rule applies, and a print sheet does not', async () => {
    const page = await loadPage(html, { sources: { '/builder.bv': builderSource } });
    const actor = await page.connectActor('builder.bv');
    await actor.sendAsync({ id: '1', op: '@build.' });
    const seen = await page.evaluate(() => {
      const [screen, print] = document.querySelectorAll('style');
      const p = document.querySelector('p.note');
      return {
        text: screen.textContent,
        media: print.getAttribute('media'),
        color: getComputedStyle(p).color,
        after: getComputedStyle(p, '::after').content,
        fontSize: getComputedStyle(p).fontSize,
      };
    });
    expect(seen).toEqual({
      text: 'p.note { color: rgb(1, 2, 3); } /* } */ p.note::after { content: "}"; }',
      media: 'print',
      color: 'rgb(1, 2, 3)',
      after: '"}"',
      fontSize: '16px',
    });
  });

  it('media() reads the attribute back', async () => {
    const page = await loadPage(html, { sources: { '/builder.bv': builderSource } });
    const actor = await page.connectActor('builder.bv');
    await actor.sendAsync({ id: '1', op: '@build.' });
    const sheet = await page.connectActor('HTML @style/2');
    await sheet.sendAsync({ id: '2', op: '@media' });
    expect(sheet.posts[0]).toEqual(expect.objectContaining({ id: '2', re: 'print' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// <style> as a child of an element, scoped with native `@scope`
//
// An `@scope { … }` with no prelude scopes to the <style>'s parent, and
// `:scope` is that parent. The <style> stays inline at its position; the
// browser does the targeting.
// ═══════════════════════════════════════════════════════════════════════════════

describe('<style> runtime — an inline @scope sheet styles only its parent subtree', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" src="/builder.bv"></script>
    </head><body></body></html>`;

  const builderSource = `*
  :document
  HTML: (:div, :style, :p)
*
@build. = {
  body = document.body()
  body.append!(<div id="a"><style>@scope { :scope { border-top: 3px solid; } p { color: rgb(1, 2, 3); } }</style><p>a</p></div>)
  body.append!(<div id="b"><style>@scope { p { color: rgb(4, 5, 6); } }</style><p>b</p></div>)
  body.append!(<p id="out">outside</p>)
}
`;

  const look = (page) => page.evaluate(() => {
    const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
    return {
      styleParents: [...document.querySelectorAll('style')].map(s => s.parentElement.id),
      aBorder: css('#a', 'borderTopWidth'),
      bBorder: css('#b', 'borderTopWidth'),
      aP: css('#a p', 'color'),
      bP: css('#b p', 'color'),
      outP: css('#out', 'color'),
    };
  });

  it('each sheet stays in its element and styles only that subtree; :scope is the parent', async () => {
    const page = await loadPage(html, { sources: { '/builder.bv': builderSource } });
    const actor = await page.connectActor('builder.bv');
    await actor.sendAsync({ id: '1', op: '@build.' });
    expect(await look(page)).toEqual({
      styleParents: ['a', 'b'],
      aBorder: '3px',
      bBorder: '0px',
      aP: 'rgb(1, 2, 3)',
      bP: 'rgb(4, 5, 6)',
      outP: 'rgb(0, 0, 0)',
    });
  });

  // #a moves inside #b, so both sheets' `p` rules match #a's <p>: the nearer
  // scope root wins (scope proximity), so it keeps #a's colour.
  it('the scope follows the element when it moves', async () => {
    const page = await loadPage(html, { sources: { '/builder.bv': builderSource } });
    const actor = await page.connectActor('builder.bv');
    await actor.sendAsync({ id: '1', op: '@build.' });
    await page.evaluate(() => {
      document.querySelector('#b').append(document.querySelector('#a'));
      document.querySelector('#a').append(document.querySelector('#out'));
    });
    expect(await look(page)).toEqual({
      styleParents: ['b', 'a'],
      aBorder: '3px',
      bBorder: '0px',
      aP: 'rgb(1, 2, 3)',
      bP: 'rgb(4, 5, 6)',
      outP: 'rgb(1, 2, 3)',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Reactive @scope sheets — `{{ }}` holes inside the CSS text
//
// Each hole is a closure child of the <style>; the runtime subscribes to it
// and rewrites that run of the sheet's text when the cell changes.
// ═══════════════════════════════════════════════════════════════════════════════

describe('<style> runtime — {{ }} holes in a scoped sheet restyle the parent', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" src="/sheet.bv"></script>
    </head><body></body></html>`;

  const sheetSource = `*
  :document
  HTML: (:div, :style)
*
@color *Text = "rgb(0, 0, 0)"
@size *Text = "20px"

@paint! = (c Text) { @color <- c }

el = <div id="t"><style>@scope { :scope { color: {{ @color }}; font-size: {{ @size }}; } }</style>scoped</div>
body = document.body()
body.append!(el)
body.append!(<div id="u">unscoped</div>)
`;

  const look = (page) => page.evaluate(() => {
    const t = getComputedStyle(document.querySelector('#t'));
    const u = getComputedStyle(document.querySelector('#u'));
    return {
      text: document.querySelector('style').textContent,
      color: t.color,
      size: t.fontSize,
      outside: [u.color, u.fontSize],
    };
  });

  it('the first values render into the sheet', async () => {
    const page = await loadPage(html, { sources: { '/sheet.bv': sheetSource } });
    expect(await look(page)).toEqual({
      text: '@scope { :scope { color: rgb(0, 0, 0); font-size: 20px; } }',
      color: 'rgb(0, 0, 0)',
      size: '20px',
      outside: ['rgb(0, 0, 0)', '16px'],
    });
  });

  it('a set from inside the actor rewrites its hole and restyles the parent', async () => {
    const page = await loadPage(html, { sources: { '/sheet.bv': sheetSource } });
    const actor = await page.connectActor('sheet.bv');
    await actor.sendAsync({ id: '1', op: [['rgb(1, 2, 3)'], '@paint!'], ty: [['Text']] });
    expect(await look(page)).toEqual({
      text: '@scope { :scope { color: rgb(1, 2, 3); font-size: 20px; } }',
      color: 'rgb(1, 2, 3)',
      size: '20px',
      outside: ['rgb(0, 0, 0)', '16px'],
    });
  });

  it('an outside #set on each cell updates its own hole', async () => {
    const page = await loadPage(html, { sources: { '/sheet.bv': sheetSource } });
    await page.send({ id: '1', op: [['rgb(4, 5, 6)'], '#set'], to: '#<sheet.bv @color>', from: 'test', ty: [['Text']] });
    await page.send({ id: '2', op: [['30px'], '#set'], to: '#<sheet.bv @size>', from: 'test', ty: [['Text']] });
    expect(await look(page)).toEqual({
      text: '@scope { :scope { color: rgb(4, 5, 6); font-size: 30px; } }',
      color: 'rgb(4, 5, 6)',
      size: '30px',
      outside: ['rgb(0, 0, 0)', '16px'],
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Bare declarations directly inside @scope
//
// Standard CSS (nested declarations): `@scope { color: … }` applies to the
// scope root as if written `:where(:scope) { … }` — zero specificity, so any
// page rule naming the element wins. `:scope { … }` carries pseudo-class
// specificity: it beats a plain type rule (`div`), not a class + type
// rule (`div.x`).
// ═══════════════════════════════════════════════════════════════════════════════

describe('<style> runtime — bare declarations inside @scope', () => {
  const html = `<html><head>
    <style>div { color: rgb(9, 9, 9); }</style>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" src="/bare.bv"></script>
    </head><body></body></html>`;

  const bareSource = `*
  :document
  HTML: (:div, :p, :style)
*
@color *Text = "rgb(1, 2, 3)"

body = document.body()
body.append!(<p id="bare"><style>@scope { color: {{ @color }}; }</style>x</p>)
body.append!(<div id="bare-ranked"><style>@scope { color: rgb(1, 2, 3); }</style>x</div>)
body.append!(<div id="scope-ranked"><style>@scope { :scope { color: rgb(1, 2, 3); } }</style>x</div>)
`;

  const colors = (page) => page.evaluate(() =>
    ['bare', 'bare-ranked', 'scope-ranked'].map(id => getComputedStyle(document.getElementById(id)).color));

  it('apply to the parent, but lose to a page `div` rule that :scope { } beats', async () => {
    const page = await loadPage(html, { sources: { '/bare.bv': bareSource } });
    expect(await colors(page)).toEqual(['rgb(1, 2, 3)', 'rgb(9, 9, 9)', 'rgb(1, 2, 3)']);
  });

  it('a {{ }} hole in a bare declaration updates on an outside #set', async () => {
    const page = await loadPage(html, { sources: { '/bare.bv': bareSource } });
    await page.send({ id: '1', op: [['rgb(4, 5, 6)'], '#set'], to: '#<bare.bv @color>', from: 'test', ty: [['Text']] });
    expect(await colors(page)).toEqual(['rgb(4, 5, 6)', 'rgb(9, 9, 9)', 'rgb(1, 2, 3)']);
  });
});
