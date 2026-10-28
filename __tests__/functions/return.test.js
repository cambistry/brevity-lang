import { extract } from '../../index.js';
import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Private function (lambda) return forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('function return — all forms', () => {
  const script = `
    --- implicit (curly body — last expression is value) ---

    @implicitSimple
      =
      fn = (a) { a + 1 }
      result Integer = fn(5)
      return :result

    @implicitAssign
      =
      fn = (a) {
        x = a * 2
        x + 1
      }
      result Integer = fn(4)
      return :result

    --- explicit positional — ->(x as Integer) ---

    @explicitPos
      =
      fn = (a) {
        x = a + 1
        return (x as Integer)
      }
      result Integer = fn(5)
      return :result

    @explicitMultiPos
      =
      fn = (a, b) {
        return (a as Integer, b as Integer)
      }
      x, y = fn(3, 4)
      return :x, :y

    --- explicit named — ->(:x), ->(result: expr) ---

    @explicitNamed
      =
      fn = (a) {
        x = a + 1
        return (:x)
      }
      :x = fn(5)
      return :x

    @explicitNamedExpr
      =
      fn = (a) {
        return (result: (a + 1) as Integer)
      }
      :result Integer = fn(5)
      return :result

    @multiNamedParen
      =
      fn = (a, b) {
        return (:a, :b)
      }
      :a, :b = fn(10, 20)
      return :a, :b

    --- early exit (dead code after return) ---

    @earlyExit
      =
      fn = (a) {
        return (a as Integer)
        a + 999
      }
      result Integer = fn(5)
      return :result

    --- no-paren explicit (same-line shorthand) ---

    @noParenBare
      =
      fn = (a) {
        return a
      }
      result Integer = fn(42)
      return :result

    @noParenTwo
      =
      fn = (a, b) {
        return a, b
      }
      x, y = fn(3, 4)
      return :x, :y

    @noParenSigil
      =
      fn = (a) {
        return :a
      }
      :a = fn(99)
      return :a

    @noParenKeyVal
      =
      fn = (a) {
        return result: a
      }
      :result Integer = fn(7)
      return :result

    @noParenTyped
      =
      fn = (a) {
        return a as Integer
      }
      result Integer = fn(13)
      return :result

    --- string and boolean literal returns ---

    @stringReturn
      =
      fn = (a) { return "hello" as Text }
      result Text = fn(0)
      return :result

    @boolReturn
      =
      fn = (a) { return true as Boolean }
      result Boolean = fn(0)
      return :result

    --- arity error ---

    @arityError
      =
      fn = (x) { return (x as Integer, x as Integer) }
      a Integer = fn(5)
      return result: a
  `;

  it('{ expr } — implicit return of final expression', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@implicitSimple', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });

  it('{ assign; expr } — body with assign then implicit return', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@implicitAssign', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 9 }, to: 'c' } },
    );
  });

  it('-> (x as Integer) — single positional', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@explicitPos', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });

  it('-> (a as Integer, b as Integer) — multi-positional', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@explicitMultiPos', from: 'c' } },
      { output: { id: '4', re: { x: 3, y: 4 }, to: 'c' } },
    );
  });

  it('-> (:x) — named return', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@explicitNamed', from: 'c' } },
      { output: { id: '5', re: { x: 6 }, to: 'c' } },
    );
  });

  it('-> (result: expr : Integer) — named with expression', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: '@explicitNamedExpr', from: 'c' } },
      { output: { id: '6', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });

  it('-> (:a, :b) — multi-named paren', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: '@multiNamedParen', from: 'c' } },
      { output: { id: '7', re: { a: 10, b: 20 }, to: 'c' } },
    );
  });

  it('early return — dead code after -> is ignored', async () => {
    await expectBehavior(script,
      { input: { id: '8', op: '@earlyExit', from: 'c' } },
      { output: { id: '8', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } },
    );
  });

  it('-> a — bare positional variable', async () => {
    await expectBehavior(script,
      { input: { id: '9', op: '@noParenBare', from: 'c' } },
      { output: { id: '9', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('-> a, b — two bare positionals', async () => {
    await expectBehavior(script,
      { input: { id: '10', op: '@noParenTwo', from: 'c' } },
      { output: { id: '10', re: { x: 3, y: 4 }, to: 'c' } },
    );
  });

  it('-> :a — sigil no-paren', async () => {
    await expectBehavior(script,
      { input: { id: '11', op: '@noParenSigil', from: 'c' } },
      { output: { id: '11', re: { a: 99 }, to: 'c' } },
    );
  });

  it('-> result: a — key-value no-paren', async () => {
    await expectBehavior(script,
      { input: { id: '12', op: '@noParenKeyVal', from: 'c' } },
      { output: { id: '12', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('-> a : Integer — typed positional no-paren', async () => {
    await expectBehavior(script,
      { input: { id: '13', op: '@noParenTyped', from: 'c' } },
      { output: { id: '13', 'bv-a': { result: 'Integer' }, re: { result: 13 }, to: 'c' } },
    );
  });

  it('-> "hello" as Text — string literal return', async () => {
    await expectBehavior(script,
      { input: { id: '15', op: '@stringReturn', from: 'c' } },
      { output: { id: '15', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' } },
    );
  });

  it('-> true as Boolean — boolean literal return', async () => {
    await expectBehavior(script,
      { input: { id: '16', op: '@boolReturn', from: 'c' } },
      { output: { id: '16', 'bv-a': { result: 'Boolean' }, re: { result: true }, to: 'c' } },
    );
  });

  it('plain assign from 2-positional return → runtime error', async () => {
    await expectBehavior(script,
      { input: { id: '14', op: '@arityError', from: 'c' } },
      { output: { id: '14', ex: { '@arityError': 'error' }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// `return` is the explicit value-return; `->` is only the lambda / body-opener
// arrow. A bare `->` where a statement is expected (inside a braced body, or
// after another statement in a lineal body) is just a syntax error — a misplaced
// arrow. The sole-tail one-liner `@get = -> x` and lambda values keep `->`.
// ═══════════════════════════════════════════════════════════════════════════════

describe('a bare `->` is not a statement', () => {
  it('`fn = () { -> val }` is a parse error (braced body)', () => {
    expect(() => extract(`@go = {\n  fn = () { -> val: 1 }\n  return r: 1\n}\n`)).toThrow();
  });

  it('a braced handler body with a bare `->` is a parse error', () => {
    expect(() => extract(`@go = { -> x: 1 }\n`)).toThrow();
    expect(() => extract(`@go = { return x: 1 }\n`)).not.toThrow();
  });

  it('a bare `->` after another statement in a lineal body is a parse error', () => {
    expect(() => extract(`@go\n  =\n  =\n  y Integer = 1\n  -> result: y\n`)).toThrow();
    expect(() => extract(`@go\n  =\n  =\n  y Integer = 1\n  return result: y\n`)).not.toThrow();
  });

  it('`->` still opens a lambda / one-liner body (unchanged)', () => {
    // sole-tail one-liner getter — the arrow one-liner, kept as implicit return
    expect(() => extract(`@get = -> value: 1\n`)).not.toThrow();
    // lambda value arrow inside a braced body
    expect(() => extract(`@go = {\n  f = (x) -> x + 1\n  return r: f(2)\n}\n`)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// `return` is not an expression — it cannot be the right-hand side of `=`.
// `@get = return x` opens no function body and `return` is not assignable, so it
// is a parse error (distinct from the valid `@get = -> x` arrow one-liner and the
// valid `@get = { return x }` braced body).
// ═══════════════════════════════════════════════════════════════════════════════

describe('`return` cannot be a right-hand side', () => {
  it('`@get = return x` is a parse error (no body opened; return not assignable)', () => {
    expect(() => extract(`@get = return x\n`)).toThrow(/right-hand side of '='/);
  });

  it('`@get = return x` is NOT the same as the valid `@get = -> x`', () => {
    expect(() => extract(`@get = -> x\n`)).not.toThrow();         // arrow one-liner
    expect(() => extract(`@get = { return x }\n`)).not.toThrow(); // braced body
  });

  it('`return` is not assignable to a local binding', () => {
    expect(() => extract(`@go = {\n  x = return 5\n  return r: x\n}\n`)).toThrow();
  });

  it('`return` is not assignable to a private binding', () => {
    expect(() => extract(`@go = {\n  f = return x\n  return r: 1\n}\n`)).toThrow();
  });
});
