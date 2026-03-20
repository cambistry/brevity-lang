import { runActor } from './helpers.js';

// Stateful tests use actor-level ref state.

describe('semicolon — statement separator', () => {
  it('two statements on one line', async () => {
    const posts = await runActor({
      source: `
        ref x : Integer = 0

        @test
          =
          x <- 42; -> x : Integer
      `,
      receive: [{ id: '1', op: 'test', from: 'c' }],
    });
    expect(posts[0]).toEqual(expect.objectContaining({ id: '1', re: [42], to: 'c' }));
  });

  it('three statements on one line', async () => {
    const posts = await runActor({
      source: `
        ref a : Integer = 0
        ref b : Integer = 0

        @test
          =
          a <- 1; b <- 2; -> a: a : Integer, b: b : Integer
      `,
      receive: [{ id: '1', op: 'test', from: 'c' }],
    });
    expect(posts[0]).toEqual(expect.objectContaining({ id: '1', re: { a: 1, b: 2 }, to: 'c' }));
  });
});

describe('semicolon — function body', () => {
  it('braced function body with semicolons', async () => {
    const posts = await runActor({
      source: `
        ref a : Integer = 0
        ref b : Integer = 0

        @test
          =
          apply = |x| { a <- x; b <- x + 1; . }
          apply(10)
          -> a: a : Integer, b: b : Integer
      `,
      receive: [{ id: '1', op: 'test', from: 'c' }],
    });
    expect(posts[0]).toEqual(expect.objectContaining({ id: '1', re: { a: 10, b: 11 }, to: 'c' }));
  });

  it('function body with semicolons + spawn', async () => {
    const posts = await runActor({
      source: `
        ref x : Integer = 0

        @test
          =
          spawn bump(); repeat while (x == 0) __tick__()
          -> x : Integer

        bump
          =
          x <- 1; .
      `,
      receive: [{ id: '1', op: 'test', from: 'c' }],
    });
    expect(posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: [1], to: 'c' }),
    ]));
  });
});

describe('semicolon — spacious param declaration', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `@add; =; :a : Integer; :b : Integer\n =\n  -> sum: (a + b) as Integer\n`,
      receive: [
        { id: '1', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
      ],
    });
  });

  it('public function params separated by semicolons', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' });
  });
});

describe('semicolon — ref declaration', () => {
  it('ref state vars separated by semicolons', async () => {
    const posts = await runActor({
      source: `
        ref a : Integer = 1; ref b : Integer = 2

        @test
          =
          -> a: a : Integer, b: b : Integer
      `,
      receive: [{ id: '1', op: 'test', from: 'c' }],
    });
    expect(posts[0]).toEqual(expect.objectContaining({ id: '1', re: { a: 1, b: 2 }, to: 'c' }));
  });
});

describe('semicolon — mixed with newlines', () => {
  it('semicolons and newlines freely mixed', async () => {
    const posts = await runActor({
      source: `
        ref a : Integer = 0; ref b : Integer = 0

        @test
          =
          a <- 5
          b <- 10; -> a: a : Integer, b: b : Integer
      `,
      receive: [{ id: '1', op: 'test', from: 'c' }],
    });
    expect(posts[0]).toEqual(expect.objectContaining({ id: '1', re: { a: 5, b: 10 }, to: 'c' }));
  });
});
