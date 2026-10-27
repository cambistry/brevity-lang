import { extract } from '../../index.js';
import { compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════
// Arrow + block lambda bodies: `(e) -> { body }` and `e -> { body }`.
//
// Previously the parser rejected `->` followed by `{` and required the no-arrow
// block form `(e) { body }`. The arrow+block spelling is the surface the
// callback-handler cases want (`onpress=(e) -> { e.stop! }`), so it must parse
// and produce the SAME Function node a no-arrow block body produces.
//
// (A leading-`->` no-param lambda — `-> { body }` — parses inside parseFunction
// but is not dispatched to from expression/argument position today; it is out of
// scope for this ticket.)
//
// Pure-language tests — no browser, no services.
// ═══════════════════════════════════════════════════════════════════════════

// Find the first `Function` AST node whose body references `marker` (so we pick
// the lambda under test, not the enclosing handler).
function findFunction(ast, marker) {
  let found = null;
  const walk = (n) => {
    if (found || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type === 'Function' && JSON.stringify(n.body ?? '').includes(marker)) {
      found = n;
      return;
    }
    for (const k of Object.keys(n)) if (k !== 'type') walk(n[k]);
  };
  walk(ast);
  return found;
}

describe('arrow + block lambda — parses and shapes a braced Function body', () => {
  it('`(e) -> { body }` parses as a block-bodied Function', () => {
    const { ast } = extract(`
      @go
        =
        run = (e) -> { marka: e }
        -> ok: 1
    `);
    const fn = findFunction(ast, 'marka');
    expect(fn).toBeTruthy();
    expect(Array.isArray(fn.body)).toBe(true);
    expect(fn.expr == null).toBe(true);
    expect(fn.params).toEqual([{ name: 'e', type: null, positional: true }]);
  });

  it('`e -> { body }` (bare param) parses as a block-bodied Function', () => {
    const { ast } = extract(`
      @go
        =
        run = e -> { markb: e }
        -> ok: 1
    `);
    const fn = findFunction(ast, 'markb');
    expect(fn).toBeTruthy();
    expect(Array.isArray(fn.body)).toBe(true);
    expect(fn.params).toEqual([{ name: 'e', type: null, positional: true }]);
  });

  it('`(e) -> { body }` yields the same node shape as `(e) { body }`', () => {
    const arrowFn = findFunction(extract(`
      @go
        =
        run = (e) -> { markd: e }
        -> ok: 1
    `).ast, 'markd');
    const plainFn = findFunction(extract(`
      @go
        =
        run = (e) { markd: e }
        -> ok: 1
    `).ast, 'markd');
    expect(arrowFn).toEqual(plainFn);
  });
});

describe('arrow + block lambda — existing forms still parse', () => {
  it('`(e) -> expr` (arrow, expression body) still parses', () => {
    expect(() => extract(`
      @go
        =
        run = (e) -> e
        -> ok: 1
    `)).not.toThrow();
  });

  it('`e -> expr` (bare param, expression body) still parses', () => {
    expect(() => extract(`
      @go
        =
        run = e -> e
        -> ok: 1
    `)).not.toThrow();
  });

  it('`(e) { body }` (no-arrow block) still parses', () => {
    expect(() => extract(`
      @go
        =
        run = (e) { marke: e }
        -> ok: 1
    `)).not.toThrow();
  });

  it('`(e) -> .` silent and `() -> ()` void arrow bodies still parse', () => {
    expect(() => extract(`
      @go
        =
        a = (e) -> .
        b = () -> ()
        -> ok: 1
    `)).not.toThrow();
  });
});

describe('arrow + block lambda — unrelated post-brace rules preserved', () => {
  it('a type annotation after a closing `}` is still rejected', () => {
    expect(() => extract(`@go = { run = (e) { markf: e } as Integer }`))
      .toThrow(/after closing '\}' is not valid/);
  });

  it('`->` immediately after a closing `}` is still rejected', () => {
    expect(() => extract(`@go = { run = (e) { markg: e } -> () }`))
      .toThrow(/after closing '\}' is not valid/);
  });
});

describe('arrow + block lambda — compiles end to end', () => {
  it('a block-bodied arrow lambda used as a local function compiles', () => {
    expect(() => compileSource(`
      @go
        =
        add = (n) -> { r: Integer = n + 1 -> out: r }
        v: Integer = add(2)
        -> result: v
    `)).not.toThrow();
  });
});
