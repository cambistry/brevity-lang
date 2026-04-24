import { extract, compile } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// DOM DI validation — template tag must appear in the destructure list.
//
// `<div>…</div>` et al. compile to `new DOM @div`. When the DI destructure
// `<DOM: (:div, :p)>` names specific element constructors, using a tag not
// in the list is a compile error — the wire never attempts routing against
// a constructor the actor didn't import. Aligns with the pivot's principle
// that DI is authoritative for template resolution.
//
// Runs against the shared validator (src/validate.js) via extract + compile
// — target-agnostic, so no browser harness needed.
// ═══════════════════════════════════════════════════════════════════════════════

const DOM_MANIFEST = `{
  div: (:inner_html Text) -> (HTMLElement)
  p: (:inner_html Text) -> (HTMLElement)
  h1: (:inner_html Text) -> (HTMLElement)
  span: (:inner_html Text) -> (HTMLElement)
}`;

function compileWithDOM(source) {
  const { ast } = extract(source);
  return compile(ast, { remotes: [{ path: 'DOM', service: DOM_MANIFEST }] });
}

describe('DOM DI validation — tag must be in destructure list', () => {
  it('tag present in destructure list → compiles cleanly', () => {
    const source = `
      <DOM: (:div)>
      @create = -> <div>hello</div>
    `;
    expect(() => compileWithDOM(source)).not.toThrow();
  });

  it('multiple tags all present → compiles cleanly', () => {
    const source = `
      <DOM: (:div, :h1, :p)>
      @create = -> <div><h1>Title</h1><p>body</p></div>
    `;
    expect(() => compileWithDOM(source)).not.toThrow();
  });

  it('tag missing from destructure list → compile error names the tag', () => {
    const source = `
      <DOM: (:div)>
      @create = -> <h1>Title</h1>
    `;
    expect(() => compileWithDOM(source)).toThrow(/<h1>.*:h1.*DOM/);
  });

  it('nested tag missing from destructure list → compile error', () => {
    const source = `
      <DOM: (:div)>
      @create = -> <div><p>nested</p></div>
    `;
    expect(() => compileWithDOM(source)).toThrow(/<p>.*:p.*DOM/);
  });

  it('deeply nested tag missing → compile error catches it', () => {
    const source = `
      <DOM: (:div, :p)>
      @create = -> <div><p><span>inner</span></p></div>
    `;
    expect(() => compileWithDOM(source)).toThrow(/<span>.*:span.*DOM/);
  });

  it('bare DOM import (no destructures) → validation is skipped', () => {
    // Legacy flows that rely on runtime DOM dispatch without explicit
    // destructures continue to compile; the check only fires when a
    // destructure list is present.
    const source = `
      <DOM>
      @create = -> <div>legacy</div>
    `;
    expect(() => compileWithDOM(source)).not.toThrow();
  });

  it('no DOM import at all → validation is skipped', () => {
    // Inline scripts may use `<tag>` markup without an explicit DOM import;
    // the browser runtime dispatches DOM @tag regardless. Validation applies
    // only when DOM is imported with a destructure list.
    const source = `
      el = <div>hello</div>
    `;
    expect(() => compile(extract(source).ast, {})).not.toThrow();
  });
});
