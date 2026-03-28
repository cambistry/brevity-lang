import { expectReply } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Private function (lambda) return forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('function return — all forms', () => {
  const script = `
    --- implicit (curly body — last expression is value) ---

    @implicitSimple
      =
      fn = |a| { a + 1 }
      result Integer = fn(5)
      -> :result

    @implicitAssign
      =
      fn = |a| {
        x = a * 2
        x + 1
      }
      result Integer = fn(4)
      -> :result

    --- explicit positional — ->(x as Integer) ---

    @explicitPos
      =
      fn = |a| {
        x = a + 1
        -> (x as Integer)
      }
      result Integer = fn(5)
      -> :result

    @explicitMultiPos
      =
      fn = |a, b| {
        -> (a as Integer, b as Integer)
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
        -> (result: (a + 1) as Integer)
      }
      :result Integer = fn(5)
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
        -> (a as Integer)
        a + 999
      }
      result Integer = fn(5)
      -> :result

    --- no-paren explicit (same-line shorthand) ---

    @noParenBare
      =
      fn = |a| {
        -> a
      }
      result Integer = fn(42)
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
      :result Integer = fn(7)
      -> :result

    @noParenTyped
      =
      fn = |a| {
        -> a as Integer
      }
      result Integer = fn(13)
      -> :result

    --- string and boolean literal returns ---

    @stringReturn
      =
      fn = |a| { -> "hello" as Text }
      result Text = fn(0)
      -> :result

    @boolReturn
      =
      fn = |a| { -> true as Boolean }
      result Boolean = fn(0)
      -> :result

    --- arity error ---

    @arityError
      =
      fn = |x| { -> (x as Integer, x as Integer) }
      a Integer = fn(5)
      -> result: a
  `;

  it('{ expr } — implicit return of final expression', async () => {
    await expectReply({
      script, receive: { id: '1', op: '@implicitSimple', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' },
    });
  });

  it('{ assign; expr } — body with assign then implicit return', async () => {
    await expectReply({
      script, receive: { id: '2', op: '@implicitAssign', from: 'c' },
      reply: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 9 }, to: 'c' },
    });
  });

  it('-> (x as Integer) — single positional', async () => {
    await expectReply({
      script, receive: { id: '3', op: '@explicitPos', from: 'c' },
      reply: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' },
    });
  });

  it('-> (a as Integer, b as Integer) — multi-positional', async () => {
    await expectReply({
      script, receive: { id: '4', op: '@explicitMultiPos', from: 'c' },
      reply: { id: '4', re: { x: 3, y: 4 }, to: 'c' },
    });
  });

  it('-> (:x) — named return', async () => {
    await expectReply({
      script, receive: { id: '5', op: '@explicitNamed', from: 'c' },
      reply: { id: '5', re: { x: 6 }, to: 'c' },
    });
  });

  it('-> (result: expr : Integer) — named with expression', async () => {
    await expectReply({
      script, receive: { id: '6', op: '@explicitNamedExpr', from: 'c' },
      reply: { id: '6', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' },
    });
  });

  it('-> (:a, :b) — multi-named paren', async () => {
    await expectReply({
      script, receive: { id: '7', op: '@multiNamedParen', from: 'c' },
      reply: { id: '7', re: { a: 10, b: 20 }, to: 'c' },
    });
  });

  it('early return — dead code after -> is ignored', async () => {
    await expectReply({
      script, receive: { id: '8', op: '@earlyExit', from: 'c' },
      reply: { id: '8', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' },
    });
  });

  it('-> a — bare positional variable', async () => {
    await expectReply({
      script, receive: { id: '9', op: '@noParenBare', from: 'c' },
      reply: { id: '9', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' },
    });
  });

  it('-> a, b — two bare positionals', async () => {
    await expectReply({
      script, receive: { id: '10', op: '@noParenTwo', from: 'c' },
      reply: { id: '10', re: { x: 3, y: 4 }, to: 'c' },
    });
  });

  it('-> :a — sigil no-paren', async () => {
    await expectReply({
      script, receive: { id: '11', op: '@noParenSigil', from: 'c' },
      reply: { id: '11', re: { a: 99 }, to: 'c' },
    });
  });

  it('-> result: a — key-value no-paren', async () => {
    await expectReply({
      script, receive: { id: '12', op: '@noParenKeyVal', from: 'c' },
      reply: { id: '12', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' },
    });
  });

  it('-> a : Integer — typed positional no-paren', async () => {
    await expectReply({
      script, receive: { id: '13', op: '@noParenTyped', from: 'c' },
      reply: { id: '13', 'bv-a': { result: 'Integer' }, re: { result: 13 }, to: 'c' },
    });
  });

  it('-> "hello" as Text — string literal return', async () => {
    await expectReply({
      script, receive: { id: '15', op: '@stringReturn', from: 'c' },
      reply: { id: '15', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' },
    });
  });

  it('-> true as Boolean — boolean literal return', async () => {
    await expectReply({
      script, receive: { id: '16', op: '@boolReturn', from: 'c' },
      reply: { id: '16', 'bv-a': { result: 'Boolean' }, re: { result: true }, to: 'c' },
    });
  });

  it('plain assign from 2-positional return → runtime error', async () => {
    await expectReply({
      script, receive: { id: '14', op: '@arityError', from: 'c' },
      reply: { id: '14', ex: { '@arityError': 'error' }, to: 'c' },
    });
  });
});
