import compile from '../index.js';
import { expectReply } from './helpers.js';

// ── Feature 1: RHS structure literal syntax ───────────────────────────────────

describe('RHS structure literal — positional', () => {
  it('s = a, b assigns a 2-positional structure', async () => {
    const source = `
      on test()
        a : Integer = 10
        b : Integer = 20
        s = a, b
        reply ...s
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', re: [[10, 20], 'test'], to: 'caller' },
    });
  });

  it('s = a, b, c assigns a 3-positional structure', async () => {
    const source = `
      on test()
        a : Integer = 1
        b : Integer = 2
        c : Integer = 3
        s = a, b, c
        reply ...s
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', re: [[1, 2, 3], 'test'], to: 'caller' },
    });
  });

  it('s = a : Integer, b : Integer assigns typed positional structure', async () => {
    const source = `
      on test()
        a : Integer = 7
        b : Integer = 8
        s = a : Integer, b : Integer
        reply ...s
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', re: [[7, 8], 'test'], to: 'caller' },
    });
  });
});

describe('RHS structure literal — named', () => {
  it('s = :a, :b assigns a named structure', async () => {
    const source = `
      on test()
        a : Integer = 11
        b : Integer = 22
        s = :a, :b
        reply ...s
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', re: [{ a: 11, b: 22 }, 'test'], to: 'caller' },
    });
  });

  it('s = x: 5, y: 10 assigns key-value named structure', async () => {
    const source = `
      on test()
        s = x: 5, y: 10
        reply ...s
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', re: [{ x: 5, y: 10 }, 'test'], to: 'caller' },
    });
  });
});

describe('RHS structure literal — mixed', () => {
  it('s = a, b, :c, :d builds a mixed structure', async () => {
    const source = `
      on test()
        a : Integer = 1
        b : Integer = 2
        c : Integer = 30
        d : Integer = 40
        s = a, b, :c, :d
        reply ...s
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', re: [[1, 2, { c: 30, d: 40 }], 'test'], to: 'caller' },
    });
  });

  it('s = 1, 2, x: "val" : Text builds mixed with literal and key-value', async () => {
    const source = `
      on test()
        s = 1 : Integer, 2 : Integer, x: "val" : Text
        reply ...s
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', re: [[1, 2, { x: 'val' }], 'test'], to: 'caller' },
    });
  });
});

describe('RHS structure literal — destructure roundtrip', () => {
  it('a, b = s where s was built as a literal', async () => {
    const source = `
      on test()
        x : Integer = 5
        y : Integer = 6
        s = x, y
        a, b = s
        reply sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ sum: 'Integer' }], re: [{ sum: 11 }, 'test'], to: 'caller' },
    });
  });
});

// ── Feature 2: s : Structure = single typed value coercion ───────────────────

describe('Structure coercion — s : Structure = val : Type', () => {
  it('s : Structure = 42 : Integer wraps in 1-arity structure', async () => {
    const source = `
      on test()
        s : Structure = 42 : Integer
        reply ...s
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', re: [[42], 'test'], to: 'caller' },
    });
  });

  it('s : Structure = "hello" : Text wraps in 1-arity structure', async () => {
    const source = `
      on test()
        s : Structure = "hello" : Text
        reply ...s
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', re: [['hello'], 'test'], to: 'caller' },
    });
  });
});

// ── Feature 3: Compile-time arity check ──────────────────────────────────────

describe('Structure arity check — compile time', () => {
  it('a = Structure(x, y) throws a compile error', () => {
    const source = `
      on test()
        a = Structure(1 : Integer, 2 : Integer)
        reply result: a
    `;
    expect(() => compile(source)).toThrow(/Cannot assign 2-arity Structure/);
  });

  it('a = Structure(x, y, z) throws a compile error', () => {
    const source = `
      on test()
        a = Structure(1 : Integer, 2 : Integer, 3 : Integer)
        reply result: a
    `;
    expect(() => compile(source)).toThrow(/Cannot assign 3-arity Structure/);
  });

  it('a : Type = Structure(x : Type) is OK — single positional', () => {
    expect(() => compile([
      'on test()',
      '  a : Integer = Structure(42 : Integer)',
      '  reply result: a',
    ].join('\n'))).not.toThrow();
  });
});

// ── Feature 4: Compile-time named-field check ─────────────────────────────────

describe('Structure named-field check — compile time', () => {
  it('(:a, :b) = Structure(a: 1 : Integer) throws — b not in literal', () => {
    const source = `
      on test()
        :a, :b = Structure(a: 1 : Integer)
        reply result: a
    `;
    expect(() => compile(source)).toThrow(/Field 'b' not found in Structure literal/);
  });

  it('(:a) = Structure(a: 1 : Integer, b: 2 : Integer) is OK — under-destructuring', () => {
    expect(() => compile([
      'on test()',
      '  :a = Structure(a: 1 : Integer, b: 2 : Integer)',
      '  reply result: a',
    ].join('\n'))).not.toThrow();
  });

  it('(:a, :b) = Structure(a: 1 : Integer, b: 2 : Integer) succeeds', async () => {
    const source = `
      on test()
        :a, :b = Structure(a: 1 : Integer, b: 2 : Integer)
        reply sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ sum: 'Integer' }], re: [{ sum: 3 }, 'test'], to: 'caller' },
    });
  });
});
