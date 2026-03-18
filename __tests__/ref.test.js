import compile from '../index.js';
import { expectReply } from './helpers.js';

// ── Declaration and basic use ────────────────────────────────────────────────

describe('ref — declaration and basic use', () => {
  it('ref a : Integer = 0 declares and initialises', async () => {
    const source = `
      @test
        =
        ref a : Integer = 0
        -> result: a
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

  it('ref a : Text = "hello" works with Text', async () => {
    const source = `
      @test
        =
        ref a : Text = "hello"
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Text' },
        re: { result: 'hello' },
        to: 'caller',
      },
    });
  });

  it('ref with typed RHS: ref a = 5 : Integer', async () => {
    const source = `
      @test
        =
        ref a = 5 : Integer
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 5 },
        to: 'caller',
      },
    });
  });
});

// ── Put operator (<-) ────────────────────────────────────────────────────────

describe('ref — put operator (<-)', () => {
  it('a <- 1 updates the ref', async () => {
    const source = `
      @test
        =
        ref a : Integer = 0
        a <- 1
        -> result: a
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

  it('multiple puts in sequence', async () => {
    const source = `
      @test
        =
        ref a : Integer = 0
        a <- 1
        a <- 2
        a <- 3
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 3 },
        to: 'caller',
      },
    });
  });

  it('put with expression on RHS', async () => {
    const source = `
      @test
        =
        ref a : Integer = 10
        a <- a + 5
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 15 },
        to: 'caller',
      },
    });
  });
});

// ── Rebinding is forbidden ───────────────────────────────────────────────────

describe('ref — rebinding forbidden', () => {
  it('a = 1 @a ref → compile error', () => {
    expect(() => compile(`
      @test
        =
        ref a : Integer = 0
        a = 1
        -> result: a
    `)).toThrow();
  });

  it('typed reassignment a : Integer = 1 @a ref → compile error', () => {
    expect(() => compile(`
      @test
        =
        ref a : Integer = 0
        a : Integer = 1
        -> result: a
    `)).toThrow();
  });
});

// ── Inner scope reads ────────────────────────────────────────────────────────

describe('ref — readable from inner scopes', () => {
  it('if branch reads ref from outer scope', async () => {
    const source = `
      @test
        =
        ref a : Integer = 42
        result : Integer = if true a : Integer else 0 : Integer
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 42 },
        to: 'caller',
      },
    });
  });

  it('function reads ref from outer scope', async () => {
    const source = `
      @test
        =
        ref a : Integer = 7
        fn = { a }
        result : Integer = fn()
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

// ── Inner scope puts ─────────────────────────────────────────────────────────

describe('ref — put from inner scopes', () => {
  it('if branch puts to outer ref', async () => {
    const source = `
      @test
        =
        ref a : Integer = 0
        if true
          a <- 1
        -> result: a
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

  it('function puts to outer ref', async () => {
    const source = `
      @test
        =
        ref a : Integer = 0
        fn = { a <- 99 }
        fn()
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 99 },
        to: 'caller',
      },
    });
  });

  it('while body puts to outer ref', async () => {
    const source = `
      @test
        =
        ref counter : Integer = 0
        ref i : Integer = 3
        repeat while i > 0 {
          counter <- counter + 1
          i <- i - 1
        }
        -> :counter
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { counter: 'Integer' },
        re: { counter: 3 },
        to: 'caller',
      },
    });
  });
});

// ── Closure put and return ───────────────────────────────────────────────────

describe('ref — closure put and return value', () => {
  it('closure puts to outer ref and returns the new value', async () => {
    const source = `
      @test
        =
        ref a : Integer = 0
        fn = { a <- a + 1 }
        result : Integer = fn()
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

  it('closure called twice increments ref twice', async () => {
    const source = `
      @test
        =
        ref a : Integer = 0
        fn = { a <- a + 1 }
        fn()
        fn()
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 2 },
        to: 'caller',
      },
    });
  });

  it('closure reads ref after external put', async () => {
    const source = `
      @test
        =
        ref a : Integer = 0
        a <- 10
        fn = { a + 5 }
        result : Integer = fn()
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 15 },
        to: 'caller',
      },
    });
  });

  it('two closures sharing the same ref see each others puts', async () => {
    const source = `
      @test
        =
        ref a : Integer = 0
        inc = { a <- a + 1 }
        dec = { a <- a - 1 }
        inc()
        inc()
        inc()
        dec()
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 2 },
        to: 'caller',
      },
    });
  });
});

// ── Pass by reference ────────────────────────────────────────────────────────

describe('ref — pass by reference', () => {
  it('fn(ref x : Integer) x <- 1 mutates caller ref via &a', async () => {
    const source = `
      @test
        =
        ref a : Integer = 0
        fn = |ref x : Integer| { x <- 1 }
        fn(&a)
        -> result: a
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

  it('pass-by-ref with expression: x <- x + 10', async () => {
    const source = `
      @test
        =
        ref a : Integer = 5
        add_ten = |ref x : Integer| { x <- x + 10 }
        add_ten(&a)
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 15 },
        to: 'caller',
      },
    });
  });

  it('pass-by-ref called multiple times', async () => {
    const source = `
      @test
        =
        ref a : Integer = 0
        bump = |ref x : Integer| { x <- x + 1 }
        bump(&a)
        bump(&a)
        bump(&a)
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 3 },
        to: 'caller',
      },
    });
  });

  it('pass-by-ref with additional positional args', async () => {
    const source = `
      @test
        =
        ref a : Integer = 0
        add = |ref x : Integer, n : Integer| { x <- x + n }
        add(&a, 7)
        -> result: a
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

  it('pass-by-ref with named argument', async () => {
    const source = `
      @test
        =
        ref a : Integer = 0
        fn = |ref :named : Integer| { named <- 1 }
        fn(named: &a)
        -> result: a
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

  it('passing non-ref with & → compile error', () => {
    expect(() => compile(`
      @test
        =
        a : Integer = 0
        fn = |ref x : Integer| { x <- 1 }
        fn(&a)
        -> result: a
    `)).toThrow();
  });

  it('passing ref without & → compile error', () => {
    expect(() => compile(`
      @test
        =
        ref a : Integer = 0
        fn = |ref x : Integer| { x <- 1 }
        fn(a)
        -> result: a
    `)).toThrow();
  });
});

// ── Put to non-ref is forbidden ──────────────────────────────────────────────

describe('ref — put to non-ref is forbidden', () => {
  it('a <- 1 on a regular variable → compile error', () => {
    expect(() => compile(`
      @test
        =
        a : Integer = 0
        a <- 1
        -> result: a
    `)).toThrow();
  });
});

// ── Type declared separately ─────────────────────────────────────────────────

describe('ref — type declared separately', () => {
  it('ref a = "hello" then a : Text is valid', async () => {
    const source = `
      @test
        =
        ref a = "hello"
        a : Text
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Text' },
        re: { result: 'hello' },
        to: 'caller',
      },
    });
  });
});
