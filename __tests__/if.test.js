import compile from '../index.js';
import { expectReply } from './helpers.js';

// ── Boolean literals ──────────────────────────────────────────────────────────

describe('Boolean literals', () => {
  it('true literal is truthy', async () => {
    const source = `
      on test()
        result : Integer = if true 1 : Integer else 0 : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'Integer' }, 'test'],
        re: [{ result: 1 }, 'test'],
        to: 'caller',
      },
    });
  });

  it('false literal is falsy', async () => {
    const source = `
      on test()
        result : Integer = if false 1 : Integer else 0 : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'Integer' }, 'test'],
        re: [{ result: 0 }, 'test'],
        to: 'caller',
      },
    });
  });

  it('null is falsy', async () => {
    const source = `
      on test()
        cond : Integer | null = null
        result : Integer = if cond 1 : Integer else 0 : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'Integer' }, 'test'],
        re: [{ result: 0 }, 'test'],
        to: 'caller',
      },
    });
  });

  it('0 (integer zero) is truthy (only false and null are falsy)', async () => {
    const source = `
      on test()
        result : Integer = if 0 : Integer 1 : Integer else 99 : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'Integer' }, 'test'],
        re: [{ result: 1 }, 'test'],
        to: 'caller',
      },
    });
  });
});

// ── Comparison operators ──────────────────────────────────────────────────────

describe('Comparison operators', () => {
  it('== true case', async () => {
    const source = `
      on test()
        x : Integer = 5 : Integer
        result : Integer = if x == 5 1 : Integer else 0 : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({ re: [{ result: 1 }, 'test'] }),
    });
  });

  it('!= true case', async () => {
    const source = `
      on test()
        x : Integer = 5 : Integer
        result : Integer = if x != 3 1 : Integer else 0 : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({ re: [{ result: 1 }, 'test'] }),
    });
  });

  it('> true case', async () => {
    const source = `
      on test()
        x : Integer = 10 : Integer
        result : Integer = if x > 5 1 : Integer else 0 : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({ re: [{ result: 1 }, 'test'] }),
    });
  });

  it('< true case', async () => {
    const source = `
      on test()
        x : Integer = 3 : Integer
        result : Integer = if x < 5 1 : Integer else 0 : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({ re: [{ result: 1 }, 'test'] }),
    });
  });

  it('>= true case', async () => {
    const source = `
      on test()
        x : Integer = 5 : Integer
        result : Integer = if x >= 5 1 : Integer else 0 : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({ re: [{ result: 1 }, 'test'] }),
    });
  });

  it('<= true case', async () => {
    const source = `
      on test()
        x : Integer = 5 : Integer
        result : Integer = if x <= 5 1 : Integer else 0 : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({ re: [{ result: 1 }, 'test'] }),
    });
  });
});

// ── if/else expression ────────────────────────────────────────────────────────

describe('if/else expression', () => {
  it('single-line with type annotation on both branches', async () => {
    const source = `
      on test()
        cond : Boolean = true
        x : Integer = if cond 10 : Integer else 20 : Integer
        reply result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'Integer' }, 'test'],
        re: [{ result: 10 }, 'test'],
        to: 'caller',
      },
    });
  });

  it('block form — last expression is the value', async () => {
    const source = `
      on test()
        x : Integer = 1 : Integer
        result : Text = if x == 1 {
          "abc" : Text
        } else {
          "def" : Text
        }
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'Text' }, 'test'],
        re: [{ result: 'abc' }, 'test'],
        to: 'caller',
      },
    });
  });

  it('else if chain', async () => {
    const source = `
      on test()
        x : Integer = 2 : Integer
        result : Integer = if x == 1 10 : Integer else if x == 2 20 : Integer else 30 : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'Integer' }, 'test'],
        re: [{ result: 20 }, 'test'],
        to: 'caller',
      },
    });
  });

  it('inner block shadows outer variable; outer value is unchanged', async () => {
    const source = `
      on test()
        x : Integer = 10 : Integer
        result : Integer = if true {
          x : Integer = 99 : Integer
        } else {
          0 : Integer
        }
        reply :x, :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ x: 'Integer', result: 'Integer' }, 'test'],
        re: [{ x: 10, result: 99 }, 'test'],
        to: 'caller',
      },
    });
  });

  it('plain assignment to outer-scope variable inside block → compile error', () => {
    expect(() => compile([
      'on test()',
      '  x : Integer = 0 : Integer',
      '  result : Integer = if true {',
      '    x = 1',
      '  } else {',
      '    x',
      '  }',
      '  reply :result',
    ].join('\n'))).toThrow(/re-bind.*'x'|'x'.*re-bind|cannot re-bind/i);
  });

  it('block reads outer scope variables', async () => {
    const source = `
      on test()
        x : Integer = 7 : Integer
        result : Integer = if true {
          x
        } else {
          0 : Integer
        }
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'Integer' }, 'test'],
        re: [{ result: 7 }, 'test'],
        to: 'caller',
      },
    });
  });
});

// ── no-else → null ────────────────────────────────────────────────────────────

describe('if without else → null', () => {
  it('no-else if with false condition → result is null', async () => {
    const source = `
      on test()
        result : Integer | null = if false 42 : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'Integer | null' }, 'test'],
        re: [{ result: null }, 'test'],
        to: 'caller',
      },
    });
  });

  it('no-else if with true condition → result is value', async () => {
    const source = `
      on test()
        result : Integer | null = if true 42 : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'Integer | null' }, 'test'],
        re: [{ result: 42 }, 'test'],
        to: 'caller',
      },
    });
  });

  it('if without else assigned to non-nullable type → compile error', () => {
    expect(() => compile([
      'on test()',
      '  result : Integer = if true 42 : Integer',
      '  reply :result',
    ].join('\n'))).toThrow(/if without else can return null/i);
  });
});

// ── compile errors ────────────────────────────────────────────────────────────

describe('if compile errors', () => {
  it('mismatched branch types → compile error', () => {
    expect(() => compile([
      'on test()',
      '  result : Integer = if true 1 : Integer else "text" : Text',
      '  reply :result',
    ].join('\n'))).toThrow(/branch type mismatch/i);
  });
});

// ── if with proc call (async) ─────────────────────────────────────────────────

describe('if with proc call', () => {
  it('proc call inside if block branch', async () => {
    const source = `
      on test()
        x : Integer = 5 : Integer
        result : Integer = if x > 3 {
          result: sq : Integer = square(x)
          sq
        } else {
          0 : Integer
        }
        reply :result

      proc square(num : Integer)
        sq : Integer = num * num
        reply(result: sq : Integer)
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'Integer' }, 'test'],
        re: [{ result: 25 }, 'test'],
        to: 'caller',
      },
    });
  });
});
