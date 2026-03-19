import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Private function (lambda) return forms
//
// Implicit (last expr), explicit positional, explicit named,
// no-paren shorthand, early exit, arity error.
// ═══════════════════════════════════════════════════════════════════════════════

describe('function return — all forms', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- implicit (curly body — last expression is value) ---

      @implicitSimple
        =
        fn = |a| { a + 1 }
        result : Integer = fn(5)
        -> :result

      @implicitAssign
        =
        fn = |a| {
          x = a * 2
          x + 1
        }
        result : Integer = fn(4)
        -> :result

      --- explicit positional — ->(x : Integer) ---

      @explicitPos
        =
        fn = |a| {
          x = a + 1
          -> (x : Integer)
        }
        result : Integer = fn(5)
        -> :result

      @explicitMultiPos
        =
        fn = |a, b| {
          -> (a : Integer, b : Integer)
        }
        x, y = fn(3, 4)
        -> :x, :y

      --- explicit named — ->(:x), ->(result: expr) ---

      @explicitNamed
        =
        fn = |a| {
          x = a + 1
          -> (:x)
        }
        :x = fn(5)
        -> :x

      @explicitNamedExpr
        =
        fn = |a| {
          -> (result: a + 1 : Integer)
        }
        :result : Integer = fn(5)
        -> :result

      @multiNamedParen
        =
        fn = |a, b| {
          -> (:a, :b)
        }
        :a, :b = fn(10, 20)
        -> :a, :b

      --- early exit (dead code after return) ---

      @earlyExit
        =
        fn = |a| {
          -> (a : Integer)
          a + 999
        }
        result : Integer = fn(5)
        -> :result

      --- no-paren explicit (same-line shorthand) ---

      @noParenBare
        =
        fn = |a| {
          -> a
        }
        result : Integer = fn(42)
        -> :result

      @noParenTwo
        =
        fn = |a, b| {
          -> a, b
        }
        x, y = fn(3, 4)
        -> :x, :y

      @noParenSigil
        =
        fn = |a| {
          -> :a
        }
        :a = fn(99)
        -> :a

      @noParenKeyVal
        =
        fn = |a| {
          -> result: a
        }
        :result : Integer = fn(7)
        -> :result

      @noParenTyped
        =
        fn = |a| {
          -> a : Integer
        }
        result : Integer = fn(13)
        -> :result

      --- arity error ---

      @arityError
        =
        fn = |x| { -> (x : Integer, x : Integer) }
        a : Integer = fn(5)
        -> result: a
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'implicitSimple', from: 'c' },
        { id: '2', op: 'implicitAssign', from: 'c' },
        { id: '3', op: 'explicitPos', from: 'c' },
        { id: '4', op: 'explicitMultiPos', from: 'c' },
        { id: '5', op: 'explicitNamed', from: 'c' },
        { id: '6', op: 'explicitNamedExpr', from: 'c' },
        { id: '7', op: 'multiNamedParen', from: 'c' },
        { id: '8', op: 'earlyExit', from: 'c' },
        { id: '9', op: 'noParenBare', from: 'c' },
        { id: '10', op: 'noParenTwo', from: 'c' },
        { id: '11', op: 'noParenSigil', from: 'c' },
        { id: '12', op: 'noParenKeyVal', from: 'c' },
        { id: '13', op: 'noParenTyped', from: 'c' },
        { id: '14', op: 'arityError', from: 'c' },
      ],
    });
  });

  // implicit
  it('{ expr } — implicit return of final expression', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' });
  });

  it('{ assign; expr } — body with assign then implicit return', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 9 }, to: 'c' });
  });

  // explicit positional
  it('-> (x : Integer) — single positional', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' });
  });

  it('-> (a : Integer, b : Integer) — multi-positional', () => {
    expect(outputs[3]).toEqual({ id: '4', re: { x: 3, y: 4 }, to: 'c' });
  });

  // explicit named
  it('-> (:x) — named return', () => {
    expect(outputs[4]).toEqual({ id: '5', re: { x: 6 }, to: 'c' });
  });

  it('-> (result: expr : Integer) — named with expression', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' });
  });

  it('-> (:a, :b) — multi-named paren', () => {
    expect(outputs[6]).toEqual({ id: '7', re: { a: 10, b: 20 }, to: 'c' });
  });

  // early exit
  it('early return — dead code after -> is ignored', () => {
    expect(outputs[7]).toEqual({ id: '8', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' });
  });

  // no-paren explicit
  it('-> a — bare positional variable', () => {
    expect(outputs[8]).toEqual({ id: '9', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' });
  });

  it('-> a, b — two bare positionals', () => {
    expect(outputs[9]).toEqual({ id: '10', re: { x: 3, y: 4 }, to: 'c' });
  });

  it('-> :a — sigil no-paren', () => {
    expect(outputs[10]).toEqual({ id: '11', re: { a: 99 }, to: 'c' });
  });

  it('-> result: a — key-value no-paren', () => {
    expect(outputs[11]).toEqual({ id: '12', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' });
  });

  it('-> a : Integer — typed positional no-paren', () => {
    expect(outputs[12]).toEqual({ id: '13', 'bv-a': { result: 'Integer' }, re: { result: 13 }, to: 'c' });
  });

  // arity error
  it('plain assign from 2-positional return → runtime error', () => {
    expect(outputs[13]).toEqual({ id: '14', ex: { arityError: 'error' }, to: 'c' });
  });
});
