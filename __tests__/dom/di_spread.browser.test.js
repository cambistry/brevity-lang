import { extract, compile } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// DI spread operator — `<DOM: (...)>`
//
// `...` flattens the module's full public interface into local scope, consuming
// the module's own name. Explicit entries before `...` let you alias or discard
// specific names; `...` then supplies "everything else" from the remote manifest.
//
//   <DOM: (...)>                       // all DOM ops in scope, DOM name gone
//   <DOM: (div: D, p: Para, ...)>      // div→D, p→Para, everything else as-is
//   <DOM: (div: _, ...)>               // :div consumed/discarded, rest spread
//
// Spread is expanded by the shared validator using options.remotes, so downstream
// (DOM tag check, codegen) sees a fully-resolved destructure list.
// ═══════════════════════════════════════════════════════════════════════════════

const DOM_MANIFEST = `{
  div: (:inner_html Text) -> (HTMLElement)
  p: (:inner_html Text) -> (HTMLElement)
  h1: (:inner_html Text) -> (HTMLElement)
  span: (:inner_html Text) -> (HTMLElement)
}`;

function compileWithDOM(source, extraRemotes = []) {
  const { ast } = extract(source);
  return compile(ast, {
    remotes: [{ path: 'DOM', service: DOM_MANIFEST }, ...extraRemotes],
  });
}

describe('DI spread operator — <DOM: (...)>', () => {
  it('`(...)` spreads the full manifest — any manifest tag compiles', () => {
    const source = `
      <DOM: (...)>
      @create = -> <div><h1>Title</h1><p>body</p><span>x</span></div>
    `;
    expect(() => compileWithDOM(source)).not.toThrow();
  });

  it('tag not in manifest still errors even with spread', () => {
    // Spread only pulls in what the manifest declares; tags the manifest doesn't
    // define remain a compile error.
    const source = `
      <DOM: (...)>
      @create = -> <article>nope</article>
    `;
    expect(() => compileWithDOM(source)).toThrow(/<article>.*:article.*DOM/);
  });

  it('aliases before `...` rebind specific names; spread supplies the rest', () => {
    // With `div: D`, the template `<div>` should still compile because the tag
    // check uses the remote name of the destructure entry (div), not the local
    // alias (D). This is existing behavior for explicit destructures.
    const source = `
      <DOM: (div: D, ...)>
      @create = -> <div><p>body</p></div>
    `;
    expect(() => compileWithDOM(source)).not.toThrow();
  });

  it('`name: _` discards before `...` — discarded tag cannot be used', () => {
    // div is consumed by _, so the spread does not supply it, and the tag
    // check should reject `<div>`.
    const source = `
      <DOM: (div: _, ...)>
      @create = -> <div>nope</div>
    `;
    expect(() => compileWithDOM(source)).toThrow(/<div>.*:div.*DOM/);
  });

  it('`name: _` discards but other tags from spread still work', () => {
    const source = `
      <DOM: (div: _, ...)>
      @create = -> <p>ok</p>
    `;
    expect(() => compileWithDOM(source)).not.toThrow();
  });

  it('spread without a remote manifest is a compile error', () => {
    // No options.remotes for DOM → the pre-existing interface check catches
    // the missing manifest before spread expansion even runs. Same root cause,
    // same outcome: compile fails naming the dependency.
    const source = `
      <DOM: (...)>
      @create = -> <div>x</div>
    `;
    const { ast } = extract(source);
    expect(() => compile(ast, {})).toThrow(/DOM.*interface|spread.*DOM.*manifest/i);
  });

  it('two spread injections sharing a name is a compile error', () => {
    const OTHER = `{
      div: (:inner_html Text) -> (HTMLElement)
      section: (:inner_html Text) -> (HTMLElement)
    }`;
    const source = `
      <DOM: (...)>
      <"OTHER": (...)>
      @create = -> <div>x</div>
    `;
    const { ast } = extract(source);
    expect(() => compile(ast, {
      remotes: [
        { path: 'DOM', service: DOM_MANIFEST },
        { path: 'OTHER', service: OTHER },
      ],
    })).toThrow(/collision.*div/i);
  });
});
