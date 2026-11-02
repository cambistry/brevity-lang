import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Higher-order function forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('higher-order functions', () => {
  const script = `
    --- helpers ---

    double
      =
      n Integer
      =
      ->(n * 2)

    triple
      =
      n Integer
      =
      ->(n * 3)

    constant
      =
      n Integer
      =
      fn = { n }
      return (fn as Function)

    --- public functions ---

    @literalPos
      =
      apply = (n, f) { r Integer = f(n) }
      result Integer = apply(5, (x Integer) ->  x * 2)
      return :result

    @literalNamed
      =
      compute = (n: Integer, transform:) { r Integer = transform(n) }
      result Integer = compute(n: 3, transform: (x Integer) ->  x + 7)
      return :result

    @fnRef
      =
      apply = (n, f) { r Integer = f(n) }
      result Integer = apply(5, &double)
      return :result

    @fnTypedLocal
      =
      fn Function = (x Integer) ->  x + 1
      r Integer = fn(9)
      return :r

    @fnVarRef
      =
      dbl = (x Integer) ->  x * 2
      apply = (n, f) { r Integer = f(n) }
      result Integer = apply(5, &dbl)
      return :result

    @forwardRef
      =
      apply = (n, f) { r Integer = f(n) }
      result Integer = apply(5, &triple)
      return :result

    @returnFn
      =
      getConst = constant(42)
      result Integer = getConst()
      return :result

    @returnFnLambda
      =
      factory = (n Integer) {
        inner = { n as Integer }
        inner as Function
      }
      getConst = factory(42)
      result Integer = getConst()
      return :result
  `;

  it('function literal as positional arg', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@literalPos', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('function literal as named arg', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@literalNamed', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('&function reference as arg', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@fnRef', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('Function-typed local variable', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@fnTypedLocal', from: 'c' } },
      { output: { id: '4', 'bv-a': { r: 'Integer' }, re: { r: 10 }, to: 'c' } },
    );
  });

  it('&fnVar passes a local function variable by reference', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@fnVarRef', from: 'c' } },
      { output: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('forward &function reference', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: '@forwardRef', from: 'c' } },
      { output: { id: '6', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' } },
    );
  });

  it('function returning a function (lineal)', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: '@returnFn', from: 'c' } },
      { output: { id: '7', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('lambda returning a function', async () => {
    await expectBehavior(script,
      { input: { id: '8', op: '@returnFnLambda', from: 'c' } },
      { output: { id: '8', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors — & enforcement
// ═══════════════════════════════════════════════════════════════════════════════

describe('higher-order functions — & enforcement', () => {
  it('bare function name in typed function slot throws', () => {
    expect(() => compileSource(`
      @go
        =
        apply = (n Integer, f (Integer) -> (Integer)) { r Integer = f(n) }
        double = (x Integer) ->  x * 2
        result Integer = apply(5, double)
        return :result
    `)).toThrow(/use &double/);
  });

  it('bare function name in Function-typed slot throws', () => {
    expect(() => compileSource(`
      transform
        =
        n Integer
        f Function
        =
        -> f(n) as Integer

      @go
        =
        double = (x Integer) ->  x * 2
        result Integer = transform(5, double)
        return :result
    `)).toThrow(/use &double/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// A call to a function value is one value, however the function got its name
// ═══════════════════════════════════════════════════════════════════════════════

describe('calling a function value', () => {
  const script = `
    top = (x Integer) -> x + 1

    calls *Integer = 0

    bump! = (x Integer) {
      calls <- calls + 1
      return x
    }

    @direct = {
      f = (x Integer) -> x + 1
      return r: f(1)
    }

    @asFunction = {
      f = (x Integer) -> x + 1
      g = f as Function
      return r: g(1)
    }

    @alias = {
      f = (x Integer) -> x + 1
      g = f
      return r: g(1)
    }

    @reference = {
      f = (x Integer) -> x + 1
      g = &f
      return r: g(1)
    }

    @typedLocal = {
      g Function = (x Integer) -> x + 1
      return r: g(1)
    }

    @fileFunction = {
      return r: top(1)
    }

    @fileFunctionAs = {
      g = top as Function
      return r: g(1)
    }

    @fileFunctionReference = {
      g = &top
      return r: g(1)
    }

    @param = {
      h = (k Function) { return r: k(1) }
      :r = h(&top)
      return :r
    }

    @blockBody = {
      f = (x Integer) { x + 1 }
      return r: f(1)
    }

    @blockBodyAs = {
      f = (x Integer) { x + 1 }
      g = f as Function
      return r: g(1)
    }

    @bindingBody = {
      f = (x Integer) { y = x + 1 }
      return r: f(1)
    }

    @noArgs = {
      f = { 7 }
      g = f as Function
      return r: g()
    }

    @captures = {
      n Integer = 5
      f = (x Integer) -> x + n
      return r: f(1)
    }

    @capturesAs = {
      n Integer = 5
      f = (x Integer) -> x + n
      g = f as Function
      return r: g(1)
    }

    @text = {
      f = (x Integer) -> "n"
      g = f as Function
      return r: g(1)
    }

    @positional = {
      f = (x Integer) -> x + 1
      g = f as Function
      return g(1)
    }

    @positionalAndNamed = {
      f = (x Integer) -> x + 1
      g = f as Function
      return g(1), r: g(2)
    }

    @twoNamed = {
      f = (x Integer) -> x + 1
      g = f as Function
      return a: g(1), b: g(2)
    }

    @tail = {
      f = (x Integer) -> x + 1
      g = f as Function
      g(1)
    }

    @nested = {
      f = (x Integer) -> x + 1
      g = f as Function
      return r: g(g(1))
    }

    @inList = {
      f = (x Integer) -> x + 1
      g = f as Function
      return r: [g(1), g(2)]
    }

    @inListDirect = {
      f = (x Integer) -> x + 1
      return r: [f(1), f(2)]
    }

    @interpolated = {
      f = (x Integer) -> x + 1
      g = f as Function
      return r: "v#{g(1)}"
    }

    @inArithmetic = {
      f = (x Integer) -> x + 1
      g = f as Function
      v Integer = g(1) + 10
      return r: v
    }

    @inCondition = {
      f = (x Integer) -> x + 1
      g = f as Function
      v Integer = if g(1) > 1 { 5 } else { 6 }
      return r: v
    }

    @oneCall! = {
      g = &bump!
      return r: g(1)
    }

    @calls = {
      return r: calls
    }

    @twoValues = {
      f = (x Integer) { return x, x }
      g = f as Function
      return r: g(1)
    }

    @namedValue = {
      f = (x Integer) { return v: x }
      g = f as Function
      return r: g(1)
    }
  `;

  it('called directly', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@direct', from: 'c' } },
      { output: { id: '1', re: { r: 2 }, to: 'c' } },
    );
  });

  it('through `as Function`', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@asFunction', from: 'c' } },
      { output: { id: '2', re: { r: 2 }, to: 'c' } },
    );
  });

  it('through another name', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@alias', from: 'c' } },
      { output: { id: '3', re: { r: 2 }, to: 'c' } },
    );
  });

  it('through a reference', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@reference', from: 'c' } },
      { output: { id: '4', re: { r: 2 }, to: 'c' } },
    );
  });

  it('held in a Function-typed local', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@typedLocal', from: 'c' } },
      { output: { id: '5', re: { r: 2 }, to: 'c' } },
    );
  });

  it("the file's function, called directly", async () => {
    await expectBehavior(script,
      { input: { id: '6', op: '@fileFunction', from: 'c' } },
      { output: { id: '6', re: { r: 2 }, to: 'c' } },
    );
  });

  it("the file's function, through `as Function`", async () => {
    await expectBehavior(script,
      { input: { id: '7', op: '@fileFunctionAs', from: 'c' } },
      { output: { id: '7', re: { r: 2 }, to: 'c' } },
    );
  });

  it("the file's function, through a reference", async () => {
    await expectBehavior(script,
      { input: { id: '8', op: '@fileFunctionReference', from: 'c' } },
      { output: { id: '8', re: { r: 2 }, to: 'c' } },
    );
  });

  it('passed as a param', async () => {
    await expectBehavior(script,
      { input: { id: '9', op: '@param', from: 'c' } },
      { output: { id: '9', re: { r: 2 }, to: 'c' } },
    );
  });

  it('with a block body', async () => {
    await expectBehavior(script,
      { input: { id: '10', op: '@blockBody', from: 'c' } },
      { output: { id: '10', re: { r: 2 }, to: 'c' } },
    );
  });

  it('with a block body, through `as Function`', async () => {
    await expectBehavior(script,
      { input: { id: '11', op: '@blockBodyAs', from: 'c' } },
      { output: { id: '11', re: { r: 2 }, to: 'c' } },
    );
  });

  it('with a body ending in a binding', async () => {
    await expectBehavior(script,
      { input: { id: '12', op: '@bindingBody', from: 'c' } },
      { output: { id: '12', re: { r: 2 }, to: 'c' } },
    );
  });

  it('with no args', async () => {
    await expectBehavior(script,
      { input: { id: '13', op: '@noArgs', from: 'c' } },
      { output: { id: '13', re: { r: 7 }, to: 'c' } },
    );
  });

  it('capturing a local', async () => {
    await expectBehavior(script,
      { input: { id: '14', op: '@captures', from: 'c' } },
      { output: { id: '14', re: { r: 6 }, to: 'c' } },
    );
  });

  it('capturing a local, through `as Function`', async () => {
    await expectBehavior(script,
      { input: { id: '15', op: '@capturesAs', from: 'c' } },
      { output: { id: '15', re: { r: 6 }, to: 'c' } },
    );
  });

  it('returning Text', async () => {
    await expectBehavior(script,
      { input: { id: '16', op: '@text', from: 'c' } },
      { output: { id: '16', re: { r: 'n' }, to: 'c' } },
    );
  });

  it('as a positional return', async () => {
    await expectBehavior(script,
      { input: { id: '17', op: '@positional', from: 'c' } },
      { output: { id: '17', re: [2], to: 'c' } },
    );
  });

  it('as positional and named returns together', async () => {
    await expectBehavior(script,
      { input: { id: '18', op: '@positionalAndNamed', from: 'c' } },
      { output: { id: '18', re: [2, { r: 3 }], to: 'c' } },
    );
  });

  it('as two named returns', async () => {
    await expectBehavior(script,
      { input: { id: '19', op: '@twoNamed', from: 'c' } },
      { output: { id: '19', re: { a: 2, b: 3 }, to: 'c' } },
    );
  });

  it('as the tail', async () => {
    await expectBehavior(script,
      { input: { id: '20', op: '@tail', from: 'c' } },
      { output: { id: '20', re: [2], to: 'c' } },
    );
  });

  it('as its own argument', async () => {
    await expectBehavior(script,
      { input: { id: '21', op: '@nested', from: 'c' } },
      { output: { id: '21', re: { r: 3 }, to: 'c' } },
    );
  });

  it('in a list', async () => {
    await expectBehavior(script,
      { input: { id: '22', op: '@inList', from: 'c' } },
      { output: { id: '22', re: { r: [2, 3] }, to: 'c' } },
    );
  });

  it('in a list, called directly', async () => {
    await expectBehavior(script,
      { input: { id: '23', op: '@inListDirect', from: 'c' } },
      { output: { id: '23', re: { r: [2, 3] }, to: 'c' } },
    );
  });

  it('in an interpolated string', async () => {
    await expectBehavior(script,
      { input: { id: '24', op: '@interpolated', from: 'c' } },
      { output: { id: '24', 'bv-a': { r: 'Text' }, re: { r: 'v2' }, to: 'c' } },
    );
  });

  it('in arithmetic', async () => {
    await expectBehavior(script,
      { input: { id: '25', op: '@inArithmetic', from: 'c' } },
      { output: { id: '25', 'bv-a': { r: 'Integer' }, re: { r: 12 }, to: 'c' } },
    );
  });

  it('in a condition', async () => {
    await expectBehavior(script,
      { input: { id: '26', op: '@inCondition', from: 'c' } },
      { output: { id: '26', 'bv-a': { r: 'Integer' }, re: { r: 5 }, to: 'c' } },
    );
  });

  it('runs once for a named return', async () => {
    await expectBehavior(script,
      { input: { id: '27', op: '@oneCall!', from: 'c' } },
      { output: { id: '27', re: { r: 1 }, to: 'c' } },
      { input: { id: '28', op: '@calls', from: 'c' } },
      { output: { id: '28', 'bv-a': { r: 'Integer' }, re: { r: 1 }, to: 'c' } },
    );
  });

  it('fails when the function returns two values', async () => {
    await expectBehavior(script,
      { input: { id: '29', op: '@twoValues', from: 'c' } },
      { output: { id: '29', ex: { '@twoValues': 'error' }, to: 'c' } },
    );
  });

  it('fails when the function returns only a name', async () => {
    await expectBehavior(script,
      { input: { id: '30', op: '@namedValue', from: 'c' } },
      { output: { id: '30', ex: { '@namedValue': 'error' }, to: 'c' } },
    );
  });
});
