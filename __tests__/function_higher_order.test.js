import compile from '../index.js';
import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Higher-order function forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('higher-order functions', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- helpers ---

      double
        =
        n : Integer
        =
        ->(n * 2 : Integer)

      triple
        =
        n : Integer
        =
        ->(n * 3 : Integer)

      constant
        =
        n : Integer
        =
        fn = { n } : Integer
        ->(fn : Function)

      --- public functions ---

      @literalPos
        =
        apply = |n, f| { r : Integer = f(n) }
        result : Integer = apply(5, |x : Integer| x * 2)
        -> :result

      @literalNamed
        =
        compute = |:n : Integer, :transform| { r : Integer = transform(n) }
        result : Integer = compute(n: 3, transform: |x : Integer| x + 7)
        -> :result

      @fnRef
        =
        apply = |n, f| { r : Integer = f(n) }
        result : Integer = apply(5, &double)
        -> :result

      @fnTypedLocal
        =
        fn : Function = |x : Integer| x + 1
        r : Integer = fn(9)
        -> :r

      @fnVarRef
        =
        dbl = |x : Integer| x * 2
        apply = |n, f| { r : Integer = f(n) }
        result : Integer = apply(5, &dbl)
        -> :result

      @forwardRef
        =
        apply = |n, f| { r : Integer = f(n) }
        result : Integer = apply(5, &triple)
        -> :result

      @returnFn
        =
        getConst = constant(42)
        result : Integer = getConst()
        -> :result

      @returnFnLambda
        =
        factory = |n : Integer| {
          inner = { n } : Integer
          inner
        } : Function
        getConst = factory(42)
        result : Integer = getConst()
        -> :result
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'literalPos', from: 'c' },
        { id: '2', op: 'literalNamed', from: 'c' },
        { id: '3', op: 'fnRef', from: 'c' },
        { id: '4', op: 'fnTypedLocal', from: 'c' },
        { id: '5', op: 'fnVarRef', from: 'c' },
        { id: '6', op: 'forwardRef', from: 'c' },
        { id: '7', op: 'returnFn', from: 'c' },
        { id: '8', op: 'returnFnLambda', from: 'c' },
      ],
    });
  });

  it('function literal as positional arg', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' });
  });

  it('function literal as named arg', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' });
  });

  it('&function reference as arg', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' });
  });

  it('Function-typed local variable', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { r: 'Integer' }, re: { r: 10 }, to: 'c' });
  });

  it('&fnVar passes a local function variable by reference', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' });
  });

  it('forward &function reference', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' });
  });

  it('function returning a function (spacious)', () => {
    expect(outputs[6]).toEqual({ id: '7', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' });
  });

  it('lambda returning a function', () => {
    expect(outputs[7]).toEqual({ id: '8', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors — & enforcement
// ═══════════════════════════════════════════════════════════════════════════════

describe('higher-order functions — & enforcement', () => {
  it('bare function name in typed function slot throws', () => {
    expect(() => compile(`
      @go
        =
        apply = |n : Integer, f : (Integer) -> (Integer)| { r : Integer = f(n) }
        double = |x : Integer| x * 2
        result : Integer = apply(5, double)
        -> :result
    `)).toThrow(/use &double/);
  });

  it('bare function name in Function-typed slot throws', () => {
    expect(() => compile(`
      transform
        =
        n : Integer
        f : Function
        =
        -> f(n) : Integer

      @go
        =
        double = |x : Integer| x * 2
        result : Integer = transform(5, double)
        -> :result
    `)).toThrow(/use &double/);
  });
});
