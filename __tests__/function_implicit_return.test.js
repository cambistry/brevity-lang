import { expectReply } from './helpers.js';

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

  it.todo('assignment resolves to assigned value — { r = a + 1 }');
});

describe('implicit return — sigil', () => {
  it.todo(':x — return var x under the "x" key');
});

describe('implicit return — positional lists', () => {
  it.todo('a, b — two positionals from vars');
  it.todo('(a, b) — parens');
});

describe('implicit return — named fields', () => {
  it.todo('x: a, y: b — named');
  it.todo('(x: a, y: b) — named with parens');
});

describe('implicit return — mixed', () => {
  it.todo('a, b, x: y — mixed positional + named');
  it.todo('(a, b, x: y) — mixed with parens');
  it.todo('1, "text", c, d: e — mixed with literals');
  it.todo('(1, "text", c, d: e) — mixed with literals in parens');
});

describe('implicit return — structuring', () => {
  it.todo(':x, :y — structuring (means x: x, y: y)');
  it.todo('(:x, :y) — structuring with parens');
});

describe('implicit return — spread', () => {
  it.todo('...args — spreading a Structure');
  it.todo('(...args) — spreading with parens');
});
