import { expectReply } from './helpers.js';

describe('function return — implicit (curly body)', () => {
  it('{ expr } still implicitly wraps final expression', async () => {
    const source = `
      @go()
        fn = |a| { a + 1 }
        result : Integer = fn(5)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'caller' },
    });
  });

  it('body with assign then implicit return', async () => {
    const source = `
      @go()
        fn = |a| {
          x = a * 2
          x + 1
        }
        result : Integer = fn(4)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 9 }, to: 'caller' },
    });
  });
});

describe('function return — explicit positional', () => {
  it('return (x : Integer) returns positional structure', async () => {
    const source = `
      @go()
        fn = |a| {
          x = a + 1
          -> (x : Integer)
        }
        result : Integer = fn(5)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'caller' },
    });
  });

  it('return (a : Integer, b : Integer) multi-positional', async () => {
    const source = `
      @go()
        fn = |a, b| {
          -> (a : Integer, b : Integer)
        }
        x, y = fn(3, 4)
        -> :x, :y
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', re: { x: 3, y: 4 }, to: 'caller' },
    });
  });
});

describe('function return — explicit named', () => {
  it('return (:x) returns named structure', async () => {
    const source = `
      @go()
        fn = |a| {
          x = a + 1
          -> (:x)
        }
        :x = fn(5)
        -> :x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', re: { x: 6 }, to: 'caller' },
    });
  });

  it('return (result: a + 1) named with expression', async () => {
    const source = `
      @go()
        fn = |a| {
          -> (result: a + 1 : Integer)
        }
        :result : Integer = fn(5)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'caller' },
    });
  });
});

describe('function return — before end (early exit)', () => {
  it('return followed by dead code returns the early value', async () => {
    const source = `
      @go()
        fn = |a| {
          -> (a : Integer)
          a + 999
        }
        result : Integer = fn(5)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'caller' },
    });
  });
});

describe('function return — no-paren explicit (same-line)', () => {
  it('return a — bare positional variable', async () => {
    const source = `
      @go()
        fn = |a| {
          -> a
        }
        result : Integer = fn(42)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'caller' },
    });
  });

  it('return a, b — two bare positionals', async () => {
    const source = `
      @go()
        fn = |a, b| {
          -> a, b
        }
        x, y = fn(3, 4)
        -> :x, :y
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', re: { x: 3, y: 4 }, to: 'caller' },
    });
  });

  it('return :a — sigil no-paren', async () => {
    const source = `
      @go()
        fn = |a| {
          -> :a
        }
        :a = fn(99)
        -> :a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', re: { a: 99 }, to: 'caller' },
    });
  });

  it('return a: x — key-value no-paren', async () => {
    const source = `
      @go()
        fn = |a| {
          -> result: a
        }
        :result : Integer = fn(7)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'caller' },
    });
  });

  it('return a : Integer — typed positional no-paren (single)', async () => {
    const source = `
      @go()
        fn = |a| {
          -> a : Integer
        }
        result : Integer = fn(13)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 13 }, to: 'caller' },
    });
  });
});

describe('function return — plain assignment arity', () => {
  it('plain assign from function returning 2 positionals throws at runtime', async () => {
    const source = `
      @go()
        fn = |x| { -> (x : Integer, x : Integer) }
        a : Integer = fn(5)
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', ex: { go: 'error' }, to: 'caller' },
    });
  });
});
