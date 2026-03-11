import compile from '../index.js';
import { expectReply } from './helpers.js';

// ─── same-line no-paren ───────────────────────────────────────────────────────

describe('on params — same-line no-paren', () => {
  it('single named param :n : Integer', async () => {
    const source = `
      on go :n : Integer
        reply :n
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ n: 42 }, 'go'], 'bv-a': [{ n: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ n: 'Integer' }], re: [{ n: 42 }, 'go'], to: 'caller' },
    });
  });

  it('two named params :n : Integer, :m : Integer', async () => {
    const source = `
      on go :n : Integer, :m : Integer
        reply sum: n + m : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ n: 3, m: 4 }, 'go'], 'bv-a': [{ n: 'Integer', m: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ sum: 'Integer' }], re: [{ sum: 7 }, 'go'], to: 'caller' },
    });
  });

  it('positional param n : Integer', async () => {
    const source = `
      on go n : Integer
        reply n : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[99], 'go'], 'bv-a': [['Integer']], from: 'caller' },
      reply: { id: '1', 'bv-a': [['Integer']], re: [[99], 'go'], to: 'caller' },
    });
  });

  it('two positional params a : Integer, b : Integer', async () => {
    const source = `
      on add a : Integer, b : Integer
        reply sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[5, 6], 'add'], 'bv-a': [['Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ sum: 'Integer' }], re: [{ sum: 11 }, 'add'], to: 'caller' },
    });
  });

  it('body follows on next line without blank line', async () => {
    // same-line explicit: body may immediately follow on next line
    const source = `
      on ping :x : Integer
        reply :x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ x: 7 }, 'ping'], 'bv-a': [{ x: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ x: 'Integer' }], re: [{ x: 7 }, 'ping'], to: 'caller' },
    });
  });

});

// ─── open style ──────────────────────────────────────────────────────────────

describe('on params — open style', () => {
  it('no params — blank line after on name', async () => {
    const source = `
      on hello

        reply answer: "world" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'hello', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ answer: 'Text' }], re: [{ answer: 'world' }, 'hello'], to: 'caller' },
    });
  });

  it('single param :n : Integer blank-line terminated', async () => {
    const source = `
      on go
        :n : Integer

        reply :n
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ n: 10 }, 'go'], 'bv-a': [{ n: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ n: 'Integer' }], re: [{ n: 10 }, 'go'], to: 'caller' },
    });
  });

  it('two params blank-line terminated', async () => {
    const source = `
      on add
        :a : Integer
        :b : Integer

        reply sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 10, b: 20 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ sum: 'Integer' }], re: [{ sum: 30 }, 'add'], to: 'caller' },
    });
  });

  it('single param terminated by -- comment', async () => {
    const source = `
      on go
        :n : Integer
        --
        reply :n
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ n: 55 }, 'go'], 'bv-a': [{ n: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ n: 'Integer' }], re: [{ n: 55 }, 'go'], to: 'caller' },
    });
  });

  it('single param terminated by bare //', async () => {
    const source = `
      on go
        :n : Integer
        //
        reply :n
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ n: 33 }, 'go'], 'bv-a': [{ n: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ n: 'Integer' }], re: [{ n: 33 }, 'go'], to: 'caller' },
    });
  });

  it('multiple handlers: open style does not bleed into next handler', async () => {
    const source = `
      on foo
        :x : Integer

        reply :x

      on bar
        :y : Integer

        reply :y
    `;
    await expectReply({
      source,
      receive: [
        { id: '1', op: [{ x: 1 }, 'foo'], 'bv-a': [{ x: 'Integer' }], from: 'caller' },
        { id: '2', op: [{ y: 2 }, 'bar'], 'bv-a': [{ y: 'Integer' }], from: 'caller' },
      ],
      reply: [
        { id: '1', 'bv-a': [{ x: 'Integer' }], re: [{ x: 1 }, 'foo'], to: 'caller' },
        { id: '2', 'bv-a': [{ y: 'Integer' }], re: [{ y: 2 }, 'bar'], to: 'caller' },
      ],
    });
  });
});

// ─── invalid ─────────────────────────────────────────────────────────────────

describe('on params — invalid (compile throws)', () => {
  it('no-paren args and body on same line — ambiguous, not allowed', () => {
    // parens required if body follows on the same line
    const source = 'on go :n : Integer reply :n\n';
    expect(() => compile(source)).toThrow();
  });

  it('on go\\n body — CR after name, body immediately (no parens, no blank line)', () => {
    const source = `
      on go
        reply answer: "world" : Text
    `;
    expect(() => compile(source)).toThrow();
  });

  it('open-style param without blank-line terminator before body', () => {
    const source = `
      on go
        :n : Integer
        reply :n
    `;
    expect(() => compile(source)).toThrow();
  });

  it('// with content does not terminate open-style params', () => {
    // only bare // (empty) counts as a terminator, not // comment text
    const source = `
      on go
        :n : Integer
        // end params
        reply :n
    `;
    expect(() => compile(source)).toThrow();
  });

  it('-- with content does not terminate open-style params', () => {
    const source = `
      on go
        :n : Integer
        -- end params
        reply :n
    `;
    expect(() => compile(source)).toThrow();
  });

  it('same-line param then open-style continuation on next line', () => {
    // args started on same line → can't continue to next line
    const source = `
      on go :n : Integer
        :m : Integer

        reply :n
    `;
    // :m : Integer is treated as body — no value → compile error
    expect(() => compile(source)).toThrow();
  });
});
