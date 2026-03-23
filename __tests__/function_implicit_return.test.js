import { expectReply } from './helpers.js';

const _target = globalThis.BREVITY_TARGET || process.env.BREVITY_TARGET || 'js';

// ═══════════════════════════════════════════════════════════════════════════════
// Implicit return from curly-brace functions
//
// In a { body } block, the last expression is the return value.
// The syntax is the same as what would follow -> in an explicit return.
// ═══════════════════════════════════════════════════════════════════════════════

describe('implicit return — single value', () => {
  it('integer expression', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = |a| { a + 1 }
          result : Integer = fn(5)
          -> :result
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' },
    });
  });

  it('integer expression with explicit type annotation', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = |a| { a + 1 } : Integer
          result : Integer = fn(5)
          -> :result
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' },
    });
  });

  it('string literal', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = || { "hello" }
          result : Text = fn()
          -> :result
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' },
    });
  });

  it('boolean literal', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = || { true }
          result : Boolean = fn()
          -> :result
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Boolean' }, re: { result: true }, to: 'c' },
    });
  });

  it('variable reference', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = |a| { x = a * 2; x }
          result : Integer = fn(4)
          -> :result
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 8 }, to: 'c' },
    });
  });

  it('assignment resolves to assigned value', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = |a| { r = a + 1 }
          result : Integer = fn(5)
          -> :result
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' },
    });
  });
});

describe('implicit return — sigil', () => {
  it(':x — return var x under the "x" key', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = |a| { x = a + 1; :x }
          :x = fn(5)
          -> :x
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', re: { x: 6 }, to: 'c' },
    });
  });
});

describe('implicit return — positional lists', () => {
  it('a, b — two positionals from vars', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = |a, b| { a, b }
          x, y = fn(3, 4)
          -> :x, :y
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', re: { x: 3, y: 4 }, to: 'c' },
    });
  });

  it('(a, b) — with parens', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = |a, b| { (a, b) }
          x, y = fn(3, 4)
          -> :x, :y
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', re: { x: 3, y: 4 }, to: 'c' },
    });
  });
});

describe('implicit return — named fields', () => {
  it('x: a, y: b — named', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = |a, b| { x: a, y: b }
          :x, :y = fn(10, 20)
          -> :x, :y
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', re: { x: 10, y: 20 }, to: 'c' },
    });
  });

  it('(x: a, y: b) — named with parens', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = |a, b| { (x: a, y: b) }
          :x, :y = fn(10, 20)
          -> :x, :y
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', re: { x: 10, y: 20 }, to: 'c' },
    });
  });
});

describe('implicit return — mixed', () => {
  it('a, b, x: y — mixed positional + named', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = |a, b, c| { a, b, extra: c }
          x, y, :extra = fn(1, 2, 3)
          -> :x, :y, :extra
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', re: { x: 1, y: 2, extra: 3 }, to: 'c' },
    });
  });

  it('(a, b, x: y) — mixed with parens', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = |a, b, c| { (a, b, extra: c) }
          x, y, :extra = fn(1, 2, 3)
          -> :x, :y, :extra
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', re: { x: 1, y: 2, extra: 3 }, to: 'c' },
    });
  });

  it('1, "text", c, d: e — mixed with literals', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = |c, e| { 1 as Integer, "text" as Text, c, d: e }
          a, b, x, :d = fn(99, 77)
          -> :a, :b, :x, :d
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', re: { a: 1, b: 'text', x: 99, d: 77 }, to: 'c' },
    });
  });

  it('(1, "text", c, d: e) — mixed with literals in parens', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = |c, e| { (1 as Integer, "text" as Text, c, d: e) }
          a, b, x, :d = fn(99, 77)
          -> :a, :b, :x, :d
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', re: { a: 1, b: 'text', x: 99, d: 77 }, to: 'c' },
    });
  });
});

describe('implicit return — structuring', () => {
  it(':x, :y — structuring (means x: x, y: y)', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = |a, b| { x = a + 1; y = b + 2; :x, :y }
          :x, :y = fn(3, 4)
          -> :x, :y
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', re: { x: 4, y: 6 }, to: 'c' },
    });
  });

  it('(:x, :y) — structuring with parens', async () => {
    await expectReply({
      script: `
        @test
          =
          fn = |a, b| { x = a + 1; y = b + 2; (:x, :y) }
          :x, :y = fn(3, 4)
          -> :x, :y
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', re: { x: 4, y: 6 }, to: 'c' },
    });
  });
});

// Rust: Structure-typed variable in lambda doesn't preserve full structure (known gap)
const spreadDescribe = _target === 'rust' ? describe.skip : describe;

spreadDescribe('implicit return — spread', () => {
  it('...args — spreading a Structure', async () => {
    await expectReply({
      script: `
        inner
          =
          a : Integer
          b : Integer
          =
          -> (x: a as Integer, y: b as Integer)

        @test
          =
          fn = || { args : Structure = inner(3, 4); ...args }
          :x, :y = fn()
          -> :x, :y
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', re: { x: 3, y: 4 }, to: 'c' },
    });
  });

  it('(...args) — spreading with parens', async () => {
    await expectReply({
      script: `
        inner
          =
          a : Integer
          b : Integer
          =
          -> (x: a as Integer, y: b as Integer)

        @test
          =
          fn = || { args : Structure = inner(3, 4); (...args) }
          :x, :y = fn()
          -> :x, :y
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', re: { x: 3, y: 4 }, to: 'c' },
    });
  });
});
