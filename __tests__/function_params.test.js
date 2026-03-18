import { expectReply } from './helpers.js';

describe('function params — named via sigil', () => {
  it('|:name| binds named field', async () => {
    const source = `
      @go
        =
        fn = |:name| { name }
        result : Integer = fn(name: 42)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'caller' },
    });
  });

  it('|:n : Integer| with typed sigil', async () => {
    const source = `
      @go
        =
        fn = |:n : Integer| { n * 2 }
        result : Integer = fn(n: 5)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'caller' },
    });
  });
});

describe('function params — key-mapped', () => {
  it('|label: x| binds key to local name', async () => {
    const source = `
      @go
        =
        fn = |label: x| { x + 1 }
        result : Integer = fn(label: 9)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'caller' },
    });
  });

  it('|first: a, last: b| two key-mapped params', async () => {
    const source = `
      @go
        =
        fn = |first: a, last: b| { a + b }
        result : Integer = fn(first: 3, last: 4)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'caller' },
    });
  });
});

describe('function params — mixed positional and named', () => {
  it('|a, :b| binds positional and named', async () => {
    const source = `
      @go
        =
        fn = |a, :b| { a + b }
        result : Integer = fn(3, b: 4)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'caller' },
    });
  });

  it('|:a, :b| two named-only params', async () => {
    const source = `
      @go
        =
        fn = |:a, :b| { a + b }
        result : Integer = fn(a: 10, b: 20)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 30 }, to: 'caller' },
    });
  });
});

// ─── pipe style only — no open style ─────────────────────────────────────────

describe('function params — pipe style only (no open style)', () => {
  it('function params always require pipes', async () => {
    const source = `
      @go
        =
        fn = |a, b| { a + b }
        result : Integer = fn(3, 4)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'caller' },
    });
  });

  it('function with no params omits pipes, uses bare braces', async () => {
    const source = `
      @go
        =
        fn = { 42 }
        result : Integer = fn()
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'caller' },
    });
  });
});
