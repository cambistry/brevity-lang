import compile from '../index.js';
import { expectReply } from './helpers.js';

// ─── same-line no-paren ───────────────────────────────────────────────────────

describe('proc params — same-line no-paren', () => {
  it('single named param :n : Integer (call with named arg)', async () => {
    const source = `
      @go()
        result: x : Integer = double(n: 21)
        -> :x

      proc double :n : Integer
        -> result: n * 2 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'caller' },
    });
  });

  it('two named params :a : Integer, :b : Integer (call with named args)', async () => {
    const source = `
      @go()
        result: s : Integer = add(a: 3, b: 4)
        -> :s

      proc add :a : Integer, :b : Integer
        -> result: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { s: 'Integer' }, re: { s: 7 }, to: 'caller' },
    });
  });

  it('positional param n : Integer', async () => {
    const source = `
      @go()
        result: x : Integer = triple(5)
        -> :x

      proc triple n : Integer
        -> result: n * 3 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 15 }, to: 'caller' },
    });
  });

  it('body follows on next line without blank line', async () => {
    const source = `
      @go()
        result: x : Integer = inc(9)
        -> :x

      proc inc n : Integer
        -> result: n + 1 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'caller' },
    });
  });
});

// ─── paren style (already tested in proc.test.js, here for completeness) ─────

describe('proc params — paren style', () => {
  it('proc(n : Integer) — explicit paren style', async () => {
    const source = `
      @go()
        result: x : Integer = sq(7)
        -> :x

      proc sq(n : Integer)
        -> result: n * n : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 49 }, to: 'caller' },
    });
  });

  it('proc() — empty parens, no params', async () => {
    const source = `
      @go()
        result: x : Integer = const()
        -> :x

      proc const()
        -> result: 42 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'caller' },
    });
  });
});

// ─── open style ──────────────────────────────────────────────────────────────

describe('proc params — open style', () => {
  it('single param n : Integer blank-line terminated', async () => {
    const source = `
      @go()
        result: x : Integer = double(10)
        -> :x

      proc double
        n : Integer

        -> result: n * 2 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 20 }, to: 'caller' },
    });
  });

  it('two params a : Integer, b : Integer blank-line terminated', async () => {
    const source = `
      @go()
        result: s : Integer = add(6, 7)
        -> :s

      proc add
        a : Integer
        b : Integer

        -> result: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { s: 'Integer' }, re: { s: 13 }, to: 'caller' },
    });
  });

  it('single param n : Integer terminated by bare --', async () => {
    const source = `
      @go()
        result: x : Integer = inc(4)
        -> :x

      proc inc
        n : Integer
        --
        -> result: n + 1 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 5 }, to: 'caller' },
    });
  });

  it('no params — blank line after proc name', async () => {
    const source = `
      @go()
        result: x : Integer = forty()
        -> :x

      proc forty

        -> result: 40 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 40 }, to: 'caller' },
    });
  });
});

// ─── invalid ─────────────────────────────────────────────────────────────────

describe('proc params — invalid (compile throws)', () => {
  it('proc sub\\n body — CR after name, body immediately (no parens, no blank line)', () => {
    const source = `
      @go()
        result: x : Integer = sub()
        -> :x

      proc sub
        -> result: 0 : Integer
    `;
    expect(() => compile(source)).toThrow();
  });

  it('open-style param without blank-line terminator before body', () => {
    const source = `
      @go()
        result: x : Integer = double(5)
        -> :x

      proc double
        n : Integer
        -> result: n * 2 : Integer
    `;
    expect(() => compile(source)).toThrow();
  });

  it('// with content does not terminate open-style params', () => {
    const source = `
      @go()
        result: x : Integer = inc(1)
        -> :x

      proc inc
        n : Integer
        // done
        -> result: n + 1 : Integer
    `;
    expect(() => compile(source)).toThrow();
  });

  it('-- with content does not terminate open-style params', () => {
    const source = `
      @go()
        result: x : Integer = inc(1)
        -> :x

      proc inc
        n : Integer
        -- done
        -> result: n + 1 : Integer
    `;
    expect(() => compile(source)).toThrow();
  });
});
