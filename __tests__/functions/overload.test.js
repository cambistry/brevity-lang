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
        return result: result
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
        return result: result
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
      @test = { result Integer = fn(1, 2); return :result }
    `)).not.toThrow();
  });

  it('private duplicate = is a redefinition error', () => {
    expect(() => compileSource(`
      fn = (a) { a }
      fn = (a, b) { a + b }
      @test = { result Integer = fn(1); return :result }
    `)).toThrow();
  });
});

describe('overload — runtime', () => {
  const script = `
    // overload — << append — runtime
    @calc = (a Integer) -> result: a
    @calc << (a Integer, b Integer) -> result: (a + b)
    @calc << (a Integer, b Integer, c Integer) -> result: (a + b + c)

    // overload — lineal form — runtime
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
      return result: result

    @testOne
      =
      result: r Integer = add(5)
      return :r

    @testTwo
      =
      result: r Integer = add(3, 7)
      return :r

    // overload — lambda — runtime
    @testLambdaAppend
      =
      fn = (a) { a * 2 }
      fn << (a, b) { a + b }
      r1 Integer = fn(5)
      r2 Integer = fn(3, 4)
      return result: (r1 + r2)

    // overload — mixed forms — runtime
    @echo = (msg: Text) -> result: msg
    @echo << (msg: Integer) -> result: "number"

    @testText
      =
      :result Text = @echo(msg: "hi")
      return :result

    @testNumber
      =
      :result Text = @echo(msg: 42)
      return :result

    // Function() — empty overload — runtime
    @calc5 = Function()
    @calc5 << (a Integer) -> result: a
    @calc5 << (a Integer, b Integer) -> result: (a + b)
    @calc5 << (a Integer, b Integer, c Integer) -> result: (a + b + c)

    // Function() — empty overload called with no clauses
    @noop = Function()

    // Function() — lambda empty overload — runtime
    @testAllAppend
      =
      fn = Function()
      fn << (a) { a * 2 }
      fn << (a, b) { a + b }
      r1 Integer = fn(5)
      r2 Integer = fn(3, 4)
      return result: (r1 + r2)

    // overload — arity dispatch
    @calc8
      =
      a Integer
      =
      ->(result: a)

    @calc8 <<
      =
      a Integer
      b Integer
      =
      result Integer = a + b
      return (result: result)

    @calc8 <<
      =
      a Integer
      b Integer
      c Integer
      =
      result Integer = a + b + c
      return (result: result)

    // overload — optional positional args fill gaps
    @add
      =
      a Integer
      b Integer = 0
      =
      result Integer = a + b
      return (result: result)

    @add <<
      =
      a Integer
      b Integer
      c Integer
      =
      result Integer = a + b + c
      return (result: result)

    // overload — optional named args
    @greet
      =
      name: Text
      greeting: Text = "hello"
      =
      -> result: (greeting + " " + name)

    @greet <<
      =
      name: Text
      greeting: Text
      punctuation: Text
      =
      -> result: (greeting + " " + name + punctuation)

    // overload — lambda with optional args
    @testBothProvided
      =
      fn = (a Integer, b Integer = 10) { a + b }
      result Integer = fn(3, 5)
      return :result

    @testDefaultUsed
      =
      fn = (a Integer, b Integer = 10) { a + b }
      result Integer = fn(3)
      return :result

    @testNamedDefault
      =
      fn = (a: Integer, b: Integer = 99) { a + b }
      result Integer = fn(a: 1, b: 2)
      return :result

    @testNamedDefaultOmitted
      =
      fn = (a: Integer, b: Integer = 99) { a + b }
      result Integer = fn(a: 1)
      return :result

    // overload — private lineal functions with defaults
    combine
      =
      a Integer
      b=1000
      =
      result Integer = a + b
      return result: result

    @testWithBoth
      =
      result: r Integer = combine(5, 2)
      return :r

    @testWithDefault
      =
      result: r Integer = combine(5)
      return :r

    // overload — method called on a class actor
    T = (x Integer) *{
      @put = (n Integer) -> v: n
      @put << (s Text) -> v: 0
    }

    @viaInteger = {
      t = T(1)
      :v Integer = t.put(5)
      return :v
    }

    @viaText = {
      t = T(1)
      :v Integer = t.put("a")
      return :v
    }

    // overload — handler a file calls on itself
    @put = (n Integer) -> v: n
    @put << (s Text) -> v: 0

    @viaInteger14 = {
      :v Integer = @put(5)
      return :v
    }

    @viaText14 = {
      :v Integer = @put("a")
      return :v
    }
  `;

  // ── Runtime: << appends (tried after existing clauses) ──────────────────────

  it('overload — << append — runtime — 1-arg matches first clause', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[10], 'calc'], 'ty': [['Integer']], from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('overload — << append — runtime — 2-arg matches second clause', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[3, 4], 'calc'], 'ty': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('overload — << append — runtime — 3-arg matches third clause', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[1, 2, 3], 'calc'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } },
      { output: { id: '3', 'ty': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });

  // ── Runtime: lineal form overloads ──────────────────────────────────────────

  it('overload — lineal form — runtime — 1-arg matches first clause', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testOne', from: 'c' } },
      { output: { id: '1', 'ty': { r: 'Integer' }, re: { r: 5 }, to: 'c' } },
    );
  });

  it('overload — lineal form — runtime — 2-arg matches appended clause', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'testTwo', from: 'c' } },
      { output: { id: '2', 'ty': { r: 'Integer' }, re: { r: 10 }, to: 'c' } },
    );
  });

  // ── Runtime: lambda overloads ───────────────────────────────────────────────

  it('overload — lambda — runtime — lambda << — single and double args dispatch correctly', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testLambdaAppend', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 17 }, to: 'c' } },
    );
  });

  // ── Runtime: mixed delimited and lineal ─────────────────────────────────────

  it('overload — mixed forms — runtime — text arg matches first clause', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[{ msg: 'hi' }], 'echo'], 'ty': [[{ msg: 'Text' }]], from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Text' }, re: { result: 'hi' }, to: 'c' } },
    );
  });

  it('overload — mixed forms — runtime — integer arg matches appended clause', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[{ msg: 42 }], 'echo'], 'ty': [[{ msg: 'Integer' }]], from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Text' }, re: { result: 'number' }, to: 'c' } },
    );
  });

  it('Function() — empty overload — runtime — 1-arg dispatches correctly', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], 'calc5'], 'ty': [['Integer']], from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 5 }, to: 'c' } },
    );
  });

  it('Function() — empty overload — runtime — 2-arg dispatches correctly', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[3, 4], 'calc5'], 'ty': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('Function() — empty overload — runtime — 3-arg dispatches correctly', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[1, 2, 3], 'calc5'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } },
      { output: { id: '3', 'ty': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });

  it('Function() — empty overload called with no clauses — calling empty overload is unhandled', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], 'noop'], 'ty': [['Integer']], from: 'c' } },
      { output: { id: '1', ex: { 'noop': 'unhandled' }, to: 'c' } },
    );
  });

  it('Function() — lambda empty overload — runtime — all-<< lambda dispatches correctly', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testAllAppend', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 17 }, to: 'c' } },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Optional args
  //
  // Multiple handlers with the same name, different param shapes.
  // Dispatch: first match wins, most specific first.
  // Optional args: if a missing arg can be supplied by a default, the match succeeds.
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // ── Basic arity overloading (no defaults) ───────────────────────────────────

  it('overload — arity dispatch — 1-arg dispatches to unary handler', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[10], 'calc8'], 'ty': [['Integer']], from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('overload — arity dispatch — 2-arg dispatches to binary handler', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[3, 4], 'calc8'], 'ty': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('overload — arity dispatch — 3-arg dispatches to ternary handler', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[1, 2, 3], 'calc8'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } },
      { output: { id: '3', 'ty': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });

  // ── Overloading with optional positional args ───────────────────────────────

  it('overload — optional positional args fill gaps — 1-arg matches first handler via default b=0', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], 'add'], 'ty': [['Integer']], from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 5 }, to: 'c' } },
    );
  });

  it('overload — optional positional args fill gaps — 2-arg matches first handler (both provided)', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[3, 7], 'add'], 'ty': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('overload — optional positional args fill gaps — 3-arg matches second handler (no defaults needed)', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[1, 2, 3], 'add'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } },
      { output: { id: '3', 'ty': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });

  // ── Overloading with optional named args ────────────────────────────────────

  it('overload — optional named args — name-only matches first handler, greeting defaults', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[{ name: 'world' }], 'greet'], 'ty': [[{ name: 'Text' }]], from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Text' }, re: { result: 'hello world' }, to: 'c' } },
    );
  });

  it('overload — optional named args — name + greeting matches first handler', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[{ name: 'world', greeting: 'hey' }], 'greet'], 'ty': [[{ name: 'Text', greeting: 'Text' }]], from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Text' }, re: { result: 'hey world' }, to: 'c' } },
    );
  });

  it('overload — optional named args — all three named args matches second handler', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[{ name: 'world', greeting: 'hey', punctuation: '!' }], 'greet'], 'ty': [[{ name: 'Text', greeting: 'Text', punctuation: 'Text' }]], from: 'c' } },
      { output: { id: '3', 'ty': { result: 'Text' }, re: { result: 'hey world!' }, to: 'c' } },
    );
  });

  // ── Lambda with optional args ───────────────────────────────────────────────

  it('overload — lambda with optional args — lambda — both args provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testBothProvided', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 8 }, to: 'c' } },
    );
  });

  it('overload — lambda with optional args — lambda — optional arg uses default', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'testDefaultUsed', from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Integer' }, re: { result: 13 }, to: 'c' } },
    );
  });

  it('overload — lambda with optional args — lambda — named args both provided', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'testNamedDefault', from: 'c' } },
      { output: { id: '3', 'ty': { result: 'Integer' }, re: { result: 3 }, to: 'c' } },
    );
  });

  it('overload — lambda with optional args — lambda — named optional uses default', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: 'testNamedDefaultOmitted', from: 'c' } },
      { output: { id: '4', 'ty': { result: 'Integer' }, re: { result: 100 }, to: 'c' } },
    );
  });

  // ── Private function overloading with defaults ──────────────────────────────

  it('overload — private lineal functions with defaults — private fn — both args provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testWithBoth', from: 'c' } },
      { output: { id: '1', 'ty': { r: 'Integer' }, re: { r: 7 }, to: 'c' } },
    );
  });

  it('overload — private lineal functions with defaults — private fn — optional arg uses default', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'testWithDefault', from: 'c' } },
      { output: { id: '2', 'ty': { r: 'Integer' }, re: { r: 1005 }, to: 'c' } },
    );
  });

  it('overload — method called on a class actor — the first clause takes its own argument type', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'viaInteger', from: 'c' } },
      { output: { id: '1', 'ty': { v: 'Integer' }, re: { v: 5 }, to: 'c' } },
    );
  });

  it('overload — method called on a class actor — the appended clause takes its own argument type', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'viaText', from: 'c' } },
      { output: { id: '2', 'ty': { v: 'Integer' }, re: { v: 0 }, to: 'c' } },
    );
  });

  it('overload — method called on a class actor — an argument no clause takes is rejected', () => {
    expect(() => compileSource(script.replace('t.put("a")', 't.put(true)')))
      .toThrow(/'T.put\(\)' positional arg 1: 'Boolean' is not assignable/);
  });

  it('overload — handler a file calls on itself — the first clause takes its own argument type', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'viaInteger14', from: 'c' } },
      { output: { id: '1', 'ty': { v: 'Integer' }, re: { v: 5 }, to: 'c' } },
    );
  });

  it('overload — handler a file calls on itself — the appended clause takes its own argument type', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'viaText14', from: 'c' } },
      { output: { id: '2', 'ty': { v: 'Integer' }, re: { v: 0 }, to: 'c' } },
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
      @test = { result Integer = fn(5); return :result }
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