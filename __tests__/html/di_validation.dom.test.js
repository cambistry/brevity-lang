import { extract, compile } from '../../index.js';
import { domDocument as HTML_MANIFEST } from '../../src/codegen/browser/runtime.js';

// ═══════════════════════════════════════════════════════════════════════════════
// HTML DI validation — template tag must appear in the destructure list.
//
// `<div>…</div>` et al. compile to `new HTML @div`. When the DI destructure
// `<HTML: (:div, :p)>` names specific element classes, using a tag not
// in the list is a compile error — the wire never attempts routing against
// a class the actor didn't import. Aligns with the pivot's principle
// that DI is authoritative for template resolution.
//
// Runs against the shared validator (src/validate.js) via extract + compile
// — target-agnostic, so no browser harness needed.
// ═══════════════════════════════════════════════════════════════════════════════


function compileWithHTML(source) {
  const { ast } = extract(source);
  return compile(ast, { remotes: [{ path: 'HTML', service: HTML_MANIFEST }] });
}

describe('HTML DI validation — tag must be in destructure list', () => {
  it('tag present in destructure list → compiles cleanly', () => {
    const source = `
      use :div = HTML
      @create = -> <div>hello</div>
    `;
    expect(() => compileWithHTML(source)).not.toThrow();
  });

  it('multiple tags all present → compiles cleanly', () => {
    const source = `
      use :div, :h1, :p = HTML
      @create = -> <div><h1>Title</h1><p>body</p></div>
    `;
    expect(() => compileWithHTML(source)).not.toThrow();
  });

  it('tag missing from destructure list → compile error names the tag', () => {
    const source = `
      use :div = HTML
      @create = -> <h1>Title</h1>
    `;
    expect(() => compileWithHTML(source)).toThrow(/<h1>.*:h1.*HTML/);
  });

  it('nested tag missing from destructure list → compile error', () => {
    const source = `
      use :div = HTML
      @create = -> <div><p>nested</p></div>
    `;
    expect(() => compileWithHTML(source)).toThrow(/<p>.*:p.*HTML/);
  });

  it('deeply nested tag missing → compile error catches it', () => {
    const source = `
      use :div, :p = HTML
      @create = -> <div><p><span>inner</span></p></div>
    `;
    expect(() => compileWithHTML(source)).toThrow(/<span>.*:span.*HTML/);
  });

  it('bare HTML import (no destructures) → validation is skipped', () => {
    // Legacy flows that rely on runtime HTML dispatch without explicit
    // destructures continue to compile; the check only fires when a
    // destructure list is present.
    const source = `
      use HTML
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

describe('HTML DI validation — destructured tag must be in the manifest', () => {
  it('a tag the manifest declares → compiles cleanly', () => {
    const source = `
      use :div, :style = HTML
      @create = -> <div><style>p { color: red; }</style></div>
    `;
    expect(() => compileWithHTML(source)).not.toThrow();
  });

  it('a misspelled tag → compile error, even when the template matches it', () => {
    const source = `
      use :div, :sytle = HTML
      @create = -> <div><sytle>p { color: red; }</sytle></div>
    `;
    expect(() => compileWithHTML(source)).toThrow(/'sytle' is not exported by 'HTML'/);
  });
});
