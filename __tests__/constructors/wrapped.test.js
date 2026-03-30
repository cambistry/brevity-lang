import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Wrapped child constructor — passing an actor as a constructor param
// ═══════════════════════════════════════════════════════════════════════════════

describe('wrapped child — compilation', () => {
  it('passing an actor to a constructor compiles', () => {
    expect(() => compileSource(`
      Inner = <> {
        @double = |n: Integer| -> result: (n * 2) as Integer
      }

      Wrapper = <inner> {
        @quadruple = |n: Integer| {
          result: Integer = inner.double(n: n)
          -> result: (result * 2) as Integer
        }
      }

      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('wrapper with multiple children compiles', () => {
    expect(() => compileSource(`
      Adder = <> {
        @add = |a: Integer, b: Integer| -> sum: (a + b) as Integer
      }

      Multiplier = <> {
        @mul = |a: Integer, b: Integer| -> product: (a * b) as Integer
      }

      Calculator = <adder, multiplier> {
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

// ═══════════════════════════════════════════════════════════════════════════════
// Wrapped child constructor — runtime delegation
// ═══════════════════════════════════════════════════════════════════════════════

describe('wrapped child — runtime', () => {
  it('wrapper delegates to child', async () => {
    const script = `
      Inner = <> {
        @double = |n: Integer| -> result: (n * 2) as Integer
      }

      Wrapper = <inner> {
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

  it('wrapper with state delegates and transforms', async () => {
    const script = `
      Doubler = <> {
        @double = |n: Integer| -> result: (n * 2) as Integer
      }

      Cached = <doubler> {
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

      Wrapper = <inner> {
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

      Wrapper = <inner> {
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
