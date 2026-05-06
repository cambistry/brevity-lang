import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Delimited form — compilation check
// ═══════════════════════════════════════════════════════════════════════════════

describe('delimited form — compilation', () => {
  it('private single expression', () => {
    expect(() => compileSource('f = -> 42\n')).not.toThrow();
    expect(() => compileSource('f = -> 42 as Integer\n')).not.toThrow();
    expect(() => compileSource('f = -> "abc"\n')).not.toThrow();
    expect(() => compileSource('f = -> "abc" as Text\n')).not.toThrow();
    expect(() => compileSource('f = -> true\n')).not.toThrow();
    expect(() => compileSource('f = -> true as Boolean\n')).not.toThrow();
    expect(() => compileSource('f = a -> a\n')).not.toThrow();
    expect(() => compileSource('f = (a) -> a\n')).not.toThrow();
    expect(() => compileSource('f = (a Integer) -> a\n')).not.toThrow();
    expect(() => compileSource('f = (:a) -> a\n')).not.toThrow();
    expect(() => compileSource('f = (a: (b)) -> b\n')).not.toThrow();
    expect(() => compileSource('f = a -> a + 1\n')).not.toThrow();
    expect(() => compileSource('f = (a) -> a + 1\n')).not.toThrow();
    expect(() => compileSource('f = (a) -> (a + 1) as Integer\n')).not.toThrow();
    expect(() => compileSource('f = (a, b) -> a + b\n')).not.toThrow();
    expect(() => compileSource('f = (:a, :b) -> a + b\n')).not.toThrow();
    expect(() => compileSource('f = (a Integer, b Integer) -> a + b\n')).not.toThrow();
    expect(() => compileSource('f = (a, b) -> (a + b) as Integer\n')).not.toThrow();
    expect(() => compileSource('f = -> [1, 2, 3]\n')).not.toThrow();
    expect(() => compileSource('f = -> [1, 2, 3] as List\n')).not.toThrow();
  });

  it('private braced explicit return', () => {
    expect(() => compileSource('f = { -> 42 }\n')).not.toThrow();
    expect(() => compileSource('f = { -> 42 as Integer }\n')).not.toThrow();
    expect(() => compileSource('f = { -> "abc" }\n')).not.toThrow();
    expect(() => compileSource('f = { -> "abc" as Text }\n')).not.toThrow();
    expect(() => compileSource('f = { -> true }\n')).not.toThrow();
    expect(() => compileSource('f = { -> true as Boolean }\n')).not.toThrow();
    expect(() => compileSource('f = (a) { -> a }\n')).not.toThrow();
    expect(() => compileSource('f = (a Integer) { -> a }\n')).not.toThrow();
    expect(() => compileSource('f = (:a) { -> a }\n')).not.toThrow();
    expect(() => compileSource('f = (a: (b)) { -> b }\n')).not.toThrow();
    expect(() => compileSource('f = (a) { -> a + 1 }\n')).not.toThrow();
    expect(() => compileSource('f = (a) { -> (a + 1) as Integer }\n')).not.toThrow();
    expect(() => compileSource('f = (a, b) { -> a + b }\n')).not.toThrow();
    expect(() => compileSource('f = (:a, :b) { -> a + b }\n')).not.toThrow();
    expect(() => compileSource('f = (a Integer, b Integer) { -> a + b }\n')).not.toThrow();
    expect(() => compileSource('f = (a, b) { -> (a + b) as Integer }\n')).not.toThrow();
    expect(() => compileSource('f = { -> [1, 2, 3] }\n')).not.toThrow();
    expect(() => compileSource('f = { -> [1, 2, 3] as List }\n')).not.toThrow();
  });

  it('private braced implicit return', () => {
    expect(() => compileSource('f = { 42 }\n')).not.toThrow();
    expect(() => compileSource('f = { 42 as Integer }\n')).not.toThrow();
    expect(() => compileSource('f = { "abc" }\n')).not.toThrow();
    expect(() => compileSource('f = { "abc" as Text }\n')).not.toThrow();
    expect(() => compileSource('f = { true }\n')).not.toThrow();
    expect(() => compileSource('f = { true as Boolean }\n')).not.toThrow();
    expect(() => compileSource('f = (a) { a }\n')).not.toThrow();
    expect(() => compileSource('f = (a Integer) { a }\n')).not.toThrow();
    expect(() => compileSource('f = (:a) { a }\n')).not.toThrow();
    expect(() => compileSource('f = (a: (b)) { b }\n')).not.toThrow();
    expect(() => compileSource('f = (a) { a + 1 }\n')).not.toThrow();
    expect(() => compileSource('f = (a) { (a + 1) as Integer }\n')).not.toThrow();
    expect(() => compileSource('f = (a, b) { a + b }\n')).not.toThrow();
    expect(() => compileSource('f = (:a, :b) { a + b }\n')).not.toThrow();
    expect(() => compileSource('f = (a Integer, b Integer) { a + b }\n')).not.toThrow();
    expect(() => compileSource('f = (a, b) { (a + b) as Integer }\n')).not.toThrow();
    expect(() => compileSource('f = { [1, 2, 3] }\n')).not.toThrow();
    expect(() => compileSource('f = { [1, 2, 3] as List }\n')).not.toThrow();
  });

  it('private multi-line braced explicit return', () => {
    expect(() => compileSource('f = { x = 1\n -> x }\n')).not.toThrow();
    expect(() => compileSource('f = { x = "abc"\n -> x }\n')).not.toThrow();
    expect(() => compileSource('f = { x = false\n -> x }\n')).not.toThrow();
    expect(() => compileSource('f = { x = 1\n -> x as Integer }\n')).not.toThrow();
    expect(() => compileSource('f = { x = "abc"\n -> x as Text }\n')).not.toThrow();
    expect(() => compileSource('f = { x = false\n -> x as Boolean }\n')).not.toThrow();
    expect(() => compileSource('f = (a) { b Integer = a + 1\n -> a }\n')).not.toThrow();
    expect(() => compileSource('f = (a, b) { c Integer = a + b\n -> c }\n')).not.toThrow();
  });

  it('private multi-line braced implicit return', () => {
    expect(() => compileSource('f = { x = 1\n x }\n')).not.toThrow();
    expect(() => compileSource('f = { x = "abc"\n x }\n')).not.toThrow();
    expect(() => compileSource('f = { x = false\n x }\n')).not.toThrow();
    expect(() => compileSource('f = { x = 1\n x as Integer }\n')).not.toThrow();
    expect(() => compileSource('f = { x = "abc"\n x as Text }\n')).not.toThrow();
    expect(() => compileSource('f = { x = false\n x as Boolean }\n')).not.toThrow();
    expect(() => compileSource('f = (a) { b Integer = a + 1\n a }\n')).not.toThrow();
    expect(() => compileSource('f = (a, b) { c Integer = a + b\n c }\n')).not.toThrow();
  });

  it('public single expression', () => {
    expect(() => compileSource('@f = -> 42\n')).not.toThrow();
    expect(() => compileSource('@f = -> 42 as Integer\n')).not.toThrow();
    expect(() => compileSource('@f = -> "abc"\n')).not.toThrow();
    expect(() => compileSource('@f = -> "abc" as Text\n')).not.toThrow();
    expect(() => compileSource('@f = -> true\n')).not.toThrow();
    expect(() => compileSource('@f = -> true as Boolean\n')).not.toThrow();
    expect(() => compileSource('@f = (a) -> a\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a Integer) -> a\n')).not.toThrow();
    expect(() => compileSource('@f = (:a) -> a\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (:a Integer) -> a\n')).not.toThrow();
    expect(() => compileSource('@f = (a: (b)) -> b\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a: (b) Integer) -> b\n')).not.toThrow();
    expect(() => compileSource('@f = (a) -> a + 1\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a) -> (a + 1) as Integer\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a, b) -> a + b\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a, b) -> (a + b) as Integer\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a Integer, b Integer) -> (a + b) as Integer\n')).not.toThrow();
    expect(() => compileSource('@f = (:a, :b) -> a + b\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (:a Integer, :b Integer) -> (a + b) as Integer\n')).not.toThrow();
    expect(() => compileSource('@f = (list List) -> list\n')).not.toThrow();
    expect(() => compileSource('@f = -> [1, 2, 3]\n')).not.toThrow();
    expect(() => compileSource('@f = -> [1, 2, 3] as List\n')).not.toThrow();
  });

  it('public braced explicit return', () => {
    expect(() => compileSource('@f = { -> 42 }\n')).not.toThrow();
    expect(() => compileSource('@f = { -> 42 as Integer }\n')).not.toThrow();
    expect(() => compileSource('@f = { -> "abc" }\n')).not.toThrow();
    expect(() => compileSource('@f = { -> "abc" as Text }\n')).not.toThrow();
    expect(() => compileSource('@f = { -> true }\n')).not.toThrow();
    expect(() => compileSource('@f = { -> true as Boolean }\n')).not.toThrow();
    expect(() => compileSource('@f = (a) { -> a }\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a Integer) { -> a }\n')).not.toThrow();
    expect(() => compileSource('@f = (:a) { -> a }\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (:a Integer) { -> a }\n')).not.toThrow();
    expect(() => compileSource('@f = (a: (b)) { -> b }\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a: (b) Integer) { -> b }\n')).not.toThrow();
    expect(() => compileSource('@f = (a) { -> a + 1 }\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a) { -> (a + 1) as Integer }\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a, b) { -> a + b }\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a, b) { -> (a + b) as Integer }\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a Integer, b Integer) { -> (a + b) as Integer }\n')).not.toThrow();
    expect(() => compileSource('@f = (:a, :b) { -> a + b }\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (:a Integer, :b Integer) { -> (a + b) as Integer }\n')).not.toThrow();
    expect(() => compileSource('@f = (list List) { -> list }\n')).not.toThrow();
    expect(() => compileSource('@f = { -> [1, 2, 3] }\n')).not.toThrow();
    expect(() => compileSource('@f = { -> [1, 2, 3] as List }\n')).not.toThrow();
  });

  it('public braced implicit return', () => {
    expect(() => compileSource('@f = { 42 }\n')).not.toThrow();
    expect(() => compileSource('@f = { 42 as Integer }\n')).not.toThrow();
    expect(() => compileSource('@f = { "abc" }\n')).not.toThrow();
    expect(() => compileSource('@f = { "abc" as Text }\n')).not.toThrow();
    expect(() => compileSource('@f = { true }\n')).not.toThrow();
    expect(() => compileSource('@f = { true as Boolean }\n')).not.toThrow();
    expect(() => compileSource('@f = (a) { a }\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a Integer) { a }\n')).not.toThrow();
    expect(() => compileSource('@f = (:a) { a }\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (:a Integer) { a }\n')).not.toThrow();
    expect(() => compileSource('@f = (a: (b)) { b }\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a: (b) Integer) { b }\n')).not.toThrow();
    expect(() => compileSource('@f = (a) { a + 1 }\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a) { (a + 1) as Integer }\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a, b) { a + b }\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a, b) { (a + b) as Integer }\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (a Integer, b Integer) { (a + b) as Integer }\n')).not.toThrow();
    expect(() => compileSource('@f = (:a, :b) { a + b }\n')).toThrow(/requires a type annotation/);
    expect(() => compileSource('@f = (:a Integer, :b Integer) { (a + b) as Integer }\n')).not.toThrow();
    expect(() => compileSource('@f = (list List) { list }\n')).not.toThrow();
    expect(() => compileSource('@f = { [1, 2, 3] }\n')).not.toThrow();
    expect(() => compileSource('@f = { [1, 2, 3] as List }\n')).not.toThrow();
  });
});

it('public multi-line braced explicit return', () => {
  expect(() => compileSource('@f = { x = 1\n -> x }\n')).not.toThrow();
  expect(() => compileSource('@f = { x = "abc"\n -> x }\n')).not.toThrow();
  expect(() => compileSource('@f = { x = false\n -> x }\n')).not.toThrow();
  expect(() => compileSource('@f = { x = 1\n -> x as Integer }\n')).not.toThrow();
  expect(() => compileSource('@f = { x = "abc"\n -> x as Text }\n')).not.toThrow();
  expect(() => compileSource('@f = { x = false\n -> x as Boolean }\n')).not.toThrow();
  expect(() => compileSource('@f = (a) { b Integer = a + 1\n -> a }\n')).toThrow();
  expect(() => compileSource('@f = (a Integer) { b Integer = a + 1\n -> a }\n')).not.toThrow();
  expect(() => compileSource('@f = (a, b) { c Integer = a + b\n -> c }\n')).toThrow();
  expect(() => compileSource('@f = (a Integer, b Integer) { c Integer = a + b\n -> c }\n')).not.toThrow();
});

it('public multi-line braced implicit return', () => {
  expect(() => compileSource('@f = { x = 1\n x }\n')).not.toThrow();
  expect(() => compileSource('@f = { x = "abc"\n x }\n')).not.toThrow();
  expect(() => compileSource('@f = { x = false\n x }\n')).not.toThrow();
  expect(() => compileSource('@f = { x = 1\n x as Integer }\n')).not.toThrow();
  expect(() => compileSource('@f = { x = "abc"\n x as Text }\n')).not.toThrow();
  expect(() => compileSource('@f = { x = false\n x as Boolean }\n')).not.toThrow();
  expect(() => compileSource('@f = (a) { b Integer = a + 1\n a }\n')).toThrow();
  expect(() => compileSource('@f = (a Integer) { b Integer = a + 1\n a }\n')).not.toThrow();
  expect(() => compileSource('@f = (a, b) { c Integer = a + b\n c }\n')).toThrow();
  expect(() => compileSource('@f = (a Integer, b Integer) { c Integer = a + b\n c }\n')).not.toThrow();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Delimited form — valid forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('delimited form — valid forms', () => {
  it('no-param direct reply: @test = -> answer: 42 as Integer', () => {
    expect(() => compileSource('@test = -> answer: 42 as Integer\n')).not.toThrow();
  });

  it('parens direct reply: @test = (:x Integer) -> :x', () => {
    expect(() => compileSource('@test = (:x Integer) -> :x\n')).not.toThrow();
  });

  it('bare-param single expr: fn = a -> a + 1', () => {
    expect(() => compileSource(`
      @go
        =
        fn = a -> a + 1
        result Integer = fn(5)
        -> :result
    `)).not.toThrow();
  });

  it('parens braced body — lambda: fn = (a) { a + 1 }', () => {
    expect(() => compileSource(`
      @go
        =
        fn = (a) { a + 1 }
        result Integer = fn(5)
        -> :result
    `)).not.toThrow();
  });

  it('parens braced body with return — lambda: fn = (a) { -> a as Integer }', () => {
    expect(() => compileSource(`
      @go
        =
        fn = (a) { -> a as Integer }
        result Integer = fn(5)
        -> :result
    `)).not.toThrow();
  });

  it('parens braced body with semicolons — lambda: fn = (a) { x = a + 1; x }', () => {
    expect(() => compileSource(`
      @go
        =
        fn = (a) { x = a + 1; x }
        result Integer = fn(5)
        -> :result
    `)).not.toThrow();
  });

  it('rejects type annotation after closing brace: fn = (a) { a + 1 } : Integer', () => {
    expect(() => compileSource(`
      @go
        =
        fn = (a) { a + 1 } : Integer
        result Integer = fn(5)
        -> :result
    `)).toThrow();
  });

  it('multiline braced lambda', () => {
    expect(() => compileSource(`
      @go
        =
        fn = (a) {
          x = a + 1
          x
        }
        result Integer = fn(5)
        -> :result
    `)).not.toThrow();
  });

  it('multiline braced lambda with explicit return', () => {
    expect(() => compileSource(`
      @go
        =
        fn = (a) {
          x Integer = a + 1
          -> x
        }
        result Integer = fn(5)
        -> :result
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Delimited form — valid public function braced body
// ═══════════════════════════════════════════════════════════════════════════════

describe('delimited form — public function braced body', () => {
  it('@test = (:x Integer) { -> :x }', () => {
    expect(() => compileSource('@test = (:x Integer) { -> :x }\n')).not.toThrow();
  });

  it('@test = (:x Integer) { x + 1 }', () => {
    expect(() => compileSource(`
      @go
        =
        result Integer = test(5)
        -> :result

      @test = (:x Integer) { x + 1 }
    `)).not.toThrow();
  });

  it('multiline public function with braced body', () => {
    expect(() => compileSource(`
      @test = (:n Integer) {
        x Integer = n + 1
        -> :x
      }
    `)).not.toThrow();
  });

  it('public function braced body with state mutation', () => {
    expect(() => compileSource(`
      x Integer! = 0
      @inc = (:n Integer) { x <- n; -> :x }
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Delimited form — runtime verification
// ═══════════════════════════════════════════════════════════════════════════════

describe('delimited form — runtime', () => {
  const script = `
    @goBraced
      =
      fn = (a) { a + 1 }
      result Integer = fn(5)
      -> :result

    @goTyped
      =
      fn = (a) { a * 2 }
      result Integer = fn(5)
      -> :result
  `;

  it('braced lambda returns correct value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@goBraced', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });

  it('braced lambda with type annotation returns correct value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@goTyped', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Delimited form — INVALID forms (must fail)
// ═══════════════════════════════════════════════════════════════════════════════

describe('delimited form — invalid forms', () => {
  it('arrow before braces is not legal: fn = (a) -> { a + 1 }', () => {
    expect(() => compileSource(`
      @go
        =
        fn = (a) -> { a + 1 }
        result Integer = fn(5)
        -> :result
    `)).toThrow();
  });

  it('arrow after closing brace is not legal: fn = (a) { ... } -> :result', () => {
    expect(() => compileSource(`
      @go
        =
        fn = (a) { a + 1 } -> :result
        -> :result
    `)).toThrow();
  });

  it('invalid: lineal sigil params on one line should fail', () => {
    expect(() => compileSource('@test = :x Integer = -> :x\n')).toThrow();
  });

  it('invalid: single-line body without parens or braces should fail', () => {
    expect(() => compileSource('@test = x Integer = 42 -> :x\n')).toThrow();
  });

  it('invalid: single-line state mutation without parens or braces should fail', () => {
    expect(() => compileSource('x Integer! = 0\n@inc = x <- x + 1 -> :x\n')).toThrow();
  });

  it('valid delimited: no-param braced body', () => {
    expect(() => compileSource('@test = { -> answer: 42 as Integer }\n')).not.toThrow();
  });

  it('valid delimited: no-param direct reply', () => {
    expect(() => compileSource('@test = -> answer: 42 as Integer\n')).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Delimited form — optional args
// ═══════════════════════════════════════════════════════════════════════════════

describe('delimited form — optional args — compilation', () => {
  it('private: typed positional default', () => {
    expect(() => compileSource('f = (a Integer, b Integer = 0) { a + b }\n')).not.toThrow();
  });

  it('private: inferred positional default', () => {
    expect(() => compileSource('f = (a Integer, b=0) { a + b }\n')).not.toThrow();
  });

  it('private: named typed default', () => {
    expect(() => compileSource('f = (:a Integer, :b Integer = 5) { a + b }\n')).not.toThrow();
  });

  it('private: named := default', () => {
    expect(() => compileSource('f = (:a Integer, :b = 5) { a + b }\n')).not.toThrow();
  });

  it('private: single-expr with default', () => {
    expect(() => compileSource('f = (a Integer, b=0) -> a + b\n')).not.toThrow();
  });

  it('public: typed positional default', () => {
    expect(() => compileSource('@f = (a Integer, b Integer = 0) -> (a + b) as Integer\n')).not.toThrow();
  });

  it('public: inferred positional default', () => {
    expect(() => compileSource('@f = (a Integer, b=0) -> (a + b) as Integer\n')).not.toThrow();
  });

  it('public: named typed default', () => {
    expect(() => compileSource('@f = (:a Integer, :b Integer = 5) -> sum: (a + b) as Integer\n')).not.toThrow();
  });

  it('public: braced body with default', () => {
    expect(() => compileSource('@f = (a Integer, b Integer = 0) { -> (a + b) as Integer }\n')).not.toThrow();
  });
});

describe('delimited form — optional args — runtime', () => {
  const script = `
    @goBoth
      =
      fn = (a Integer, b Integer = 10) { a + b }
      result Integer = fn(3, 5)
      -> :result

    @goDefault
      =
      fn = (a Integer, b Integer = 10) { a + b }
      result Integer = fn(3)
      -> :result

    @goSingleExpr
      =
      fn = (a Integer, b=100) -> a + b
      result Integer = fn(5)
      -> :result
  `;

  it('lambda with default — both provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@goBoth', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 8 }, to: 'c' } },
    );
  });

  it('lambda with default — omitted uses default', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@goDefault', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 13 }, to: 'c' } },
    );
  });

  it('single-expr lambda with inferred default', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@goSingleExpr', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 105 }, to: 'c' } },
    );
  });
});
