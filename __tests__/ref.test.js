import compile from '../index.js';
import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Declaration, put basics, separate type
//
// ref a : T = v declares a mutable cell. a <- expr updates it.
// Type can appear on LHS (ref a : T = v), RHS (ref a = v : T),
// or on a separate line (ref a = v / a : T).
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — declaration and put basics', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @declInt
        =
        ref a : Integer = 0
        -> result: a

      @declText
        =
        ref a : Text = "hello"
        -> result: a

      @declTypedRhs
        =
        ref a = 5 : Integer
        -> result: a

      @putSimple
        =
        ref a : Integer = 0
        a <- 1
        -> result: a

      @putMultiple
        =
        ref a : Integer = 0
        a <- 1
        a <- 2
        a <- 3
        -> result: a

      @putExpr
        =
        ref a : Integer = 10
        a <- a + 5
        -> result: a

      @declSeparateType
        =
        ref a = "hello"
        a : Text
        -> result: a
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@declInt', from: 'c' },
        { id: '2', op: '@declText', from: 'c' },
        { id: '3', op: '@declTypedRhs', from: 'c' },
        { id: '4', op: '@putSimple', from: 'c' },
        { id: '5', op: '@putMultiple', from: 'c' },
        { id: '6', op: '@putExpr', from: 'c' },
        { id: '7', op: '@declSeparateType', from: 'c' },
      ],
    });
  });

  it('ref a : Integer = 0 declares and initialises', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 0 }, to: 'c' });
  });

  it('ref a : Text = "hello" works with Text', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' });
  });

  it('ref with typed RHS: ref a = 5 : Integer', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' });
  });

  it('a <- 1 updates the ref', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' });
  });

  it('multiple puts in sequence', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' });
  });

  it('put with expression on RHS', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' });
  });

  it('ref a = "hello" then a : Text is valid', () => {
    expect(outputs[6]).toEqual({ id: '7', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Inner scope reads and puts
//
// Refs are visible inside if branches, closures, and while loops.
// Puts from inner scopes mutate the outer ref.
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — inner scope reads and puts', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @readIf
        =
        ref a : Integer = 42
        result : Integer = if true a as Integer else 0 as Integer
        -> :result

      @readFn
        =
        ref a : Integer = 7
        fn = { a }
        result : Integer = fn()
        -> :result

      @putIf
        =
        ref a : Integer = 0
        if true
          a <- 1
        -> result: a

      @putFn
        =
        ref a : Integer = 0
        fn = { a <- 99 }
        fn()
        -> result: a

      @putWhile
        =
        ref counter : Integer = 0
        ref i : Integer = 3
        repeat while i > 0 {
          counter <- counter + 1
          i <- i - 1
        }
        -> :counter
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@readIf', from: 'c' },
        { id: '2', op: '@readFn', from: 'c' },
        { id: '3', op: '@putIf', from: 'c' },
        { id: '4', op: '@putFn', from: 'c' },
        { id: '5', op: '@putWhile', from: 'c' },
      ],
    });
  });

  it('if branch reads ref from outer scope', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' });
  });

  it('function reads ref from outer scope', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' });
  });

  it('if branch puts to outer ref', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' });
  });

  it('function puts to outer ref', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { result: 'Integer' }, re: { result: 99 }, to: 'c' });
  });

  it('while body puts to outer ref', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { counter: 'Integer' }, re: { counter: 3 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Closure put and return value
//
// Closures that put to an outer ref, return the new value,
// share state with other closures, and read after external puts.
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — closure put and return value', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @closurePut
        =
        ref a : Integer = 0
        fn = { a <- a + 1 }
        result : Integer = fn()
        -> :result

      @closureTwice
        =
        ref a : Integer = 0
        fn = { a <- a + 1 }
        fn()
        fn()
        -> result: a

      @closureAfterPut
        =
        ref a : Integer = 0
        a <- 10
        fn = { a + 5 }
        result : Integer = fn()
        -> :result

      @closureShared
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

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@closurePut', from: 'c' },
        { id: '2', op: '@closureTwice', from: 'c' },
        { id: '3', op: '@closureAfterPut', from: 'c' },
        { id: '4', op: '@closureShared', from: 'c' },
      ],
    });
  });

  it('closure puts to outer ref and returns the new value', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' });
  });

  it('closure called twice increments ref twice', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' });
  });

  it('closure reads ref after external put', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' });
  });

  it('two closures sharing the same ref see each others puts', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Pass by reference
//
// |ref x : Integer| accepts a ref via &a at the call site.
// Puts through the ref parameter mutate the caller's ref.
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — pass by reference', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @passRef
        =
        ref a : Integer = 0
        fn = |ref x : Integer| { x <- 1 }
        fn(&a)
        -> result: a

      @passRefExpr
        =
        ref a : Integer = 5
        add_ten = |ref x : Integer| { x <- x + 10 }
        add_ten(&a)
        -> result: a

      @passRefMulti
        =
        ref a : Integer = 0
        bump = |ref x : Integer| { x <- x + 1 }
        bump(&a)
        bump(&a)
        bump(&a)
        -> result: a

      @passRefExtra
        =
        ref a : Integer = 0
        add = |ref x : Integer, n : Integer| { x <- x + n }
        add(&a, 7)
        -> result: a

      @passRefNamed
        =
        ref a : Integer = 0
        fn = |ref :named : Integer| { named <- 1 }
        fn(named: &a)
        -> result: a
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@passRef', from: 'c' },
        { id: '2', op: '@passRefExpr', from: 'c' },
        { id: '3', op: '@passRefMulti', from: 'c' },
        { id: '4', op: '@passRefExtra', from: 'c' },
        { id: '5', op: '@passRefNamed', from: 'c' },
      ],
    });
  });

  it('fn(ref x) x <- 1 mutates caller ref via &a', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' });
  });

  it('pass-by-ref with expression: x <- x + 10', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' });
  });

  it('pass-by-ref called multiple times', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' });
  });

  it('pass-by-ref with additional positional args', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' });
  });

  it('pass-by-ref with named argument', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors (no build needed — instant)
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — compile errors', () => {
  it('rebinding ref with = → compile error', () => {
    expect(() => compile(`
      @test
        =
        ref a : Integer = 0
        a = 1
        -> result: a
    `)).toThrow();
  });

  it('typed reassignment of ref → compile error', () => {
    expect(() => compile(`
      @test
        =
        ref a : Integer = 0
        a : Integer = 1
        -> result: a
    `)).toThrow();
  });

  it('put to non-ref → compile error', () => {
    expect(() => compile(`
      @test
        =
        a : Integer = 0
        a <- 1
        -> result: a
    `)).toThrow();
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
