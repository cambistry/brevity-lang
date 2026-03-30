import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// RHS structure literal syntax
// ═══════════════════════════════════════════════════════════════════════════════

describe('RHS structure literal', () => {
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
      s = a as Integer, b as Integer
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
      s = 1 as Integer, 2 as Integer, x: "val" as Text
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

  it('s = a, b — 2-positional structure', async () => {
    await expectBehavior({
      script, receive: { id: '1', op: '@posTwo', from: 'c' },
      reply: { id: '1', re: [10, 20], to: 'c' },
    });
  });

  it('s = a, b, c — 3-positional structure', async () => {
    await expectBehavior({
      script, receive: { id: '2', op: '@posThree', from: 'c' },
      reply: { id: '2', re: [1, 2, 3], to: 'c' },
    });
  });

  it('s = a as Integer, b as Integer — typed positional', async () => {
    await expectBehavior({
      script, receive: { id: '3', op: '@posTyped', from: 'c' },
      reply: { id: '3', re: [7, 8], to: 'c' },
    });
  });

  it('s = :a, :b — named sigil structure', async () => {
    await expectBehavior({
      script, receive: { id: '4', op: '@namedSigil', from: 'c' },
      reply: { id: '4', re: { a: 11, b: 22 }, to: 'c' },
    });
  });

  it('s = x: 5, y: 10 — key-value named structure', async () => {
    await expectBehavior({
      script, receive: { id: '5', op: '@namedKeyValue', from: 'c' },
      reply: { id: '5', re: { x: 5, y: 10 }, to: 'c' },
    });
  });

  it('s = a, b, :c, :d — mixed positional + named', async () => {
    await expectBehavior({
      script, receive: { id: '6', op: '@mixedSigil', from: 'c' },
      reply: { id: '6', re: [1, 2, { c: 30, d: 40 }], to: 'c' },
    });
  });

  it('s = 1, 2, x: "val" — mixed with literal and key-value', async () => {
    await expectBehavior({
      script, receive: { id: '7', op: '@mixedLiteral', from: 'c' },
      reply: { id: '7', re: [1, 2, { x: 'val' }], to: 'c' },
    });
  });

  it('a, b = s where s was built as a literal', async () => {
    await expectBehavior({
      script, receive: { id: '8', op: '@roundtrip', from: 'c' },
      reply: { id: '8', 'bv-a': { sum: 'Integer' }, re: { sum: 11 }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Structure coercion + named-field destructure
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure coercion + named-field destructure', () => {
  const script = `
    @coerceInt
      =
      s Structure = 42 as Integer
      -> ...s

    @coerceText
      =
      s Structure = "hello" as Text
      -> ...s

    @namedFieldOk
      =
      :a, :b = Structure(a: 1 as Integer, b: 2 as Integer)
      -> sum: (a + b) as Integer
  `;

  it('s Structure = 42 as Integer wraps in 1-arity structure', async () => {
    await expectBehavior({
      script, receive: { id: '1', op: '@coerceInt', from: 'c' },
      reply: { id: '1', re: [42], to: 'c' },
    });
  });

  it('s Structure = "hello" as Text wraps in 1-arity structure', async () => {
    await expectBehavior({
      script, receive: { id: '2', op: '@coerceText', from: 'c' },
      reply: { id: '2', re: ['hello'], to: 'c' },
    });
  });

  it('(:a, :b) = Structure(a: 1, b: 2) succeeds', async () => {
    await expectBehavior({
      script, receive: { id: '3', op: '@namedFieldOk', from: 'c' },
      reply: { id: '3', 'bv-a': { sum: 'Integer' }, re: { sum: 3 }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile-time checks
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure — compile-time checks', () => {
  it('a = Structure(x, y) — 2-arity assign to plain var throws', () => {
    expect(() => compileSource(`
      @test
        =
        a = Structure(1 as Integer, 2 as Integer)
        -> result: a
    `)).toThrow(/Cannot assign 2-arity Structure/);
  });

  it('a = Structure(x, y, z) — 3-arity assign to plain var throws', () => {
    expect(() => compileSource(`
      @test
        =
        a = Structure(1 as Integer, 2 as Integer, 3 as Integer)
        -> result: a
    `)).toThrow(/Cannot assign 3-arity Structure/);
  });

  it('a Type = Structure(x as Type) — single positional is OK', () => {
    expect(() => compileSource(`
      @test
        =
        a Integer = Structure(42 as Integer)
        -> result: a
    `)).not.toThrow();
  });

  it('(:a, :b) = Structure(a: 1) — missing field b throws', () => {
    expect(() => compileSource(`
      @test
        =
        :a, :b = Structure(a: 1 as Integer)
        -> result: a
    `)).toThrow(/Field 'b' not found in Structure literal/);
  });

  it('(:a) = Structure(a: 1, b: 2) — under-destructuring is OK', () => {
    expect(() => compileSource(`
      @test
        =
        :a = Structure(a: 1 as Integer, b: 2 as Integer)
        -> result: a
    `)).not.toThrow();
  });
});
