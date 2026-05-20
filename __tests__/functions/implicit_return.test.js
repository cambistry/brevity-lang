import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Implicit return from curly-brace functions
//
// In a { body } block, the last expression is the return value.
// The syntax is the same as what would follow -> in an explicit return.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Fixture 1: lambda single-value returns + sigil ──────────────────────────

const lambdaSingleValue = `
    @intExpr
      =
      fn = (a) { a + 1 }
      result Integer = fn(5)
      -> :result

    @intExprTyped
      =
      fn = (a) { a + 1 }
      result Integer = fn(5)
      -> :result

    @strLit
      =
      fn = () { "hello" }
      result Text = fn()
      -> :result

    @boolLit
      =
      fn = () { true }
      result Boolean = fn()
      -> :result

    @varRef
      =
      fn = (a) { x = a * 2; x }
      result Integer = fn(4)
      -> :result

    @assignReturn
      =
      fn = (a) { r = a + 1 }
      result Integer = fn(5)
      -> :result

    @sigil
      =
      fn = (a) { x = a + 1; :x }
      :x = fn(5)
      -> :x
`;

describe('implicit return — single value', () => {
  it('integer expression', async () => {
    await expectBehavior(lambdaSingleValue,
      { input: { id: '1', op: '@intExpr', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });

  it('integer expression with explicit type annotation', async () => {
    await expectBehavior(lambdaSingleValue,
      { input: { id: '1', op: '@intExprTyped', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });

  it('string literal', async () => {
    await expectBehavior(lambdaSingleValue,
      { input: { id: '1', op: '@strLit', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' } },
    );
  });

  it('boolean literal', async () => {
    await expectBehavior(lambdaSingleValue,
      { input: { id: '1', op: '@boolLit', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Boolean' }, re: { result: true }, to: 'c' } },
    );
  });

  it('variable reference', async () => {
    await expectBehavior(lambdaSingleValue,
      { input: { id: '1', op: '@varRef', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 8 }, to: 'c' } },
    );
  });

  it('assignment resolves to assigned value', async () => {
    await expectBehavior(lambdaSingleValue,
      { input: { id: '1', op: '@assignReturn', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });
});

describe('implicit return — sigil', () => {
  it(':x — return var x under the "x" key', async () => {
    await expectBehavior(lambdaSingleValue,
      { input: { id: '1', op: '@sigil', from: 'c' } },
      { output: { id: '1', re: { x: 6 }, to: 'c' } },
    );
  });
});

// ── Fixture 2: multi-value lambda returns ───────────────────────────────────

const lambdaMultiValue = `
    @posVars
      =
      fn = (a, b) { a, b }
      x, y = fn(3, 4)
      -> :x, :y

    @posParens
      =
      fn = (a, b) { (a, b) }
      x, y = fn(3, 4)
      -> :x, :y

    @namedVars
      =
      fn = (a, b) { x: a, y: b }
      :x, :y = fn(10, 20)
      -> :x, :y

    @namedParens
      =
      fn = (a, b) { (x: a, y: b) }
      :x, :y = fn(10, 20)
      -> :x, :y

    @mixed
      =
      fn = (a, b, c) { a, b, extra: c }
      x, y, :extra = fn(1, 2, 3)
      -> :x, :y, :extra

    @mixedParens
      =
      fn = (a, b, c) { (a, b, extra: c) }
      x, y, :extra = fn(1, 2, 3)
      -> :x, :y, :extra

    @mixedLiterals
      =
      fn = (c, e) { 1 as Integer, "text" as Text, c, d: e }
      a, b, x, :d = fn(99, 77)
      -> :a, :b, :x, :d

    @mixedLiteralsParens
      =
      fn = (c, e) { (1 as Integer, "text" as Text, c, d: e) }
      a, b, x, :d = fn(99, 77)
      -> :a, :b, :x, :d

    @structSigils
      =
      fn = (a, b) { x = a + 1; y = b + 2; :x, :y }
      :x, :y = fn(3, 4)
      -> :x, :y

    @structSigilsParens
      =
      fn = (a, b) { x = a + 1; y = b + 2; (:x, :y) }
      :x, :y = fn(3, 4)
      -> :x, :y
`;

describe('implicit return — positional lists', () => {
  it('a, b — two positionals from vars', async () => {
    await expectBehavior(lambdaMultiValue,
      { input: { id: '1', op: '@posVars', from: 'c' } },
      { output: { id: '1', re: { x: 3, y: 4 }, to: 'c' } },
    );
  });

  it('(a, b) — with parens', async () => {
    await expectBehavior(lambdaMultiValue,
      { input: { id: '1', op: '@posParens', from: 'c' } },
      { output: { id: '1', re: { x: 3, y: 4 }, to: 'c' } },
    );
  });
});

describe('implicit return — named fields', () => {
  it('x: a, y: b — named', async () => {
    await expectBehavior(lambdaMultiValue,
      { input: { id: '1', op: '@namedVars', from: 'c' } },
      { output: { id: '1', re: { x: 10, y: 20 }, to: 'c' } },
    );
  });

  it('(x: a, y: b) — named with parens', async () => {
    await expectBehavior(lambdaMultiValue,
      { input: { id: '1', op: '@namedParens', from: 'c' } },
      { output: { id: '1', re: { x: 10, y: 20 }, to: 'c' } },
    );
  });
});

describe('implicit return — mixed', () => {
  it('a, b, x: y — mixed positional + named', async () => {
    await expectBehavior(lambdaMultiValue,
      { input: { id: '1', op: '@mixed', from: 'c' } },
      { output: { id: '1', re: { x: 1, y: 2, extra: 3 }, to: 'c' } },
    );
  });

  it('(a, b, x: y) — mixed with parens', async () => {
    await expectBehavior(lambdaMultiValue,
      { input: { id: '1', op: '@mixedParens', from: 'c' } },
      { output: { id: '1', re: { x: 1, y: 2, extra: 3 }, to: 'c' } },
    );
  });

  it('1, "text", c, d: e — mixed with literals', async () => {
    await expectBehavior(lambdaMultiValue,
      { input: { id: '1', op: '@mixedLiterals', from: 'c' } },
      { output: { id: '1', re: { a: 1, b: 'text', x: 99, d: 77 }, to: 'c' } },
    );
  });

  it('(1, "text", c, d: e) — mixed with literals in parens', async () => {
    await expectBehavior(lambdaMultiValue,
      { input: { id: '1', op: '@mixedLiteralsParens', from: 'c' } },
      { output: { id: '1', re: { a: 1, b: 'text', x: 99, d: 77 }, to: 'c' } },
    );
  });
});

describe('implicit return — structuring', () => {
  it(':x, :y — structuring (means x: x, y: y)', async () => {
    await expectBehavior(lambdaMultiValue,
      { input: { id: '1', op: '@structSigils', from: 'c' } },
      { output: { id: '1', re: { x: 4, y: 6 }, to: 'c' } },
    );
  });

  it('(:x, :y) — structuring with parens', async () => {
    await expectBehavior(lambdaMultiValue,
      { input: { id: '1', op: '@structSigilsParens', from: 'c' } },
      { output: { id: '1', re: { x: 4, y: 6 }, to: 'c' } },
    );
  });
});

// ── Fixture 3: public handler bodies (braced + lineal) ──────────────────────

const publicHandlers = `
    @bracedSigil = { x Integer = 1; :x }
    @bracedMultiSigils = { x Integer = 1; y Integer = 2; :x, :y }
    @bracedParenSigils = { x Integer = 1; y Integer = 2; (:x, :y) }
    @bracedMixed = { x Integer = 1; y Integer = 2; z Integer = 3; x, :y, alias: z }
    @bracedExpr = { "hello" }

    p = -> "yes"
    @bracedFnCall = { p() }

    @linealSigil
      =
      x Integer = 1
      :x

    @linealMultiSigils
      =
      x Integer = 1
      y Integer = 2
      :x, :y

    @linealParenSigils
      =
      x Integer = 1
      y Integer = 2
      (:x, :y)

    @linealMixed
      =
      x Integer = 1
      y Integer = 2
      z Integer = 3
      x, :y, alias: z
`;

// ═══════════════════════════════════════════════════════════════════════════════
// Implicit return — top-level public handler braced body
// ═══════════════════════════════════════════════════════════════════════════════

describe('implicit return — public handler braced body', () => {
  it('single sigil: :x', async () => {
    await expectBehavior(publicHandlers,
      { input: { id: '1', op: '@bracedSigil', from: 'c' } },
      { output: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 1 }, to: 'c' } },
    );
  });

  it('multiple sigils: :x, :y', async () => {
    await expectBehavior(publicHandlers,
      { input: { id: '1', op: '@bracedMultiSigils', from: 'c' } },
      { output: { id: '1', 'bv-a': { x: 'Integer', y: 'Integer' }, re: { x: 1, y: 2 }, to: 'c' } },
    );
  });

  it('paren-wrapped sigils: (:x, :y)', async () => {
    await expectBehavior(publicHandlers,
      { input: { id: '1', op: '@bracedParenSigils', from: 'c' } },
      { output: { id: '1', 'bv-a': { x: 'Integer', y: 'Integer' }, re: { x: 1, y: 2 }, to: 'c' } },
    );
  });

  it('mixed positional, sigil, alias: x, :y, alias: z', async () => {
    await expectBehavior(publicHandlers,
      { input: { id: '1', op: '@bracedMixed', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer', { y: 'Integer', alias: 'Integer' }], re: [1, { y: 2, alias: 3 }], to: 'c' } },
    );
  });

  it('single expression: "hello"', async () => {
    await expectBehavior(publicHandlers,
      { input: { id: '1', op: '@bracedExpr', from: 'c' } },
      { output: { id: '1', re: ['hello'], to: 'c' } },
    );
  });

  it('function call: p()', async () => {
    await expectBehavior(publicHandlers,
      { input: { id: '1', op: '@bracedFnCall', from: 'c' } },
      { output: { id: '1', re: ['yes'], to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Implicit return — lineal form (no braces)
//
// Same patterns as braced body, but in lineal (spacious) form.
// The parser must recognise sigils, paren-wrapped, and mixed returns
// as implicit returns even without stopToken.
// ═══════════════════════════════════════════════════════════════════════════════

describe('implicit return — public handler lineal body', () => {
  it('single sigil: :x', async () => {
    await expectBehavior(publicHandlers,
      { input: { id: '1', op: '@linealSigil', from: 'c' } },
      { output: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 1 }, to: 'c' } },
    );
  });

  it('multiple sigils: :x, :y', async () => {
    await expectBehavior(publicHandlers,
      { input: { id: '1', op: '@linealMultiSigils', from: 'c' } },
      { output: { id: '1', 'bv-a': { x: 'Integer', y: 'Integer' }, re: { x: 1, y: 2 }, to: 'c' } },
    );
  });

  it('paren-wrapped sigils: (:x, :y)', async () => {
    await expectBehavior(publicHandlers,
      { input: { id: '1', op: '@linealParenSigils', from: 'c' } },
      { output: { id: '1', 'bv-a': { x: 'Integer', y: 'Integer' }, re: { x: 1, y: 2 }, to: 'c' } },
    );
  });

  it('mixed positional, sigil, alias: x, :y, alias: z', async () => {
    await expectBehavior(publicHandlers,
      { input: { id: '1', op: '@linealMixed', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer', { y: 'Integer', alias: 'Integer' }], re: [1, { y: 2, alias: 3 }], to: 'c' } },
    );
  });
});

// ── Fixture 4: spread ───────────────────────────────────────────────────────

const spreadFixture = `
    inner
      =
      a Integer
      b Integer
      =
      -> (x: a as Integer, y: b as Integer)

    @spreadNoParens
      =
      fn = () { args Object = inner(3, 4); ...args }
      :x, :y = fn()
      -> :x, :y

    @spreadParens
      =
      fn = () { args Object = inner(3, 4); (...args) }
      :x, :y = fn()
      -> :x, :y
`;

describe('implicit return — spread', () => {
  it('...args — spreading an Object', async () => {
    await expectBehavior(spreadFixture,
      { input: { id: '1', op: '@spreadNoParens', from: 'c' } },
      { output: { id: '1', re: { x: 3, y: 4 }, to: 'c' } },
    );
  });

  it('(...args) — spreading with parens', async () => {
    await expectBehavior(spreadFixture,
      { input: { id: '1', op: '@spreadParens', from: 'c' } },
      { output: { id: '1', re: { x: 3, y: 4 }, to: 'c' } },
    );
  });
});

// ── Fixture 8: function-typed assignment (return type inferred from LHS) ────
//
// When the LHS declares a function type (`fn (T) -> (U) = ...`), the literal's
// body does not need to redeclare the return type — it flows in from the LHS.

const fnTypedFixture = `
    @fnTypedSimple
      =
      fn (Integer) -> (Boolean) = (x Integer) { x > 0 }
      result Boolean = fn(5)
      -> :result

    @fnTypedMultistep
      =
      fn (Integer) -> (Integer) = (x Integer) { y = x * 2; y + 1 }
      result Integer = fn(5)
      -> :result
`;

describe('implicit return — function-typed assignment', () => {
  it('LHS function-type provides return type for braced literal', async () => {
    await expectBehavior(fnTypedFixture,
      { input: { id: '1', op: '@fnTypedSimple', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Boolean' }, re: { result: true }, to: 'c' } },
    );
  });

  it('multi-statement body — last expression takes LHS return type', async () => {
    await expectBehavior(fnTypedFixture,
      { input: { id: '1', op: '@fnTypedMultistep', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'c' } },
    );
  });
});
