import compile from '../index.js';
import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — ref + put (no shared state across tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('repeat while — ref + put', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @countdown
        =
        ref x : Integer = 5
        repeat while x > 0 {
          x <- x - 1
        }
        -> :x

      @parenCondition
        =
        ref x : Integer = 4
        repeat while (x > 0) {
          x <- x - 1
        }
        -> :x

      @singleLinePut
        =
        ref x : Integer = 3
        repeat while x > 0 x <- x - 1
        -> :x

      @nullNeverRuns
        =
        fn = {
          repeat while false { }
        } : Integer | null
        result : Integer | null = fn()
        -> :result
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@countdown', from: 'c' },
        { id: '2', op: '@parenCondition', from: 'c' },
        { id: '3', op: '@singleLinePut', from: 'c' },
        { id: '4', op: '@nullNeverRuns', from: 'c' },
      ],
    });
  });

  it('counts down with ref and put', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'c' });
  });

  it('parens around condition with block body', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'c' });
  });

  it('single-line put form', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'c' });
  });

  it('at end of function returns null (block never runs)', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { result: 'Integer | null' }, re: { result: null }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Stateful tests — actor-level ref state, each needs its own actor instance
// ═══════════════════════════════════════════════════════════════════════════════

describe('repeat while — state mutation loop', () => {
  it('drains x to 0 and accumulates y to 10', async () => {
    const posts = await runActor({
      source: `
        ref x : Integer = 10
        ref y : Integer = 0

        @drain
          =
        repeat while x > 0 {
          x <- x - 1
          y <- y + 1
        }
        -> x, y : Integer
      `,
      receive: [
        { id: '1', op: '@drain', from: 'c' },
      ],
    });
    expect(posts[0]).toEqual(expect.objectContaining({ id: '1', re: [0, 10], to: 'c' }));
  });
});

describe('repeat while — parenthesized condition (stateful)', () => {
  it('parens around condition with block body', async () => {
    const posts = await runActor({
      source: `
        ref x : Integer = 3

        @test
          =
        repeat while (x > 0) {
          x <- x - 1
        }
        -> x : Integer
      `,
      receive: [{ id: '1', op: '@test', from: 'c' }],
    });
    expect(posts[0]).toEqual(expect.objectContaining({ id: '1', re: [0], to: 'c' }));
  });

  it('parens around condition with single-line body', async () => {
    const posts = await runActor({
      source: `
        ref x : Integer = 3

        @test
          =
        repeat while (x > 0) x <- x - 1
        -> x : Integer
      `,
      receive: [{ id: '1', op: '@test', from: 'c' }],
    });
    expect(posts[0]).toEqual(expect.objectContaining({ id: '1', re: [0], to: 'c' }));
  });
});

describe('repeat while — single-line body (stateful)', () => {
  it('bare condition with single-line put', async () => {
    const posts = await runActor({
      source: `
        ref x : Integer = 5

        @test
          =
        repeat while x > 0 x <- x - 1
        -> x : Integer
      `,
      receive: [{ id: '1', op: '@test', from: 'c' }],
    });
    expect(posts[0]).toEqual(expect.objectContaining({ id: '1', re: [0], to: 'c' }));
  });
});

describe('repeat while — lexical scope', () => {
  it('reads and writes actor state inside block body', async () => {
    const posts = await runActor({
      source: `
        ref x : Integer = 0

        @test
          =
          step : Integer
          =
        repeat while x < 9 {
          x <- x + step
        }
        -> x : Integer
      `,
      receive: [{ id: '1', op: [[3], '@test'], 'bv-a': [['Integer']], from: 'c' }],
    });
    expect(posts[0]).toEqual(expect.objectContaining({ id: '1', re: [9], to: 'c' }));
  });

  it('reads and writes actor state inside single-line body', async () => {
    const posts = await runActor({
      source: `
        ref x : Integer = 0

        @test
          =
          limit : Integer
          =
        repeat while x < limit x <- x + 1
        -> x : Integer
      `,
      receive: [{ id: '1', op: [[5], '@test'], 'bv-a': [['Integer']], from: 'c' }],
    });
    expect(posts[0]).toEqual(expect.objectContaining({ id: '1', re: [5], to: 'c' }));
  });
});

describe('repeat while — evaluates to null (stateful)', () => {
  it('at end of function returns null (block runs)', async () => {
    const posts = await runActor({
      source: `
        ref x : Integer = 3

        @test
          =
        fn = {
          repeat while x > 0 {
            x <- x - 1
          }
        } : Integer | null
        result : Integer | null = fn()
        -> x, :result
      `,
      receive: [{ id: '1', op: '@test', from: 'c' }],
    });
    expect(posts[0]).toEqual(expect.objectContaining({ id: '1', re: [0, { result: null }], to: 'c' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors (no build needed — instant)
// ═══════════════════════════════════════════════════════════════════════════════

describe('repeat while — compile errors', () => {
  it('plain assignment to outer-scope variable in block body → compile error', () => {
    expect(() => compile(`
      @test
        =
        x : Integer = 0
        repeat while true {
          x = 1
        }
        -> :x
    `)).toThrow(/re-bind.*'x'|'x'.*re-bind|cannot re-bind/i);
  });

  it('plain assignment to outer-scope variable in single-line body → compile error', () => {
    expect(() => compile(`
      @test
        =
        x : Integer = 0
        repeat while true x = 1
        -> :x
    `)).toThrow(/re-bind.*'x'|'x'.*re-bind|cannot re-bind/i);
  });

  it('non-nullable return type from while → compile error', () => {
    expect(() => compile(`
      @test
        =
        fn = {
          repeat while false { }
        } : Integer
        result : Integer = fn()
        -> :result
    `)).toThrow(/while always evaluates to null/i);
  });
});
