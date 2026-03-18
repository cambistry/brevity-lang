import compile from '../index.js';
import { expectReply } from './helpers.js';

// ── Boolean literals ──────────────────────────────────────────────────────────

describe('Boolean literals', () => {
  it('true literal is truthy', async () => {
    const source = `
      @test()
        result : Integer = if true 1 : Integer else 0 : Integer
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 1 },
        to: 'caller',
      },
    });
  });

  it('false literal is falsy', async () => {
    const source = `
      @test()
        result : Integer = if false 1 : Integer else 0 : Integer
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 0 },
        to: 'caller',
      },
    });
  });

  it('null is falsy', async () => {
    const source = `
      @test()
        cond : Integer | null = null
        result : Integer = if cond 1 : Integer else 0 : Integer
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 0 },
        to: 'caller',
      },
    });
  });

  it('0 (integer zero) is truthy (only false and null are falsy)', async () => {
    const source = `
      @test()
        result : Integer = if 0 : Integer 1 : Integer else 99 : Integer
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 1 },
        to: 'caller',
      },
    });
  });
});

// ── Comparison operators ──────────────────────────────────────────────────────

describe('Comparison operators', () => {
  it('== true case', async () => {
    const source = `
      @test()
        x : Integer = 5 : Integer
        result : Integer = if x == 5 1 : Integer else 0 : Integer
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({ re: { result: 1 } }),
    });
  });

  it('!= true case', async () => {
    const source = `
      @test()
        x : Integer = 5 : Integer
        result : Integer = if x != 3 1 : Integer else 0 : Integer
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({ re: { result: 1 } }),
    });
  });

  it('> true case', async () => {
    const source = `
      @test()
        x : Integer = 10 : Integer
        result : Integer = if x > 5 1 : Integer else 0 : Integer
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({ re: { result: 1 } }),
    });
  });

  it('< true case', async () => {
    const source = `
      @test()
        x : Integer = 3 : Integer
        result : Integer = if x < 5 1 : Integer else 0 : Integer
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({ re: { result: 1 } }),
    });
  });

  it('>= true case', async () => {
    const source = `
      @test()
        x : Integer = 5 : Integer
        result : Integer = if x >= 5 1 : Integer else 0 : Integer
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({ re: { result: 1 } }),
    });
  });

  it('<= true case', async () => {
    const source = `
      @test()
        x : Integer = 5 : Integer
        result : Integer = if x <= 5 1 : Integer else 0 : Integer
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({ re: { result: 1 } }),
    });
  });
});

// ── if/else expression ────────────────────────────────────────────────────────

describe('if/else expression', () => {
  it('single-line with type annotation on both branches', async () => {
    const source = `
      @test()
        cond : Boolean = true
        x : Integer = if cond 10 : Integer else 20 : Integer
        -> result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 10 },
        to: 'caller',
      },
    });
  });

  it('block form — last expression is the value', async () => {
    const source = `
      @test()
        x : Integer = 1 : Integer
        result : Text = if x == 1 {
          "abc" : Text
        } else {
          "def" : Text
        }
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Text' },
        re: { result: 'abc' },
        to: 'caller',
      },
    });
  });

  it('else if chain', async () => {
    const source = `
      @test()
        x : Integer = 2 : Integer
        result : Integer = if x == 1 10 : Integer else if x == 2 20 : Integer else 30 : Integer
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 20 },
        to: 'caller',
      },
    });
  });

  it('inner block shadows outer variable; outer value is unchanged', async () => {
    const source = `
      @test()
        x : Integer = 10 : Integer
        result : Integer = if true {
          x : Integer = 99 : Integer
        } else {
          0 : Integer
        }
        -> :x, :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { x: 'Integer', result: 'Integer' },
        re: { x: 10, result: 99 },
        to: 'caller',
      },
    });
  });

  it('plain assignment to outer-scope variable inside block → compile error', () => {
    expect(() => compile(`
      @test()
        x : Integer = 0 : Integer
        result : Integer = if true {
          x = 1
        } else {
          x
        }
        -> :result
    `)).toThrow(/re-bind.*'x'|'x'.*re-bind|cannot re-bind/i);
  });

  it('block reads outer scope variables', async () => {
    const source = `
      @test()
        x : Integer = 7 : Integer
        result : Integer = if true {
          x
        } else {
          0 : Integer
        }
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 7 },
        to: 'caller',
      },
    });
  });
});

// ── no-else → null ────────────────────────────────────────────────────────────

describe('if without else → null', () => {
  it('no-else if with false condition → result is null', async () => {
    const source = `
      @test()
        result : Integer | null = if false 42 : Integer
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer | null' },
        re: { result: null },
        to: 'caller',
      },
    });
  });

  it('no-else if with true condition → result is value', async () => {
    const source = `
      @test()
        result : Integer | null = if true 42 : Integer
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer | null' },
        re: { result: 42 },
        to: 'caller',
      },
    });
  });

  it('if without else assigned to non-nullable type → compile error', () => {
    expect(() => compile(`
      @test()
        result : Integer = if true 42 : Integer
        -> :result
    `)).toThrow(/if without else can return null/i);
  });
});

// ── compile errors ────────────────────────────────────────────────────────────

describe('if compile errors', () => {
  it('mismatched branch types → compile error', () => {
    expect(() => compile(`
      @test()
        result : Integer = if true 1 : Integer else "text" : Text
        -> :result
    `)).toThrow(/branch type mismatch/i);
  });
});

// ── if with proc call (async) ─────────────────────────────────────────────────

describe('if with proc call', () => {
  it('proc call inside if block branch', async () => {
    const source = `
      @test()
        x : Integer = 5 : Integer
        result : Integer = if x > 3 {
          result: sq : Integer = square(x)
          sq
        } else {
          0 : Integer
        }
        -> :result

      square
        =
        num : Integer
        =
        sq : Integer = num * num
        ->(result: sq : Integer)
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 25 },
        to: 'caller',
      },
    });
  });
});
