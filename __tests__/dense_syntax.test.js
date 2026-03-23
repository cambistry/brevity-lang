import compile from '../index.js';
import { expectReply } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Delimited form — valid forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('delimited form — valid forms', () => {
  it('no-param direct reply: @test = -> answer: 42 as Integer', () => {
    expect(() => compile('@test = -> answer: 42 as Integer\n')).not.toThrow();
  });

  it('pipe direct reply: @test = |:x : Integer| -> :x', () => {
    expect(() => compile('@test = |:x : Integer| -> :x\n')).not.toThrow();
  });

  it('pipe single expr: fn = |a| a + 1', () => {
    expect(() => compile(`
      @go
        =
        fn = |a| a + 1
        result : Integer = fn(5)
        -> :result
    `)).not.toThrow();
  });

  it('pipe braced body — lambda: fn = |a| { a + 1 }', () => {
    expect(() => compile(`
      @go
        =
        fn = |a| { a + 1 }
        result : Integer = fn(5)
        -> :result
    `)).not.toThrow();
  });

  it('pipe braced body with return — lambda: fn = |a| { -> a : Integer }', () => {
    expect(() => compile(`
      @go
        =
        fn = |a| { -> a : Integer }
        result : Integer = fn(5)
        -> :result
    `)).not.toThrow();
  });

  it('pipe braced body with semicolons — lambda: fn = |a| { x = a + 1; x }', () => {
    expect(() => compile(`
      @go
        =
        fn = |a| { x = a + 1; x }
        result : Integer = fn(5)
        -> :result
    `)).not.toThrow();
  });

  it('type annotation after closing brace: fn = |a| { a + 1 } : Integer', () => {
    expect(() => compile(`
      @go
        =
        fn = |a| { a + 1 } : Integer
        result : Integer = fn(5)
        -> :result
    `)).not.toThrow();
  });

  it('multiline braced lambda', () => {
    expect(() => compile(`
      @go
        =
        fn = |a| {
          x = a + 1
          x
        }
        result : Integer = fn(5)
        -> :result
    `)).not.toThrow();
  });

  it('multiline braced lambda with explicit return', () => {
    expect(() => compile(`
      @go
        =
        fn = |a| {
          x : Integer = a + 1
          -> x
        }
        result : Integer = fn(5)
        -> :result
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Delimited form — valid public function braced body
// ═══════════════════════════════════════════════════════════════════════════════

describe('delimited form — public function braced body', () => {
  it('@test = |:x : Integer| { -> :x }', () => {
    expect(() => compile('@test = |:x : Integer| { -> :x }\n')).not.toThrow();
  });

  it('@test = |:x : Integer| { x + 1 } : Integer', () => {
    expect(() => compile(`
      @go
        =
        result : Integer = test(5)
        -> :result

      @test = |:x : Integer| { x + 1 } : Integer
    `)).not.toThrow();
  });

  it('multiline public function with braced body', () => {
    expect(() => compile(`
      @test = |:n : Integer| {
        x : Integer = n + 1
        -> :x
      }
    `)).not.toThrow();
  });

  it('public function braced body with state mutation', () => {
    expect(() => compile(`
      ref x : Integer = 0
      @inc = |:n : Integer| { x <- n; -> :x }
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Delimited form — runtime verification
// ═══════════════════════════════════════════════════════════════════════════════

describe('delimited form — runtime', () => {
  it('braced lambda returns correct value', async () => {
    await expectReply({
      script: `
        @go
          =
          fn = |a| { a + 1 }
          result : Integer = fn(5)
          -> :result
      `,
      receive: { id: '1', op: '@go', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' },
    });
  });

  it('braced lambda with type annotation returns correct value', async () => {
    await expectReply({
      script: `
        @go
          =
          fn = |a| { a * 2 } : Integer
          result : Integer = fn(5)
          -> :result
      `,
      receive: { id: '1', op: '@go', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Delimited form — INVALID forms (must fail)
// ═══════════════════════════════════════════════════════════════════════════════

describe('delimited form — invalid forms', () => {
  it('arrow before braces is not legal: fn = |a| -> { a + 1 }', () => {
    expect(() => compile(`
      @go
        =
        fn = |a| -> { a + 1 }
        result : Integer = fn(5)
        -> :result
    `)).toThrow();
  });

  it('arrow after closing brace is not legal: fn = |a| { ... } -> :result', () => {
    expect(() => compile(`
      @go
        =
        fn = |a| { a + 1 } -> :result
        -> :result
    `)).toThrow();
  });

  it('invalid: lineal sigil params on one line should fail', () => {
    expect(() => compile('@test = :x : Integer = -> :x\n')).toThrow();
  });

  it('invalid: single-line body without pipes or braces should fail', () => {
    expect(() => compile('@test = x : Integer = 42 -> :x\n')).toThrow();
  });

  it('invalid: single-line state mutation without pipes or braces should fail', () => {
    expect(() => compile('ref x : Integer = 0\n@inc = x <- x + 1 -> :x\n')).toThrow();
  });

  it('valid delimited: no-param braced body', () => {
    expect(() => compile('@test = { -> answer: 42 as Integer }\n')).not.toThrow();
  });

  it('valid delimited: no-param direct reply', () => {
    expect(() => compile('@test = -> answer: 42 as Integer\n')).not.toThrow();
  });
});
