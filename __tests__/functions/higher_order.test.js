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
      ->(fn as Function)

    --- public functions ---

    @literalPos
      =
      apply = (n, f) { r Integer = f(n) }
      result Integer = apply(5, (x Integer) ->  x * 2)
      -> :result

    @literalNamed
      =
      compute = (:n Integer, :transform) { r Integer = transform(n) }
      result Integer = compute(n: 3, transform: (x Integer) ->  x + 7)
      -> :result

    @fnRef
      =
      apply = (n, f) { r Integer = f(n) }
      result Integer = apply(5, &double)
      -> :result

    @fnTypedLocal
      =
      fn Function = (x Integer) ->  x + 1
      r Integer = fn(9)
      -> :r

    @fnVarRef
      =
      dbl = (x Integer) ->  x * 2
      apply = (n, f) { r Integer = f(n) }
      result Integer = apply(5, &dbl)
      -> :result

    @forwardRef
      =
      apply = (n, f) { r Integer = f(n) }
      result Integer = apply(5, &triple)
      -> :result

    @returnFn
      =
      getConst = constant(42)
      result Integer = getConst()
      -> :result

    @returnFnLambda
      =
      factory = (n Integer) {
        inner = { n as Integer }
        inner as Function
      }
      getConst = factory(42)
      result Integer = getConst()
      -> :result
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
        -> :result
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
        -> :result
    `)).toThrow(/use &double/);
  });
});
