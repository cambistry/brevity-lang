import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Compilation checks
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — compiles', () => {
  it('single line typed with assignment', () => {
    expect(() => compileSource('ref a Integer = 123\n')).not.toThrow();
    expect(() => compileSource('ref a Text = "abc"\n')).not.toThrow();
    expect(() => compileSource('ref a Boolean = true\n')).not.toThrow();
    expect(() => compileSource('ref a List = []\n')).not.toThrow();
  });

  it('single line with constructor', () => {
    expect(() => compileSource('ref a = Integer(123)\n')).not.toThrow();
    expect(() => compileSource('ref a = Text("abc")\n')).not.toThrow();
    expect(() => compileSource('ref a = Boolean(true)\n')).not.toThrow();
    expect(() => compileSource('ref a = List([])\n')).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Declaration, put basics, separate type
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — declaration and put basics', () => {
  const script = `
      @declInt = { ref a Integer = 0; -> result: a }
      @declText = { ref a Text = "hello"; -> result: a }
      @declTypedRhs = { ref a = 5 as Integer; -> result: a }
      @putSimple = { ref a Integer = 0; a <- 1; -> result: a }
      @putMultiple = { ref a Integer = 0; a <- 1; a <- 2; a <- 3; -> result: a }
      @putExpr = { ref a Integer = 10; a <- a + 5; -> result: a }
      @declSeparateType = {
        ref a = "hello"
        a Text
        -> result: a
      }
  `;

  it('ref a Integer = 0 declares and initialises', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@declInt', from: 'c' }, output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 0 }, to: 'c' } });
  });

  it('ref a Text = "hello" works with Text', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@declText', from: 'c' }, output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' } });
  });

  it('ref with typed RHS: ref a = 5 : Integer', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@declTypedRhs', from: 'c' }, output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } });
  });

  it('a <- 1 updates the ref', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@putSimple', from: 'c' }, output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } });
  });

  it('multiple puts in sequence', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@putMultiple', from: 'c' }, output: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } });
  });

  it('put with expression on RHS', async () => {
    await expectBehavior(script, { input: { id: '6', op: '@putExpr', from: 'c' }, output: { id: '6', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' } });
  });

  it('ref a = "hello" then a : Text is valid', async () => {
    await expectBehavior(script, { input: { id: '7', op: '@declSeparateType', from: 'c' }, output: { id: '7', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Inner scope reads and puts
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — inner scope reads and puts', () => {
  const script = `
      @readIf
        =
        ref a Integer = 42
        result Integer = if true a as Integer else 0 as Integer
        -> :result

      @readFn
        =
        ref a Integer = 7
        fn = { a }
        result Integer = fn()
        -> :result

      @putIf
        =
        ref a Integer = 0
        if true
          a <- 1
        -> result: a

      @putFn
        =
        ref a Integer = 0
        fn = { a <- 99 }
        fn()
        -> result: a

      @putWhile
        =
        ref counter Integer = 0
        ref i Integer = 3
        repeat while i > 0 {
          counter <- counter + 1
          i <- i - 1
        }
        -> :counter
  `;

  it('if branch reads ref from outer scope', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@readIf', from: 'c' }, output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } });
  });

  it('function reads ref from outer scope', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@readFn', from: 'c' }, output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } });
  });

  it('if branch puts to outer ref', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@putIf', from: 'c' }, output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } });
  });

  it('function puts to outer ref', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@putFn', from: 'c' }, output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 99 }, to: 'c' } });
  });

  it('while body puts to outer ref', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@putWhile', from: 'c' }, output: { id: '5', 'bv-a': { counter: 'Integer' }, re: { counter: 3 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Closure put and return value
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — closure put and return value', () => {
  const script = `
      @closurePut
        =
        ref a Integer = 0
        fn = { a <- a + 1 }
        result Integer = fn()
        -> :result

      @closureTwice
        =
        ref a Integer = 0
        fn = { a <- a + 1 }
        fn()
        fn()
        -> result: a

      @closureAfterPut
        =
        ref a Integer = 0
        a <- 10
        fn = { a + 5 }
        result Integer = fn()
        -> :result

      @closureShared
        =
        ref a Integer = 0
        inc = { a <- a + 1 }
        dec = { a <- a - 1 }
        inc()
        inc()
        inc()
        dec()
        -> result: a
  `;

  it('closure puts to outer ref and returns the new value', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@closurePut', from: 'c' }, output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } });
  });

  it('closure called twice increments ref twice', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@closureTwice', from: 'c' }, output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } });
  });

  it('closure reads ref after external put', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@closureAfterPut', from: 'c' }, output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' } });
  });

  it('two closures sharing the same ref see each others puts', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@closureShared', from: 'c' }, output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Pass by reference
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — pass by reference', () => {
  const script = `
      @passRef
        =
        ref a Integer = 0
        fn = |ref x Integer| { x <- 1 }
        fn(&a)
        -> result: a

      @passRefExpr
        =
        ref a Integer = 5
        add_ten = |ref x Integer| { x <- x + 10 }
        add_ten(&a)
        -> result: a

      @passRefMulti
        =
        ref a Integer = 0
        bump = |ref x Integer| { x <- x + 1 }
        bump(&a)
        bump(&a)
        bump(&a)
        -> result: a

      @passRefExtra
        =
        ref a Integer = 0
        add = |ref x Integer, n Integer| { x <- x + n }
        add(&a, 7)
        -> result: a

      @passRefNamed
        =
        ref a Integer = 0
        fn = |ref named: Integer| { named <- 1 }
        fn(named: &a)
        -> result: a
  `;

  it('fn(ref x) x <- 1 mutates caller ref via &a', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@passRef', from: 'c' }, output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } });
  });

  it('pass-by-ref with expression: x <- x + 10', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@passRefExpr', from: 'c' }, output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' } });
  });

  it('pass-by-ref called multiple times', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@passRefMulti', from: 'c' }, output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } });
  });

  it('pass-by-ref with additional positional args', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@passRefExtra', from: 'c' }, output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } });
  });

  it('pass-by-ref with named argument', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@passRefNamed', from: 'c' }, output: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — compile errors', () => {
  it('rebinding ref with = → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        ref a Integer = 0
        a = 1
        -> result: a
    `)).toThrow();
  });

  it('typed reassignment of ref → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        ref a Integer = 0
        a Integer = 1
        -> result: a
    `)).toThrow();
  });

  it('put to non-ref → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        a Integer = 0
        a <- 1
        -> result: a
    `)).toThrow();
  });

  it('passing non-ref with & → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        a Integer = 0
        fn = |ref x Integer| { x <- 1 }
        fn(&a)
        -> result: a
    `)).toThrow();
  });

  it('passing ref without & → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        ref a Integer = 0
        fn = |ref x Integer| { x <- 1 }
        fn(a)
        -> result: a
    `)).toThrow();
  });
});
