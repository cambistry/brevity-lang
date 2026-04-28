import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Compilation checks
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — compiles', () => {
  it('single line typed with assignment', () => {
    expect(() => compileSource('a Integer! = 123\n')).not.toThrow();
    expect(() => compileSource('a Text! = "abc"\n')).not.toThrow();
    expect(() => compileSource('a Boolean! = true\n')).not.toThrow();
    expect(() => compileSource('a List! = []\n')).not.toThrow();
  });

  it('single line with constructor', () => {
    expect(() => compileSource('a = Integer!(123)\n')).not.toThrow();
    expect(() => compileSource('a = Text!("abc")\n')).not.toThrow();
    expect(() => compileSource('a = Boolean!(true)\n')).not.toThrow();
    expect(() => compileSource('a = List!([])\n')).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Declaration, put basics, separate type
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — declaration and put basics', () => {
  const script = `
      @declInt = { a Integer! = 0; -> result: a }
      @declText = { a Text! = "hello"; -> result: a }
      @declTypedRhs = { a = *5 as Integer; -> result: a }
      @putSimple = { a Integer! = 0; a <- 1; -> result: a }
      @putMultiple = { a Integer! = 0; a <- 1; a <- 2; a <- 3; -> result: a }
      @putExpr = { a Integer! = 10; a <- a + 5; -> result: a }
      @declSeparateType = {
        a = *"hello"
        a Text
        -> result: a
      }
  `;

  it('a Integer! = 0 declares and initialises', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@declInt', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 0 }, to: 'c' } });
  });

  it('a Text! = "hello" works with Text', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@declText', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' } });
  });

  it('ref with typed RHS: a = *5 : Integer', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@declTypedRhs', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } });
  });

  it('a <- 1 updates the ref', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@putSimple', from: 'c' } }, { output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } });
  });

  it('multiple puts in sequence', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@putMultiple', from: 'c' } }, { output: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } });
  });

  it('put with expression on RHS', async () => {
    await expectBehavior(script, { input: { id: '6', op: '@putExpr', from: 'c' } }, { output: { id: '6', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' } });
  });

  it('a = *"hello" then a : Text is valid', async () => {
    await expectBehavior(script, { input: { id: '7', op: '@declSeparateType', from: 'c' } }, { output: { id: '7', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Inner scope reads and puts
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — inner scope reads and puts', () => {
  const script = `
      @readIf
        =
        a Integer! = 42
        result Integer = if true a else 0
        -> :result

      @readFn
        =
        a Integer! = 7
        fn = { a }
        result Integer = fn()
        -> :result

      @putIf
        =
        a Integer! = 0
        if true
          a <- 1
        -> result: a

      @putFn
        =
        a Integer! = 0
        fn = { a <- 99 }
        fn()
        -> result: a

      @putWhile
        =
        counter Integer! = 0
        i Integer! = 3
        repeat while i > 0 {
          counter <- counter + 1
          i <- i - 1
        }
        -> :counter
  `;

  it('if branch reads ref from outer scope', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@readIf', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } });
  });

  it('function reads ref from outer scope', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@readFn', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } });
  });

  it('if branch puts to outer ref', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@putIf', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } });
  });

  it('function puts to outer ref', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@putFn', from: 'c' } }, { output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 99 }, to: 'c' } });
  });

  it('while body puts to outer ref', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@putWhile', from: 'c' } }, { output: { id: '5', 'bv-a': { counter: 'Integer' }, re: { counter: 3 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Closure put and return value
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — closure put and return value', () => {
  const script = `
      @closurePut
        =
        a Integer! = 0
        fn = { a <- a + 1 }
        result Integer = fn()
        -> :result

      @closureTwice
        =
        a Integer! = 0
        fn = { a <- a + 1 }
        fn()
        fn()
        -> result: a

      @closureAfterPut
        =
        a Integer! = 0
        a <- 10
        fn = { a + 5 }
        result Integer = fn()
        -> :result

      @closureShared
        =
        a Integer! = 0
        inc = { a <- a + 1 }
        dec = { a <- a - 1 }
        inc()
        inc()
        inc()
        dec()
        -> result: a
  `;

  it('closure puts to outer ref and returns the new value', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@closurePut', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } });
  });

  it('closure called twice increments ref twice', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@closureTwice', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } });
  });

  it('closure reads ref after external put', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@closureAfterPut', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' } });
  });

  it('two closures sharing the same ref see each others puts', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@closureShared', from: 'c' } }, { output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Pass by reference
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — pass by reference', () => {
  const script = `
      @passRef
        =
        a Integer! = 0
        fn = |x Integer!| { x <- 1 }
        fn(&a)
        -> result: a

      @passRefExpr
        =
        a Integer! = 5
        add_ten = |x Integer!| { x <- x + 10 }
        add_ten(&a)
        -> result: a

      @passRefMulti
        =
        a Integer! = 0
        bump = |x Integer!| { x <- x + 1 }
        bump(&a)
        bump(&a)
        bump(&a)
        -> result: a

      @passRefExtra
        =
        a Integer! = 0
        add = |x Integer!, n Integer| { x <- x + n }
        add(&a, 7)
        -> result: a

      @passRefNamed
        =
        a Integer! = 0
        fn = |:named Integer!| { named <- 1 }
        fn(named: &a)
        -> result: a
  `;

  it('fn(ref x) x <- 1 mutates caller ref via &a', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@passRef', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } });
  });

  it('pass-by-ref with expression: x <- x + 10', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@passRefExpr', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' } });
  });

  it('pass-by-ref called multiple times', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@passRefMulti', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } });
  });

  it('pass-by-ref with additional positional args', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@passRefExtra', from: 'c' } }, { output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } });
  });

  it('pass-by-ref with named argument', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@passRefNamed', from: 'c' } }, { output: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — compile errors', () => {
  it('rebinding with = *→ compile error', () => {
    expect(() => compileSource(`
      @test
        =
        a Integer! = 0
        a = 1
        -> result: a
    `)).toThrow();
  });

  it('typed reassignment of ref → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        a Integer! = 0
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
        fn = |x Integer!| { x <- 1 }
        fn(&a)
        -> result: a
    `)).toThrow();
  });

  it('passing ref without & → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        a Integer! = 0
        fn = |x Integer!| { x <- 1 }
        fn(a)
        -> result: a
    `)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Public refs: @name Type! = init  (auto get + set for base types)
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — public (@name Type!)', () => {
  const script = `
      @val Integer! = 0
      @name Text! = "hi"
      @flag Boolean! = false
  `;

  it('get @val returns initial integer', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@val', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [0], to: 'c' } },
    );
  });

  it('get @name returns initial text', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@name', from: 'c' } },
      { output: { id: '2', 'bv-a': ['Text'], re: ['hi'], to: 'c' } },
    );
  });

  it('get @flag returns initial boolean', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@flag', from: 'c' } },
      { output: { id: '3', 'bv-a': ['Boolean'], re: [false], to: 'c' } },
    );
  });

  it('set@val then @val reflects new value', async () => {
    await expectBehavior(script,
      { input: { op: [[7], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { input: { id: '1', op: '@val', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [7], to: 'c' } },
    );
  });

  it('sequential set@val — last wins', async () => {
    await expectBehavior(script,
      { input: { op: [[1], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { input: { op: [[2], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { input: { op: [[3], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { input: { id: '1', op: '@val', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [3], to: 'c' } },
    );
  });

  it('set@name on text ref', async () => {
    await expectBehavior(script,
      { input: { op: [['bye'], 'set@name'], 'bv-a': [['Text']], from: 'c' } },
      { input: { id: '1', op: '@name', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Text'], re: ['bye'], to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Public refs via in-script constructor
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — public via in-script constructor', () => {
  const script = `
      C = <> { @val Integer! = 0 }

      @readInitial
        =
        c = C()
        v = c.val
        -> result: v as Integer

      @writeThenRead
        =
        c = C()
        c.val <- 42
        v = c.val
        -> result: v as Integer
  `;

  it('wrapper reads initial from child public ref', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@readInitial', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 0 }, to: 'c' } },
    );
  });

  it('wrapper writes via c.val <- n then reads', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@writeThenRead', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Public refs seeded from constructor param (override auto-accessor)
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — public refs initialized from constructor param', () => {
  const script = `
      C = <:x Integer> { @x Integer! = x }

      @fromParam
        =
        c = C(x: 100)
        v = c.x
        -> result: v as Integer

      @overrideParam
        =
        c = C(x: 100)
        c.x <- 101
        v = c.x
        -> result: v as Integer
  `;

  it('reads ref seeded from named param', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@fromParam', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 100 }, to: 'c' } },
    );
  });

  it('writes to ref that was seeded from param', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@overrideParam', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 101 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Public refs — compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — public refs compile errors', () => {
  it('duplicate public binding (@val ref + @val handler) → compile error', () => {
    expect(() => compileSource(`
      @val Integer! = 0
      @val = { -> 1 }
    `)).toThrow();
  });

  it('two public refs with same name → compile error', () => {
    expect(() => compileSource(`
      @val Integer! = 0
      @val Text! = "x"
    `)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Bare/protected ref `val` and public ref `@val` are independent storage slots
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — bare and @ namespaces are independent', () => {
  const script = `
    val Integer! = 11
    @val Integer! = 22
    @both = -> p: val, q: @val
    @bumpBare = { val <- val + 100 . }
  `;

  it('bare val and @val coexist with independent values', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@both', from: 'c' } },
      { output: { id: '1', 'bv-a': { p: 'Integer', q: 'Integer' }, re: { p: 11, q: 22 }, to: 'c' } },
    );
  });

  it('mutating bare val does not change @val', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@bumpBare', from: 'c' } },
      { input: { id: '2', op: '@both', from: 'c' } },
      { output: { id: '2', 'bv-a': { p: 'Integer', q: 'Integer' }, re: { p: 111, q: 22 }, to: 'c' } },
    );
  });

  it('mutating @val via set@val does not change bare val', async () => {
    await expectBehavior(script,
      { input: { op: [[99], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { input: { id: '2', op: '@both', from: 'c' } },
      { output: { id: '2', 'bv-a': { p: 'Integer', q: 'Integer' }, re: { p: 11, q: 99 }, to: 'c' } },
    );
  });

  it('@val getter is independent of bare val', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@val', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [22], to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// User identifiers starting with __ are valid bare/protected idents
// ═══════════════════════════════════════════════════════════════════════════════

describe('ref — bare idents starting with __ are usable', () => {
  const script = `
    __foo Integer! = 42
    __bar Text! = "hi"
    @get = -> :__foo as Integer, :__bar as Text
    @setFoo = |:n Integer| { __foo <- n . }
  `;

  it('__foo and __bar are readable as protected refs', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@get', from: 'c' } },
      { output: { id: '1', 'bv-a': { __foo: 'Integer', __bar: 'Text' }, re: { __foo: 42, __bar: 'hi' }, to: 'c' } },
    );
  });

  it('__foo is mutable via <-', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ n: 7 }, '@setFoo'], 'bv-a': [{ n: 'Integer' }], from: 'c' } },
      { input: { id: '2', op: '@get', from: 'c' } },
      { output: { id: '2', 'bv-a': { __foo: 'Integer', __bar: 'Text' }, re: { __foo: 7, __bar: 'hi' }, to: 'c' } },
    );
  });
});
