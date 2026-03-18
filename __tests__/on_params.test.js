import compile from '../index.js';
import { expectReply } from './helpers.js';

// ─── same-line no-paren ───────────────────────────────────────────────────────

describe('@params — same-line no-paren', () => {
  it('single named param :n : Integer', async () => {
    const source = `
      @go :n : Integer
        -> :n
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ n: 42 }, 'go'], 'bv-a': [{ n: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { n: 'Integer' }, re: { n: 42 }, to: 'caller' },
    });
  });

  it('two named params :n : Integer, :m : Integer', async () => {
    const source = `
      @go :n : Integer, :m : Integer
        -> sum: n + m : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ n: 3, m: 4 }, 'go'], 'bv-a': [{ n: 'Integer', m: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'caller' },
    });
  });

  it('positional param n : Integer', async () => {
    const source = `
      @go n : Integer
        -> n : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[99], 'go'], 'bv-a': [['Integer']], from: 'caller' },
      reply: { id: '1', 'bv-a': ['Integer'], re: [99], to: 'caller' },
    });
  });

  it('two positional params a : Integer, b : Integer', async () => {
    const source = `
      @add a : Integer, b : Integer
        -> sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[5, 6], 'add'], 'bv-a': [['Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 11 }, to: 'caller' },
    });
  });

  it('body follows on next line without blank line', async () => {
    // same-line explicit: body may immediately follow on next line
    const source = `
      @ping :x : Integer
        -> :x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ x: 7 }, 'ping'], 'bv-a': [{ x: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 7 }, to: 'caller' },
    });
  });

});

// ─── spacious style ──────────────────────────────────────────────────────────────

describe('on params — open style', () => {
  it('no params — blank line after on name', async () => {
    const source = `
      @hello
        =
        -> answer: "world" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'hello', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'caller' },
    });
  });

  it('single param :n : Integer blank-line terminated', async () => {
    const source = `
      @go
        =
        :n : Integer
        =
        -> :n
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ n: 10 }, 'go'], 'bv-a': [{ n: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { n: 'Integer' }, re: { n: 10 }, to: 'caller' },
    });
  });

  it('two params blank-line terminated', async () => {
    const source = `
      @add
        =
        :a : Integer
        :b : Integer
        =
        -> sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 10, b: 20 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 30 }, to: 'caller' },
    });
  });

  it('single param terminated by -- comment', async () => {
    const source = `
      @go
        =
        :n : Integer
        =
        -> :n
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ n: 55 }, 'go'], 'bv-a': [{ n: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { n: 'Integer' }, re: { n: 55 }, to: 'caller' },
    });
  });

  it('single param terminated by bare //', async () => {
    const source = `
      @go
        =
        :n : Integer
        =
        -> :n
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ n: 33 }, 'go'], 'bv-a': [{ n: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { n: 'Integer' }, re: { n: 33 }, to: 'caller' },
    });
  });

  it('multiple handlers: open style does not bleed into next handler', async () => {
    const source = `
      @foo
        =
        :x : Integer
        =
        -> :x

      @bar
        =
        :y : Integer
        =
        -> :y
    `;
    await expectReply({
      source,
      receive: [
        { id: '1', op: [{ x: 1 }, 'foo'], 'bv-a': [{ x: 'Integer' }], from: 'caller' },
        { id: '2', op: [{ y: 2 }, 'bar'], 'bv-a': [{ y: 'Integer' }], from: 'caller' },
      ],
      reply: [
        { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 1 }, to: 'caller' },
        { id: '2', 'bv-a': { y: 'Integer' }, re: { y: 2 }, to: 'caller' },
      ],
    });
  });
});

// ─── invalid ─────────────────────────────────────────────────────────────────

describe('on params — invalid (compile throws)', () => {
  it('no-paren args and body on same line — ambiguous, not allowed', () => {
    // parens required if body follows on the same line
    const source = '@go :n : Integer -> :n\n';
    expect(() => compile(source)).toThrow();
  });

  it('@go\\n body — CR after name, body immediately (no parens, no blank line)', () => {
    const source = `
      @go
        -> answer: "world" : Text
    `;
    expect(() => compile(source)).toThrow();
  });

  it('// with content does not terminate open-style params', () => {
    // only bare // (empty) counts as a terminator, not // comment text
    const source = `
      @go
        =
        :n : Integer
        // end params
        -> :n
    `;
    expect(() => compile(source)).toThrow();
  });

  it('-- with content does not terminate open-style params', () => {
    const source = `
      @go
        =
        :n : Integer
        -- end params
        -> :n
    `;
    expect(() => compile(source)).toThrow();
  });

  it('same-line param then open-style continuation @next line', () => {
    // args started on same line → can't continue to next line
    const source = `
      @go :n : Integer
        :m : Integer

        -> :n
    `;
    // :m : Integer is treated as body — no value → compile error
    expect(() => compile(source)).toThrow();
  });
});
