import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Function overloading and optional args
//
// Every function binding is an Overload — an ordered list of clauses.
//   = creates a new overload (single clause)
//   << appends a clause (tail — tried last)
// Dispatch: first match wins, so place more-specific clauses before general ones.
// Optional args: if a missing arg can be supplied by a default, the match succeeds.
// Duplicate = on the same name is a redefinition error.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Compilation: basic overload forms ───────────────────────────────────────

describe('overload — compilation', () => {
  it('single clause with = compiles', () => {
    expect(() => compileSource(`
      @ping = -> answer: 1
    `)).not.toThrow();
  });

  it('<< appends clause — compiles', () => {
    expect(() => compileSource(`
      @calc = (a Integer) -> result: a
      @calc << (a Integer, b Integer) -> result: (a + b)
    `)).not.toThrow();
  });

  it('duplicate = on same name is a redefinition error', () => {
    expect(() => compileSource(`
      @calc = (a Integer) -> result: a
      @calc = (a Integer, b Integer) -> result: (a + b)
    `)).toThrow();
  });

  it('<< without prior = is an error', () => {
    expect(() => compileSource(`
      @calc << (a Integer) -> result: a
    `)).toThrow();
  });
});

// ── Compilation: lineal form ────────────────────────────────────────────────

describe('overload — lineal form — compilation', () => {
  it('lineal = followed by lineal << compiles', () => {
    expect(() => compileSource(`
      add
        =
        a Integer
        =
        -> result: a

      add <<
        =
        a Integer
        b Integer
        =
        result Integer = a + b
        -> result: result
    `)).not.toThrow();
  });

  it('lineal duplicate = on same name is a redefinition error', () => {
    expect(() => compileSource(`
      add
        =
        a Integer
        =
        -> result: a

      add
        =
        a Integer
        b Integer
        =
        result Integer = a + b
        -> result: result
    `)).toThrow();
  });
});

// ── Compilation: sugared form ───────────────────────────────────────────────

describe('overload — sugared form — compilation', () => {
  it('sugared = followed by sugared << compiles', () => {
    expect(() => compileSource(`
      @calc = (a Integer) -> result: a
      @calc << (a Integer, b Integer) -> result: (a + b)
    `)).not.toThrow();
  });
});

// ── Compilation: private function overloads ──────────────────────────────────

describe('overload — private functions — compilation', () => {
  it('private delimited overload compiles', () => {
    expect(() => compileSource(`
      fn = (a) { a }
      fn << (a, b) { a + b }
      @test = { result Integer = fn(1, 2); -> :result }
    `)).not.toThrow();
  });

  it('private duplicate = is a redefinition error', () => {
    expect(() => compileSource(`
      fn = (a) { a }
      fn = (a, b) { a + b }
      @test = { result Integer = fn(1); -> :result }
    `)).toThrow();
  });
});

// ── Runtime: << appends (tried after existing clauses) ──────────────────────

describe('overload — << append — runtime', () => {
  const script = `
    @calc = (a Integer) -> result: a
    @calc << (a Integer, b Integer) -> result: (a + b)
    @calc << (a Integer, b Integer, c Integer) -> result: (a + b + c)
  `;

  it('1-arg matches first clause', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[10], '@calc'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('2-arg matches second clause', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[3, 4], '@calc'], 'bv-a': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('3-arg matches third clause', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[1, 2, 3], '@calc'], 'bv-a': [['Integer', 'Integer', 'Integer']], from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });
});

// ── Runtime: lineal form overloads ──────────────────────────────────────────

describe('overload — lineal form — runtime', () => {
  const script = `
    add
      =
      a Integer
      =
      -> result: a

    add <<
      =
      a Integer
      b Integer
      =
      result Integer = a + b
      -> result: result

    @testOne
      =
      result: r Integer = add(5)
      -> :r

    @testTwo
      =
      result: r Integer = add(3, 7)
      -> :r
  `;

  it('1-arg matches first clause', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testOne', from: 'c' } },
      { output: { id: '1', 'bv-a': { r: 'Integer' }, re: { r: 5 }, to: 'c' } },
    );
  });

  it('2-arg matches appended clause', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testTwo', from: 'c' } },
      { output: { id: '2', 'bv-a': { r: 'Integer' }, re: { r: 10 }, to: 'c' } },
    );
  });
});

// ── Runtime: lambda overloads ───────────────────────────────────────────────

describe('overload — lambda — runtime', () => {
  const script = `
    @testLambdaAppend
      =
      fn = (a) { a * 2 }
      fn << (a, b) { a + b }
      r1 Integer = fn(5)
      r2 Integer = fn(3, 4)
      -> result: (r1 + r2)

  `;

  it('lambda << — single and double args dispatch correctly', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testLambdaAppend', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 17 }, to: 'c' } },
    );
  });
});

// ── Runtime: mixed delimited and lineal ─────────────────────────────────────

describe('overload — mixed forms — runtime', () => {
  const script = `
    @echo = (:msg Text) -> result: msg
    @echo << (:msg Integer) -> result: "number"

    @testText
      =
      :result Text = echo(msg: "hi")
      -> :result

    @testNumber
      =
      :result Text = echo(msg: 42)
      -> :result
  `;

  it('text arg matches first clause', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ msg: 'hi' }, '@echo'], 'bv-a': [{ msg: 'Text' }], from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hi' }, to: 'c' } },
    );
  });

  it('integer arg matches appended clause', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [{ msg: 42 }, '@echo'], 'bv-a': [{ msg: 'Integer' }], from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'number' }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Function() — empty overload initialization
//
// Function() creates an empty overload with zero clauses.
// All clauses are added via <<.
// Calling an empty overload is unhandled.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Function() — empty overload — compilation', () => {
  it('Function() compiles', () => {
    expect(() => compileSource(`
      fn = Function()
      fn << (a Integer) -> a
      @test = { result Integer = fn(5); -> :result }
    `)).not.toThrow();
  });

  it('Function() with only << clauses compiles', () => {
    expect(() => compileSource(`
      @calc = Function()
      @calc << (a Integer) -> result: a
      @calc << (a Integer, b Integer) -> result: (a + b)
    `)).not.toThrow();
  });

  it('bare Function() with no clauses compiles', () => {
    expect(() => compileSource(`
      fn = Function()
      @test = -> 1
    `)).not.toThrow();
  });
});

describe('Function() — empty overload — runtime', () => {
  const script = `
    @calc = Function()
    @calc << (a Integer) -> result: a
    @calc << (a Integer, b Integer) -> result: (a + b)
    @calc << (a Integer, b Integer, c Integer) -> result: (a + b + c)
  `;

  it('1-arg dispatches correctly', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], '@calc'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } },
    );
  });

  it('2-arg dispatches correctly', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[3, 4], '@calc'], 'bv-a': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('3-arg dispatches correctly', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[1, 2, 3], '@calc'], 'bv-a': [['Integer', 'Integer', 'Integer']], from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });
});

describe('Function() — empty overload called with no clauses', () => {
  const script = `
    @noop = Function()
  `;

  it('calling empty overload is unhandled', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '@noop'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', ex: { '@noop': 'unhandled' }, to: 'c' } },
    );
  });
});

describe('Function() — lambda empty overload — runtime', () => {
  const script = `
    @testAllAppend
      =
      fn = Function()
      fn << (a) { a * 2 }
      fn << (a, b) { a + b }
      r1 Integer = fn(5)
      r2 Integer = fn(3, 4)
      -> result: (r1 + r2)
  `;

  it('all-<< lambda dispatches correctly', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testAllAppend', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 17 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Optional args
//
// Multiple handlers with the same name, different param shapes.
// Dispatch: first match wins, most specific first.
// Optional args: if a missing arg can be supplied by a default, the match succeeds.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Basic arity overloading (no defaults) ───────────────────────────────────

describe('overload — arity dispatch', () => {
  const script = `
    @calc
      =
      a Integer
      =
      ->(result: a)

    @calc <<
      =
      a Integer
      b Integer
      =
      result Integer = a + b
      ->(result: result)

    @calc <<
      =
      a Integer
      b Integer
      c Integer
      =
      result Integer = a + b + c
      ->(result: result)
  `;

  it('1-arg dispatches to unary handler', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[10], '@calc'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('2-arg dispatches to binary handler', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[3, 4], '@calc'], 'bv-a': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('3-arg dispatches to ternary handler', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[1, 2, 3], '@calc'], 'bv-a': [['Integer', 'Integer', 'Integer']], from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });
});

// ── Overloading with optional positional args ───────────────────────────────

describe('overload — optional positional args fill gaps', () => {
  const script = `
    @add
      =
      a Integer
      b Integer = 0
      =
      result Integer = a + b
      ->(result: result)

    @add <<
      =
      a Integer
      b Integer
      c Integer
      =
      result Integer = a + b + c
      ->(result: result)
  `;

  it('1-arg matches first handler via default b=0', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], '@add'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } },
    );
  });

  it('2-arg matches first handler (both provided)', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[3, 7], '@add'], 'bv-a': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('3-arg matches second handler (no defaults needed)', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[1, 2, 3], '@add'], 'bv-a': [['Integer', 'Integer', 'Integer']], from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });
});

// ── Overloading with optional named args ────────────────────────────────────

describe('overload — optional named args', () => {
  const script = `
    @greet
      =
      :name Text
      :greeting Text = "hello"
      =
      -> result: (greeting + " " + name)

    @greet <<
      =
      :name Text
      :greeting Text
      :punctuation Text
      =
      -> result: (greeting + " " + name + punctuation)
  `;

  it('name-only matches first handler, greeting defaults', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ name: 'world' }, '@greet'], 'bv-a': [{ name: 'Text' }], from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hello world' }, to: 'c' } },
    );
  });

  it('name + greeting matches first handler', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [{ name: 'world', greeting: 'hey' }, '@greet'], 'bv-a': [{ name: 'Text', greeting: 'Text' }], from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'hey world' }, to: 'c' } },
    );
  });

  it('all three named args matches second handler', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [{ name: 'world', greeting: 'hey', punctuation: '!' }, '@greet'], 'bv-a': [{ name: 'Text', greeting: 'Text', punctuation: 'Text' }], from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'hey world!' }, to: 'c' } },
    );
  });
});

// ── Lambda with optional args ───────────────────────────────────────────────

describe('overload — lambda with optional args', () => {
  const script = `
    @testBothProvided
      =
      fn = (a Integer, b Integer = 10) { a + b }
      result Integer = fn(3, 5)
      -> :result

    @testDefaultUsed
      =
      fn = (a Integer, b Integer = 10) { a + b }
      result Integer = fn(3)
      -> :result

    @testNamedDefault
      =
      fn = (:a Integer, :b Integer = 99) { a + b }
      result Integer = fn(a: 1, b: 2)
      -> :result

    @testNamedDefaultOmitted
      =
      fn = (:a Integer, :b Integer = 99) { a + b }
      result Integer = fn(a: 1)
      -> :result
  `;

  it('lambda — both args provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testBothProvided', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 8 }, to: 'c' } },
    );
  });

  it('lambda — optional arg uses default', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testDefaultUsed', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 13 }, to: 'c' } },
    );
  });

  it('lambda — named args both provided', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@testNamedDefault', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } },
    );
  });

  it('lambda — named optional uses default', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@testNamedDefaultOmitted', from: 'c' } },
      { output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 100 }, to: 'c' } },
    );
  });
});

// ── Private function overloading with defaults ──────────────────────────────

describe('overload — private lineal functions with defaults', () => {
  const script = `
    combine
      =
      a Integer
      b=1000
      =
      result Integer = a + b
      -> result: result

    @testWithBoth
      =
      result: r Integer = combine(5, 2)
      -> :r

    @testWithDefault
      =
      result: r Integer = combine(5)
      -> :r
  `;

  it('private fn — both args provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testWithBoth', from: 'c' } },
      { output: { id: '1', 'bv-a': { r: 'Integer' }, re: { r: 7 }, to: 'c' } },
    );
  });

  it('private fn — optional arg uses default', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testWithDefault', from: 'c' } },
      { output: { id: '2', 'bv-a': { r: 'Integer' }, re: { r: 1005 }, to: 'c' } },
    );
  });
});
