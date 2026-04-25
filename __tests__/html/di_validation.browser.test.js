import { extract, compile } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// HTML DI validation — template tag must appear in the destructure list.
//
// `<div>…</div>` et al. compile to `new HTML @div`. When the DI destructure
// `<HTML: (:div, :p)>` names specific element constructors, using a tag not
// in the list is a compile error — the wire never attempts routing against
// a constructor the actor didn't import. Aligns with the pivot's principle
// that DI is authoritative for template resolution.
//
// Runs against the shared validator (src/validate.js) via extract + compile
// — target-agnostic, so no browser harness needed.
// ═══════════════════════════════════════════════════════════════════════════════

const HTML_MANIFEST = `{
  div: (:inner_html Text) -> (HTMLElement)
  p: (:inner_html Text) -> (HTMLElement)
  h1: (:inner_html Text) -> (HTMLElement)
  span: (:inner_html Text) -> (HTMLElement)
}`;

function compileWithHTML(source) {
  const { ast } = extract(source);
  return compile(ast, { remotes: [{ path: 'HTML', service: HTML_MANIFEST }] });
}

describe('HTML DI validation — tag must be in destructure list', () => {
  it('tag present in destructure list → compiles cleanly', () => {
    const source = `
      <HTML: (:div)>
      @create = -> <div>hello</div>
    `;
    expect(() => compileWithHTML(source)).not.toThrow();
  });

  it('multiple tags all present → compiles cleanly', () => {
    const source = `
      <HTML: (:div, :h1, :p)>
      @create = -> <div><h1>Title</h1><p>body</p></div>
    `;
    expect(() => compileWithHTML(source)).not.toThrow();
  });

  it('tag missing from destructure list → compile error names the tag', () => {
    const source = `
      <HTML: (:div)>
      @create = -> <h1>Title</h1>
    `;
    expect(() => compileWithHTML(source)).toThrow(/<h1>.*:h1.*HTML/);
  });

  it('nested tag missing from destructure list → compile error', () => {
    const source = `
      <HTML: (:div)>
      @create = -> <div><p>nested</p></div>
    `;
    expect(() => compileWithHTML(source)).toThrow(/<p>.*:p.*HTML/);
  });

  it('deeply nested tag missing → compile error catches it', () => {
    const source = `
      <HTML: (:div, :p)>
      @create = -> <div><p><span>inner</span></p></div>
    `;
    expect(() => compileWithHTML(source)).toThrow(/<span>.*:span.*HTML/);
  });

  it('bare HTML import (no destructures) → validation is skipped', () => {
    // Legacy flows that rely on runtime HTML dispatch without explicit
    // destructures continue to compile; the check only fires when a
    // destructure list is present.
    const source = `
      <HTML>
      @create = -> <div>legacy</div>
    `;
    expect(() => compileWithHTML(source)).not.toThrow();
  });

  it('no HTML import at all → validation is skipped', () => {
    // Inline scripts may use `<tag>` markup without an explicit HTML import;
    // the browser runtime dispatches HTML @tag regardless. Validation applies
    // only when HTML is imported with a destructure list.
    const source = `
      el = <div>hello</div>
    `;
    expect(() => compile(extract(source).ast, {})).not.toThrow();
  });
});
