import { extract, compile } from '../../index.js';
import { domManifest as HTML_MANIFEST } from '../../src/codegen/browser/runtime.js';

// ═══════════════════════════════════════════════════════════════════════════════
// DI spread operator — `<HTML: (...)>`
//
// `...` flattens the module's full public interface into local scope, consuming
// the module's own name. Explicit entries before `...` let you alias or discard
// specific names; `...` then supplies "everything else" from the remote manifest.
//
//   <HTML: (...)>                       // all HTML ops in scope, HTML name gone
//   <HTML: (div: D, p: Para, ...)>      // div→D, p→Para, everything else as-is
//   <HTML: (div: _, ...)>               // :div consumed/discarded, rest spread
//
// Spread is expanded by the shared validator using options.remotes, so downstream
// (HTML tag check, codegen) sees a fully-resolved destructure list.
// ═══════════════════════════════════════════════════════════════════════════════

function compileWithHTML(source, extraRemotes = []) {
  const { ast } = extract(source);
  return compile(ast, {
    remotes: [{ path: 'HTML', service: HTML_MANIFEST }, ...extraRemotes],
  });
}

describe('DI spread operator — <HTML: (...)>', () => {
  it('`(...)` spreads the full manifest — any manifest tag compiles', () => {
    const source = `
      <HTML: (...)>
      @create = -> <div><h1>Title</h1><p>body</p><span>x</span></div>
    `;
    expect(() => compileWithHTML(source)).not.toThrow();
  });

  it('tag not in manifest still errors even with spread', () => {
    // Spread only pulls in what the manifest declares; tags the manifest doesn't
    // define remain a compile error.
    const source = `
      <HTML: (...)>
      @create = -> <article>nope</article>
    `;
    expect(() => compileWithHTML(source)).toThrow(/<article>.*:article.*HTML/);
  });

  it('aliases before `...` rebind specific names; spread supplies the rest', () => {
    // With `div: D`, the template `<div>` should still compile because the tag
    // check uses the remote name of the destructure entry (div), not the local
    // alias (D). This is existing behavior for explicit destructures.
    const source = `
      <HTML: (div: D, ...)>
      @create = -> <div><p>body</p></div>
    `;
    expect(() => compileWithHTML(source)).not.toThrow();
  });

  it('`name: _` discards before `...` — discarded tag cannot be used', () => {
    // div is consumed by _, so the spread does not supply it, and the tag
    // check should reject `<div>`.
    const source = `
      <HTML: (div: _, ...)>
      @create = -> <div>nope</div>
    `;
    expect(() => compileWithHTML(source)).toThrow(/<div>.*:div.*HTML/);
  });

  it('`name: _` discards but other tags from spread still work', () => {
    const source = `
      <HTML: (div: _, ...)>
      @create = -> <p>ok</p>
    `;
    expect(() => compileWithHTML(source)).not.toThrow();
  });

  it('spread without a remote manifest is a compile error', () => {
    // No options.remotes for HTML → the pre-existing interface check catches
    // the missing manifest before spread expansion even runs. Same root cause,
    // same outcome: compile fails naming the dependency.
    const source = `
      <HTML: (...)>
      @create = -> <div>x</div>
    `;
    const { ast } = extract(source);
    expect(() => compile(ast, {})).toThrow(/HTML.*interface|spread.*HTML.*manifest/i);
  });

  it('two spread injections sharing a name is a compile error', () => {
    const OTHER = `{
      div: <:inner_html Text | null>
      section: <:inner_html Text | null>
    }`;
    const source = `
      <HTML: (...)>
      <"OTHER": (...)>
      @create = -> <div>x</div>
    `;
    const { ast } = extract(source);
    expect(() => compile(ast, {
      remotes: [
        { path: 'HTML', service: HTML_MANIFEST },
        { path: 'OTHER', service: OTHER },
      ],
    })).toThrow(/collision.*div/i);
  });
});
