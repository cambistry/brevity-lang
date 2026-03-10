import compile from '../index.js';
import { expectReply } from './helpers.js';

// ─── same-line no-paren ───────────────────────────────────────────────────────

describe('proc params — same-line no-paren', () => {
  it('single named param :n : Integer (call with named arg)', async () => {
    const source = `
      on go()
        result: x : Integer = double(n: 21)
        reply :x

      proc double :n : Integer
        reply result: n * 2 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ x: 'Integer' }, 'go'], re: [{ x: 42 }, 'go'], to: 'caller' },
    });
  });

  it('two named params :a : Integer, :b : Integer (call with named args)', async () => {
    const source = `
      on go()
        result: s : Integer = add(a: 3, b: 4)
        reply :s

      proc add :a : Integer, :b : Integer
        reply result: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ s: 'Integer' }, 'go'], re: [{ s: 7 }, 'go'], to: 'caller' },
    });
  });

  it('positional param n : Integer', async () => {
    const source = `
      on go()
        result: x : Integer = triple(5)
        reply :x

      proc triple n : Integer
        reply result: n * 3 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ x: 'Integer' }, 'go'], re: [{ x: 15 }, 'go'], to: 'caller' },
    });
  });

  it('body follows on next line without blank line', async () => {
    const source = `
      on go()
        result: x : Integer = inc(9)
        reply :x

      proc inc n : Integer
        reply result: n + 1 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ x: 'Integer' }, 'go'], re: [{ x: 10 }, 'go'], to: 'caller' },
    });
  });
});

// ─── paren style (already tested in proc.test.js, here for completeness) ─────

describe('proc params — paren style', () => {
  it('proc(n : Integer) — explicit paren style', async () => {
    const source = `
      on go()
        result: x : Integer = sq(7)
        reply :x

      proc sq(n : Integer)
        reply result: n * n : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ x: 'Integer' }, 'go'], re: [{ x: 49 }, 'go'], to: 'caller' },
    });
  });

  it('proc() — empty parens, no params', async () => {
    const source = `
      on go()
        result: x : Integer = const()
        reply :x

      proc const()
        reply result: 42 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ x: 'Integer' }, 'go'], re: [{ x: 42 }, 'go'], to: 'caller' },
    });
  });
});

// ─── open style ──────────────────────────────────────────────────────────────

describe('proc params — open style', () => {
  it('single param n : Integer blank-line terminated', async () => {
    const source = `
      on go()
        result: x : Integer = double(10)
        reply :x

      proc double
        n : Integer

        reply result: n * 2 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ x: 'Integer' }, 'go'], re: [{ x: 20 }, 'go'], to: 'caller' },
    });
  });

  it('two params a : Integer, b : Integer blank-line terminated', async () => {
    const source = `
      on go()
        result: s : Integer = add(6, 7)
        reply :s

      proc add
        a : Integer
        b : Integer

        reply result: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ s: 'Integer' }, 'go'], re: [{ s: 13 }, 'go'], to: 'caller' },
    });
  });

  it('single param n : Integer terminated by bare --', async () => {
    const source = `
      on go()
        result: x : Integer = inc(4)
        reply :x

      proc inc
        n : Integer
        --
        reply result: n + 1 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ x: 'Integer' }, 'go'], re: [{ x: 5 }, 'go'], to: 'caller' },
    });
  });

  it('no params — blank line after proc name', async () => {
    const source = `
      on go()
        result: x : Integer = forty()
        reply :x

      proc forty

        reply result: 40 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ x: 'Integer' }, 'go'], re: [{ x: 40 }, 'go'], to: 'caller' },
    });
  });
});

// ─── invalid ─────────────────────────────────────────────────────────────────

describe('proc params — invalid (compile throws)', () => {
  it('proc sub\\n body — CR after name, body immediately (no parens, no blank line)', () => {
    const source = `
      on go()
        result: x : Integer = sub()
        reply :x

      proc sub
        reply result: 0 : Integer
    `;
    expect(() => compile(source)).toThrow();
  });

  it('open-style param without blank-line terminator before body', () => {
    const source = `
      on go()
        result: x : Integer = double(5)
        reply :x

      proc double
        n : Integer
        reply result: n * 2 : Integer
    `;
    expect(() => compile(source)).toThrow();
  });

  it('// with content does not terminate open-style params', () => {
    const source = `
      on go()
        result: x : Integer = inc(1)
        reply :x

      proc inc
        n : Integer
        // done
        reply result: n + 1 : Integer
    `;
    expect(() => compile(source)).toThrow();
  });

  it('-- with content does not terminate open-style params', () => {
    const source = `
      on go()
        result: x : Integer = inc(1)
        reply :x

      proc inc
        n : Integer
        -- done
        reply result: n + 1 : Integer
    `;
    expect(() => compile(source)).toThrow();
  });
});
