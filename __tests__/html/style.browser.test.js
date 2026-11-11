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
