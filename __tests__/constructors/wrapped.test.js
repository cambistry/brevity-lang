import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Wrapped child constructor — * syntax for actor references
//
// Forms:
//   T = <super *> { body }        positional actor ref
//   T = <super*> { body }         sugared (star attached to ident)
//   T = <name: *> { body }        keyed actor ref
//   T = <name: (alias) *> { body} keyed with internal alias
//   T = <name: alias*> { body }   keyed sugared
// ═══════════════════════════════════════════════════════════════════════════════

describe('wrapped child — positional * syntax — compilation', () => {
  it('positional actor ref with spaced star compiles', () => {
    expect(() => compileSource(`
      Inner = <> {
        @double = |n: Integer| -> result: (n * 2) as Integer
      }

      Wrapper = <inner *> {
        @quadruple = |n: Integer| {
          result: Integer = inner.double(n: n)
          -> result: (result * 2) as Integer
        }
      }

      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('positional actor ref with attached star compiles', () => {
    expect(() => compileSource(`
      Inner = <> {
        @double = |n: Integer| -> result: (n * 2) as Integer
      }

      Wrapper = <inner*> {
        @quadruple = |n: Integer| {
          result: Integer = inner.double(n: n)
          -> result: (result * 2) as Integer
        }
      }

      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('multiple positional actor refs compile', () => {
    expect(() => compileSource(`
      Adder = <> {
        @add = |a: Integer, b: Integer| -> sum: (a + b) as Integer
      }

      Multiplier = <> {
        @mul = |a: Integer, b: Integer| -> product: (a * b) as Integer
      }

      Calculator = <adder *, multiplier *> {
        @compute = |a: Integer, b: Integer| {
          sum: Integer = adder.add(a: a, b: b)
          product: Integer = multiplier.mul(a: a, b: b)
          -> :sum, :product
        }
      }

      @test = -> 1 as Integer
    `)).not.toThrow();
  });
});

describe('wrapped child — keyed * syntax — compilation', () => {
  it('keyed actor ref compiles', () => {
    expect(() => compileSource(`
      Inner = <> {
        @double = |n: Integer| -> result: (n * 2) as Integer
      }

      Wrapper = <inner: *> {
        @quadruple = |n: Integer| {
          result: Integer = inner.double(n: n)
          -> result: (result * 2) as Integer
        }
      }

      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('keyed actor ref with alias compiles', () => {
    expect(() => compileSource(`
      Inner = <> {
        @double = |n: Integer| -> result: (n * 2) as Integer
      }

      Wrapper = <child: (inner) *> {
        @quadruple = |n: Integer| {
          result: Integer = inner.double(n: n)
          -> result: (result * 2) as Integer
        }
      }

      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('keyed actor ref with sugared alias compiles', () => {
    expect(() => compileSource(`
      Inner = <> {
        @double = |n: Integer| -> result: (n * 2) as Integer
      }

      Wrapper = <child: inner*> {
        @quadruple = |n: Integer| {
          result: Integer = inner.double(n: n)
          -> result: (result * 2) as Integer
        }
      }

      @test = -> 1 as Integer
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Wrapped child — runtime delegation with * syntax
// ═══════════════════════════════════════════════════════════════════════════════

describe('wrapped child — runtime with *', () => {
  it('positional * delegates to child', async () => {
    const script = `
      Inner = <> {
        @double = |n: Integer| -> result: (n * 2) as Integer
      }

      Wrapper = <inner *> {
        @quadruple = |n: Integer| {
          result: Integer = inner.double(n: n)
          -> result: (result * 2) as Integer
        }
      }

      @test
        =
        i = Inner()
        w = Wrapper(i)
        :result = w.quadruple(n: 5)
        -> :result as Integer
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 20 }, to: 'c' } },
    );
  });

  it('attached star* delegates to child', async () => {
    const script = `
      Inner = <> {
        @double = |n: Integer| -> result: (n * 2) as Integer
      }

      Wrapper = <inner*> {
        @quadruple = |n: Integer| {
          result: Integer = inner.double(n: n)
          -> result: (result * 2) as Integer
        }
      }

      @test
        =
        i = Inner()
        w = Wrapper(i)
        :result = w.quadruple(n: 5)
        -> :result as Integer
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 20 }, to: 'c' } },
    );
  });

  it('keyed * delegates to child', async () => {
    const script = `
      Inner = <> {
        @double = |n: Integer| -> result: (n * 2) as Integer
      }

      Wrapper = <inner: *> {
        @quadruple = |n: Integer| {
          result: Integer = inner.double(n: n)
          -> result: (result * 2) as Integer
        }
      }

      @test
        =
        i = Inner()
        w = Wrapper(inner: i)
        :result = w.quadruple(n: 5)
        -> :result as Integer
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 20 }, to: 'c' } },
    );
  });

  it('keyed alias * delegates via alias', async () => {
    const script = `
      Inner = <> {
        @double = |n: Integer| -> result: (n * 2) as Integer
      }

      Wrapper = <child: (inner) *> {
        @quadruple = |n: Integer| {
          result: Integer = inner.double(n: n)
          -> result: (result * 2) as Integer
        }
      }

      @test
        =
        i = Inner()
        w = Wrapper(child: i)
        :result = w.quadruple(n: 5)
        -> :result as Integer
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 20 }, to: 'c' } },
    );
  });

  it('keyed sugared alias* delegates via alias', async () => {
    const script = `
      Inner = <> {
        @double = |n: Integer| -> result: (n * 2) as Integer
      }

      Wrapper = <child: inner*> {
        @quadruple = |n: Integer| {
          result: Integer = inner.double(n: n)
          -> result: (result * 2) as Integer
        }
      }

      @test
        =
        i = Inner()
        w = Wrapper(child: i)
        :result = w.quadruple(n: 5)
        -> :result as Integer
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 20 }, to: 'c' } },
    );
  });

  it('wrapper with state delegates and transforms', async () => {
    const script = `
      Doubler = <> {
        @double = |n: Integer| -> result: (n * 2) as Integer
      }

      Cached = <doubler *> {
        @compute = |n: Integer| {
          result: Integer = doubler.double(n: n)
          -> result: (result + 1) as Integer
        }
      }

      @test
        =
        d = Doubler()
        c = Cached(d)
        :result = c.compute(n: 7)
        -> :result as Integer
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Wrapped child — child still independently addressable
// ═══════════════════════════════════════════════════════════════════════════════

describe('wrapped child — independence', () => {
  it('child is still callable directly after being wrapped', async () => {
    const script = `
      Inner = <> {
        @value = -> result: 42 as Integer
      }

      Wrapper = <inner *> {
        @get = {
          result: Integer = inner.value()
          -> result: (result + 1) as Integer
        }
      }

      @test
        =
        i = Inner()
        w = Wrapper(i)
        :result = i.value()
        -> :result as Integer
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('wrapper produces different result than direct child call', async () => {
    const script = `
      Inner = <> {
        @value = -> result: 42 as Integer
      }

      Wrapper = <inner *> {
        @get = {
          result: Integer = inner.value()
          -> result: (result + 1) as Integer
        }
      }

      @test
        =
        i = Inner()
        w = Wrapper(i)
        :result = w.get()
        -> :result as Integer
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 43 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Validation — * params are generic, validated at instantiation site
//
// The wrapping actor's definition compiles fine (it's a generic).
// The error surfaces when you instantiate it with an actor that lacks
// the methods the wrapper calls on the * param.
// ═══════════════════════════════════════════════════════════════════════════════

describe('wrapped child — definition always compiles (generic)', () => {
  it('wrapper calling nonexistent method on * param compiles alone', () => {
    expect(() => compileSource(`
      Wrapper = <super *> {
        @try = {
          result: Integer = super.no_such_method()
          -> :result as Integer
        }
      }

      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('keyed * calling nonexistent method compiles alone', () => {
    expect(() => compileSource(`
      Wrapper = <name: *> {
        @try = {
          result: Integer = name.no_such_method()
          -> :result as Integer
        }
      }

      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('alias * calling nonexistent method compiles alone', () => {
    expect(() => compileSource(`
      Wrapper = <name: (s) *> {
        @try = {
          result: Integer = s.no_such_method()
          -> :result as Integer
        }
      }

      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('sugared alias* calling nonexistent method compiles alone', () => {
    expect(() => compileSource(`
      Wrapper = <name: s*> {
        @try = {
          result: Integer = s.no_such_method()
          -> :result as Integer
        }
      }

      @test = -> 1 as Integer
    `)).not.toThrow();
  });
});

describe('wrapped child — instantiation fails when method missing', () => {
  it('positional * — missing method', () => {
    expect(() => compileSource(`
      A = <> {
        @meth = -> result: 1 as Integer
      }

      B = <super *> {
        @try = {
          result: Integer = super.not_a_meth()
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).toThrow(/not_a_meth/);
  });

  it('attached star* — missing method', () => {
    expect(() => compileSource(`
      A = <> {
        @meth = -> result: 1 as Integer
      }

      B = <super*> {
        @try = {
          result: Integer = super.not_a_meth()
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).toThrow(/not_a_meth/);
  });

  it('keyed * — missing method', () => {
    expect(() => compileSource(`
      A = <> {
        @meth = -> result: 1 as Integer
      }

      B = <name: *> {
        @try = {
          result: Integer = name.not_a_meth()
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(name: a)
        -> 1 as Integer
    `)).toThrow(/not_a_meth/);
  });

  it('keyed alias * — missing method', () => {
    expect(() => compileSource(`
      A = <> {
        @meth = -> result: 1 as Integer
      }

      B = <child: (s) *> {
        @try = {
          result: Integer = s.not_a_meth()
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(child: a)
        -> 1 as Integer
    `)).toThrow(/not_a_meth/);
  });

  it('keyed sugared alias* — missing method', () => {
    expect(() => compileSource(`
      A = <> {
        @meth = -> result: 1 as Integer
      }

      B = <child: s*> {
        @try = {
          result: Integer = s.not_a_meth()
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(child: a)
        -> 1 as Integer
    `)).toThrow(/not_a_meth/);
  });

  it('multiple missing methods reported', () => {
    expect(() => compileSource(`
      A = <> {
        @meth = -> result: 1 as Integer
      }

      B = <super *> {
        @try = {
          x: Integer = super.foo()
          y: Integer = super.bar()
          -> result: (x + y) as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).toThrow(/foo|bar/);
  });

  it('some methods present, one missing — still fails', () => {
    expect(() => compileSource(`
      A = <> {
        @meth = -> result: 1 as Integer
        @other = -> result: 2 as Integer
      }

      B = <super *> {
        @try = {
          x: Integer = super.meth()
          y: Integer = super.missing()
          -> result: (x + y) as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).toThrow(/missing/);
  });
});

describe('wrapped child — instantiation succeeds when methods match', () => {
  it('positional * — method exists', () => {
    expect(() => compileSource(`
      A = <> {
        @meth = -> result: 1 as Integer
      }

      B = <super *> {
        @try = {
          result: Integer = super.meth()
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).not.toThrow();
  });

  it('keyed * — method exists', () => {
    expect(() => compileSource(`
      A = <> {
        @meth = -> result: 1 as Integer
      }

      B = <name: *> {
        @try = {
          result: Integer = name.meth()
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(name: a)
        -> 1 as Integer
    `)).not.toThrow();
  });

  it('alias * — method exists', () => {
    expect(() => compileSource(`
      A = <> {
        @meth = -> result: 1 as Integer
      }

      B = <child: (s) *> {
        @try = {
          result: Integer = s.meth()
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(child: a)
        -> 1 as Integer
    `)).not.toThrow();
  });

  it('sugared alias* — method exists', () => {
    expect(() => compileSource(`
      A = <> {
        @meth = -> result: 1 as Integer
      }

      B = <child: s*> {
        @try = {
          result: Integer = s.meth()
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(child: a)
        -> 1 as Integer
    `)).not.toThrow();
  });

  it('multiple methods all present', () => {
    expect(() => compileSource(`
      A = <> {
        @foo = -> result: 1 as Integer
        @bar = -> result: 2 as Integer
      }

      B = <super *> {
        @try = {
          x: Integer = super.foo()
          y: Integer = super.bar()
          -> result: (x + y) as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Validation — argument type checking at instantiation site
//
// When B calls inner.add(y: "ten") and A's @add expects |y: Integer|,
// the error surfaces at b = B(a), not at B's definition.
// ═══════════════════════════════════════════════════════════════════════════════

describe('wrapped child — arg type mismatch at instantiation', () => {
  it('string literal passed where Integer expected', () => {
    expect(() => compileSource(`
      A = <> {
        @add = |y: Integer| -> result: (y + 1) as Integer
      }

      B = <inner *> {
        @do = {
          result: Integer = inner.add(y: "ten")
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).toThrow(/type/i);
  });

  it('integer literal passed where Text expected', () => {
    expect(() => compileSource(`
      A = <> {
        @greet = |name: Text| -> result: name as Text
      }

      B = <inner *> {
        @do = {
          result: Text = inner.greet(name: 42)
          -> :result as Text
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> "x" as Text
    `)).toThrow(/type/i);
  });

  it('boolean literal passed where Integer expected', () => {
    expect(() => compileSource(`
      A = <> {
        @add = |y: Integer| -> result: (y + 1) as Integer
      }

      B = <inner *> {
        @do = {
          result: Integer = inner.add(y: true)
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).toThrow(/type/i);
  });

  it('typed variable with wrong type', () => {
    expect(() => compileSource(`
      A = <> {
        @add = |y: Integer| -> result: (y + 1) as Integer
      }

      B = <inner *> {
        @do = |s: Text| {
          result: Integer = inner.add(y: s)
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).toThrow(/type/i);
  });

  it('multiple args — one mismatched', () => {
    expect(() => compileSource(`
      A = <> {
        @calc = |x: Integer, y: Integer| -> result: (x + y) as Integer
      }

      B = <inner *> {
        @do = {
          result: Integer = inner.calc(x: 1, y: "two")
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).toThrow(/type/i);
  });

  it('keyed * — type mismatch', () => {
    expect(() => compileSource(`
      A = <> {
        @add = |y: Integer| -> result: (y + 1) as Integer
      }

      B = <child: *> {
        @do = {
          result: Integer = child.add(y: "ten")
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(child: a)
        -> 1 as Integer
    `)).toThrow(/type/i);
  });

  it('alias * — type mismatch', () => {
    expect(() => compileSource(`
      A = <> {
        @add = |y: Integer| -> result: (y + 1) as Integer
      }

      B = <child: (s) *> {
        @do = {
          result: Integer = s.add(y: "ten")
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(child: a)
        -> 1 as Integer
    `)).toThrow(/type/i);
  });
});

describe('wrapped child — arg types match at instantiation', () => {
  it('correct literal types pass', () => {
    expect(() => compileSource(`
      A = <> {
        @add = |y: Integer| -> result: (y + 1) as Integer
      }

      B = <inner *> {
        @do = {
          result: Integer = inner.add(y: 10)
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).not.toThrow();
  });

  it('typed variable with correct type passes', () => {
    expect(() => compileSource(`
      A = <> {
        @add = |y: Integer| -> result: (y + 1) as Integer
      }

      B = <inner *> {
        @do = |n: Integer| {
          result: Integer = inner.add(y: n)
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).not.toThrow();
  });

  it('multiple args all correct types pass', () => {
    expect(() => compileSource(`
      A = <> {
        @calc = |x: Integer, y: Integer| -> result: (x + y) as Integer
      }

      B = <inner *> {
        @do = {
          result: Integer = inner.calc(x: 1, y: 2)
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).not.toThrow();
  });

  it('no-arg method passes', () => {
    expect(() => compileSource(`
      A = <> {
        @value = -> result: 42 as Integer
      }

      B = <inner *> {
        @do = {
          result: Integer = inner.value()
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Inline service constraint — <inner { method: (Type) -> (Type) }>
//
// The constraint is declared in the constructor header. It replaces *
// with an explicit interface the ref param must satisfy.
// ═══════════════════════════════════════════════════════════════════════════════

describe('inline constraint — compilation', () => {
  it('basic inline constraint compiles', () => {
    expect(() => compileSource(`
      A = <> {
        @get = |key: Text| -> result: key as Text
      }

      B = <inner { @get: (key: Text) -> (result: Text) }> {
        @fetch = |query: Text| {
          result: Text = inner.get(key: query)
          -> :result as Text
        }
      }

      @test = -> "x" as Text
    `)).not.toThrow();
  });

  it('multi-method inline constraint compiles', () => {
    expect(() => compileSource(`
      A = <> {
        @get = |key: Text| -> result: key as Text
        @set = |key: Text, val: Text| -> ok: 1 as Integer
      }

      B = <inner { @get: (key: Text) -> (result: Text), @set: (key: Text, val: Text) -> (ok: Integer) }> {
        @fetch = |query: Text| {
          result: Text = inner.get(key: query)
          -> :result as Text
        }
      }

      @test = -> "x" as Text
    `)).not.toThrow();
  });

  it('constraint without * — inner is implicitly a ref', () => {
    expect(() => compileSource(`
      A = <> {
        @value = -> result: 42 as Integer
      }

      B = <inner { @value: () -> (result: Integer) }> {
        @do = {
          result: Integer = inner.value()
          -> :result as Integer
        }
      }

      @test = -> 1 as Integer
    `)).not.toThrow();
  });
});

describe('inline constraint — instantiation fails when constraint not met', () => {
  it('method missing from passed actor', () => {
    expect(() => compileSource(`
      A = <> {
        @other = -> result: 1 as Integer
      }

      B = <inner { @get: (key: Text) -> (result: Text) }> {
        @fetch = |query: Text| {
          result: Text = inner.get(key: query)
          -> :result as Text
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> "x" as Text
    `)).toThrow(/@get/);
  });

  it('param type mismatch in constraint', () => {
    expect(() => compileSource(`
      A = <> {
        @get = |key: Integer| -> result: 1 as Integer
      }

      B = <inner { @get: (key: Text) -> (result: Text) }> {
        @fetch = |query: Text| {
          result: Text = inner.get(key: query)
          -> :result as Text
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> "x" as Text
    `)).toThrow(/type/i);
  });

  it('return type mismatch in constraint', () => {
    expect(() => compileSource(`
      A = <> {
        @get = |key: Text| -> result: 1 as Integer
      }

      B = <inner { @get: (key: Text) -> (result: Text) }> {
        @fetch = |query: Text| {
          result: Text = inner.get(key: query)
          -> :result as Text
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> "x" as Text
    `)).toThrow(/type/i);
  });

  it('one of multiple methods missing', () => {
    expect(() => compileSource(`
      A = <> {
        @get = |key: Text| -> result: key as Text
      }

      B = <inner { @get: (key: Text) -> (result: Text), @set: (key: Text, val: Text) -> (ok: Integer) }> {
        @fetch = |query: Text| {
          result: Text = inner.get(key: query)
          -> :result as Text
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> "x" as Text
    `)).toThrow(/@set/);
  });
});

describe('inline constraint — instantiation succeeds when constraint met', () => {
  it('all methods and types match', () => {
    expect(() => compileSource(`
      A = <> {
        @get = |key: Text| -> result: key as Text
      }

      B = <inner { @get: (key: Text) -> (result: Text) }> {
        @fetch = |query: Text| {
          result: Text = inner.get(key: query)
          -> :result as Text
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> "x" as Text
    `)).not.toThrow();
  });

  it('actor has more methods than constraint requires', () => {
    expect(() => compileSource(`
      A = <> {
        @get = |key: Text| -> result: key as Text
        @set = |key: Text, val: Text| -> ok: 1 as Integer
        @delete = |key: Text| -> ok: 1 as Integer
      }

      B = <inner { @get: (key: Text) -> (result: Text) }> {
        @fetch = |query: Text| {
          result: Text = inner.get(key: query)
          -> :result as Text
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> "x" as Text
    `)).not.toThrow();
  });
});

describe('inline constraint — multi-line form', () => {
  it('multi-line constraint compiles', () => {
    expect(() => compileSource(`
      A = <> {
        @fetch = |id: Integer| -> result: 1 as Integer
        @query = |q: Text| -> result: q as Text
      }

      B = <inner {
        @fetch: (id: Integer) -> (result: Integer)
        @query: (q: Text) -> (result: Text)
      }> {
        @do = |q: Text| {
          result: Text = inner.query(q: q)
          -> :result as Text
        }
      }

      @test = -> "x" as Text
    `)).not.toThrow();
  });

  it('multi-line constraint delegates at runtime', async () => {
    const script = `
      Inner = <> {
        @fetch = |id: Integer| -> result: (id * 10) as Integer
        @query = |q: Text| -> result: q as Text
      }

      Wrapper = <inner {
        @fetch: (id: Integer) -> (result: Integer)
        @query: (q: Text) -> (result: Text)
      }> {
        @do = |id: Integer| {
          result: Integer = inner.fetch(id: id)
          -> :result as Integer
        }
      }

      @test
        =
        i = Inner()
        w = Wrapper(i)
        :result = w.do(id: 3)
        -> :result as Integer
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 30 }, to: 'c' } },
    );
  });

  it('multi-line constraint validates at instantiation', () => {
    expect(() => compileSource(`
      A = <> {
        @fetch = |id: Integer| -> result: 1 as Integer
      }

      B = <inner {
        @fetch: (id: Integer) -> (result: Integer)
        @query: (q: Text) -> (result: Text)
      }> {
        @do = |q: Text| {
          result: Text = inner.query(q: q)
          -> :result as Text
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> "x" as Text
    `)).toThrow(/@query/);
  });
});

describe('inline constraint — runtime', () => {
  it('delegates through constrained ref', async () => {
    const script = `
      Inner = <> {
        @double = |n: Integer| -> result: (n * 2) as Integer
      }

      Wrapper = <inner { @double: (n: Integer) -> (result: Integer) }> {
        @quadruple = |n: Integer| {
          result: Integer = inner.double(n: n)
          -> result: (result * 2) as Integer
        }
      }

      @test
        =
        i = Inner()
        w = Wrapper(i)
        :result = w.quadruple(n: 5)
        -> :result as Integer
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 20 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Service coercion — cast = inner as { @method: (Type) -> (Type) }
//
// The `as` cast creates a compile-time constrained alias for a * ref param.
// Calls through the cast bypass instantiation-time structural checks —
// the developer takes responsibility for runtime behavior.
// ═══════════════════════════════════════════════════════════════════════════════

describe('service coercion — compilation', () => {
  it('basic as-cast in constructor body compiles', () => {
    expect(() => compileSource(`
      A = <> {
        @do = |x: Integer| -> result: (x + 1) as Integer
      }

      B = <inner *> {
        cast = inner as { @do: (x: Integer) -> (result: Integer) }
        @action = |x: Integer| {
          result: Integer = cast.do(x: x)
          -> :result as Integer
        }
      }

      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('cast bypasses instantiation check — actor lacks method', () => {
    expect(() => compileSource(`
      A = <> {
        @other = -> result: 1 as Integer
      }

      B = <inner *> {
        cast = inner as { @do: (x: Integer) -> (result: Integer) }
        @action = |x: Integer| {
          result: Integer = cast.do(x: x)
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).not.toThrow();
  });

  it('direct call on inner without cast still validates', () => {
    expect(() => compileSource(`
      A = <> {
        @other = -> result: 1 as Integer
      }

      B = <inner *> {
        cast = inner as { @do: (x: Integer) -> (result: Integer) }
        @action = |x: Integer| {
          result: Integer = inner.missing(x: x)
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).toThrow(/missing/);
  });

  it('cast constraint rejects wrong arg type', () => {
    expect(() => compileSource(`
      A = <> {
        @handle = |x: Integer| -> result: (x + 1) as Integer
      }

      B = <inner *> {
        narrow = inner as { @handle: (x: Integer) -> (result: Integer) }
        @go = {
          result: Integer = narrow.handle(x: "hello")
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).toThrow(/type/i);
  });

  it('cast constraint rejects wrong arg type from typed variable', () => {
    expect(() => compileSource(`
      A = <> {
        @handle = |x: Integer| -> result: (x + 1) as Integer
      }

      B = <inner *> {
        narrow = inner as { @handle: (x: Integer) -> (result: Integer) }
        @go = |s: Text| {
          result: Integer = narrow.handle(x: s)
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).toThrow(/type/i);
  });

  it('cast constraint allows correct arg type', () => {
    expect(() => compileSource(`
      A = <> {
        @handle = |x: Integer| -> result: (x + 1) as Integer
      }

      B = <inner *> {
        narrow = inner as { @handle: (x: Integer) -> (result: Integer) }
        @go = |n: Integer| {
          result: Integer = narrow.handle(x: n)
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        -> 1 as Integer
    `)).not.toThrow();
  });

  it('multi-method cast compiles', () => {
    expect(() => compileSource(`
      A = <> {
        @get = |k: Text| -> result: k as Text
        @set = |k: Text, v: Text| -> ok: 1 as Integer
      }

      B = <inner *> {
        store = inner as {
          @get: (k: Text) -> (result: Text)
          @set: (k: Text, v: Text) -> (ok: Integer)
        }
        @fetch = |k: Text| {
          result: Text = store.get(k: k)
          -> :result as Text
        }
      }

      @test = -> "x" as Text
    `)).not.toThrow();
  });
});

describe('service coercion — runtime', () => {
  it('cast delegates to actual actor at runtime', async () => {
    const script = `
      Inner = <> {
        @double = |n: Integer| -> result: (n * 2) as Integer
      }

      Wrapper = <inner *> {
        d = inner as { @double: (n: Integer) -> (result: Integer) }
        @compute = |n: Integer| {
          result: Integer = d.double(n: n)
          -> result: (result + 1) as Integer
        }
      }

      @test
        =
        i = Inner()
        w = Wrapper(i)
        :result = w.compute(n: 5)
        -> :result as Integer
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'c' } },
    );
  });

  it('cast narrows wider type — correct arg type passes', async () => {
    // Inner.@handle accepts Anything, but the cast narrows to Integer.
    // Calling through the cast with an Integer should work fine.
    const script = `
      Inner = <> {
        @handle = |x: Integer| -> result: (x + 100) as Integer
      }

      Wrapper = <inner *> {
        narrow = inner as { @handle: (x: Integer) -> (result: Integer) }
        @go = |n: Integer| {
          result: Integer = narrow.handle(x: n)
          -> :result as Integer
        }
      }

      @test
        =
        i = Inner()
        w = Wrapper(i)
        :result = w.go(n: 5)
        -> :result as Integer
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 105 }, to: 'c' } },
    );
  });

  it('cast bypasses instantiation check — runs but would fail without cast', async () => {
    // A has @value, not @do. The cast says inner has @do.
    // Without the cast, B(a) would fail validation (missing @do).
    // With the cast, it compiles. At runtime @do is unhandled.
    const script = `
      A = <> {
        @value = -> result: 99 as Integer
      }

      B = <inner *> {
        cast = inner as { @do: (x: Integer) -> (result: Integer) }
        @action = |x: Integer| {
          result: Integer = cast.do(x: x)
          -> :result as Integer
        }
      }

      @test
        =
        a = A()
        b = B(a)
        :result = b.action(x: 1)
        -> :result as Integer
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', ex: { '@test': 'error' }, to: 'c' } },
    );
  });
});
