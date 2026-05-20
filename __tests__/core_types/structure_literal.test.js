import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// RHS object literal syntax
// ═══════════════════════════════════════════════════════════════════════════════

describe('RHS object literal', () => {
  const script = `
    --- positional ---

    @posTwo
      =
      a Integer = 10
      b Integer = 20
      s = a, b
      -> ...s

    @posThree
      =
      a Integer = 1
      b Integer = 2
      c Integer = 3
      s = a, b, c
      -> ...s

    @posTyped
      =
      a Integer = 7
      b Integer = 8
      s = a, b
      -> ...s

    --- named ---

    @namedSigil
      =
      a Integer = 11
      b Integer = 22
      s = :a, :b
      -> ...s

    @namedKeyValue
      =
      s = x: 5, y: 10
      -> ...s

    --- mixed ---

    @mixedSigil
      =
      a Integer = 1
      b Integer = 2
      c Integer = 30
      d Integer = 40
      s = a, b, :c, :d
      -> ...s

    @mixedLiteral
      =
      s = 1, 2, x: "val"
      -> ...s

    --- destructure roundtrip ---

    @roundtrip
      =
      x Integer = 5
      y Integer = 6
      s = x, y
      a, b = s
      -> sum: (a + b) as Integer
  `;

  it('s = a, b — 2-positional object', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@posTwo', from: 'c' } },
      { output: { id: '1', re: [10, 20], to: 'c' } },
    );
  });

  it('s = a, b, c — 3-positional object', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@posThree', from: 'c' } },
      { output: { id: '2', re: [1, 2, 3], to: 'c' } },
    );
  });

  it('s = a as Integer, b as Integer — typed positional', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@posTyped', from: 'c' } },
      { output: { id: '3', re: [7, 8], to: 'c' } },
    );
  });

  it('s = :a, :b — named sigil object', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@namedSigil', from: 'c' } },
      { output: { id: '4', re: { a: 11, b: 22 }, to: 'c' } },
    );
  });

  it('s = x: 5, y: 10 — key-value named object', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@namedKeyValue', from: 'c' } },
      { output: { id: '5', re: { x: 5, y: 10 }, to: 'c' } },
    );
  });

  it('s = a, b, :c, :d — mixed positional + named', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: '@mixedSigil', from: 'c' } },
      { output: { id: '6', re: [1, 2, { c: 30, d: 40 }], to: 'c' } },
    );
  });

  it('s = 1, 2, x: "val" — mixed with literal and key-value', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: '@mixedLiteral', from: 'c' } },
      { output: { id: '7', re: [1, 2, { x: 'val' }], to: 'c' } },
    );
  });

  it('a, b = s where s was built as a literal', async () => {
    await expectBehavior(script,
      { input: { id: '8', op: '@roundtrip', from: 'c' } },
      { output: { id: '8', 'bv-a': { sum: 'Integer' }, re: { sum: 11 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Object coercion + named-field destructure
// ═══════════════════════════════════════════════════════════════════════════════

describe('Object coercion + named-field destructure', () => {
  const script = `
    @coerceInt
      =
      s Object = 42 as Integer
      -> ...s

    @coerceText
      =
      s Object = "hello" as Text
      -> ...s

    @namedFieldOk
      =
      :a, :b = Object(a: 1, b: 2)
      -> sum: (a + b) as Integer
  `;

  it('s Object = 42 as Integer wraps in 1-arity object', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@coerceInt', from: 'c' } },
      { output: { id: '1', re: [42], to: 'c' } },
    );
  });

  it('s Object = "hello" as Text wraps in 1-arity object', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@coerceText', from: 'c' } },
      { output: { id: '2', re: ['hello'], to: 'c' } },
    );
  });

  it('(:a, :b) = Object(a: 1, b: 2) succeeds', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@namedFieldOk', from: 'c' } },
      { output: { id: '3', 'bv-a': { sum: 'Integer' }, re: { sum: 3 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile-time checks
// ═══════════════════════════════════════════════════════════════════════════════

describe('Object — compile-time checks', () => {
  it('a = Object(x, y) — 2-arity assign to plain var throws', () => {
    expect(() => compileSource(`
      @test
        =
        a = Object(1, 2)
        -> result: a
    `)).toThrow(/Cannot assign 2-arity Object/);
  });

  it('a = Object(x, y, z) — 3-arity assign to plain var throws', () => {
    expect(() => compileSource(`
      @test
        =
        a = Object(1, 2, 3)
        -> result: a
    `)).toThrow(/Cannot assign 3-arity Object/);
  });

  it('a Type = Object(x as Type) — single positional is OK', () => {
    expect(() => compileSource(`
      @test
        =
        a Integer = Object(42)
        -> result: a
    `)).not.toThrow();
  });

  it('(:a, :b) = Object(a: 1) — missing field b throws', () => {
    expect(() => compileSource(`
      @test
        =
        :a, :b = Object(a: 1)
        -> result: a
    `)).toThrow(/Field 'b' not found in Object literal/);
  });

  it('(:a) = Object(a: 1, b: 2) — under-destructuring is OK', () => {
    expect(() => compileSource(`
      @test
        =
        :a = Object(a: 1, b: 2)
        -> result: a
    `)).not.toThrow();
  });
});
