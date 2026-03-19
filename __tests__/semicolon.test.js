import { expectReply, runActor } from './helpers.js';

// ── Semicolon as newline synonym ─────────────────────────────────────────────

describe('semicolon — statement separator in handler body', () => {
  it('two statements on one line', async () => {
    const posts = await runActor({
      source: `
        init
          $x : Integer = 0

        @test
          =
          $x = 42; -> $x : Integer
      `,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: [42], to: 'caller' }));
  });

  it('three statements @one line', async () => {
    const posts = await runActor({
      source: `
        init
          $a : Integer = 0
          $b : Integer = 0

        @test
          =
          $a = 1; $b = 2; -> a: $a : Integer, b: $b : Integer
      `,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: { a: 1, b: 2 }, to: 'caller' }));
  });
});

describe('semicolon — function body', () => {
  it('braced function body with semicolons', async () => {
    const posts = await runActor({
      source: `
        init
          $a : Integer = 0
          $b : Integer = 0

        @test
          =
          apply = |x| { $a = x; $b = x + 1; . }
          apply(10)
          -> a: $a : Integer, b: $b : Integer
      `,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: { a: 10, b: 11 }, to: 'caller' }));
  });
});

describe('semicolon — spacious param declaration', () => {
  it('handler params separated by semicolons', async () => {
    await expectReply({
      source: `@add; =; :a : Integer; :b : Integer\n =\n  -> sum: a + b : Integer\n`,
      receive: { id: '1', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'caller' },
    });
  });
});

describe('semicolon — function body', () => {
  it('function body with semicolons', async () => {
    const posts = await runActor({
      source: `
        init
          $x : Integer = 0

        @test
          =
          spawn bump(); repeat while ($x == 0) __tick__()
          -> $x : Integer

        bump
          =
          $x = 1; .
      `,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: [1], to: 'caller' }),
    ]));
  });
});

describe('semicolon — init block', () => {
  it('state vars separated by semicolons', async () => {
    const posts = await runActor({
      source: `
        init; $a : Integer = 1; $b : Integer = 2

        @test
          =
          -> a: $a : Integer, b: $b : Integer
      `,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: { a: 1, b: 2 }, to: 'caller' }));
  });
});

describe('semicolon — mixed with newlines', () => {
  it('semicolons and newlines freely mixed', async () => {
    const posts = await runActor({
      source: `
        init
          $a : Integer = 0; $b : Integer = 0

        @test
          =
          $a = 5
          $b = 10; -> a: $a : Integer, b: $b : Integer
      `,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: { a: 5, b: 10 }, to: 'caller' }));
  });
});
