import compile from '../index.js';
import { expectReply } from './helpers.js';

// ── 1. Function literal as positional arg ────────────────────────────────────

describe('higher-order functions — function literal as positional arg', () => {
  it('applies a function literal passed as positional arg', async () => {
    const source = `
      @go
        =
        apply = |n, f| { r : Integer = f(n) }
        result : Integer = apply(5, |x : Integer| x * 2)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'caller',
      },
    });
  });
});

// ── 2. Function literal as named arg ─────────────────────────────────────────

describe('higher-order functions — function literal as named arg', () => {
  it('applies a function literal passed as named arg', async () => {
    const source = `
      @go
        =
        compute = |:n : Integer, :transform| { r : Integer = transform(n) }
        result : Integer = compute(n: 3, transform: |x : Integer| x + 7)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'caller',
      },
    });
  });
});

// ── 3. Function reference &name ──────────────────────────────────────────────

describe('higher-order functions — function reference &name', () => {
  it('passes &function as an arg', async () => {
    const source = `
      double
        =
        n : Integer
        =
        ->(n * 2 : Integer)

      @go
        =
        apply = |n, f| { r : Integer = f(n) }
        result : Integer = apply(5, &double)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'caller',
      },
    });
  });
});

// ── 4. Function-typed local variable ─────────────────────────────────────────

describe('higher-order functions — Function-typed local variable', () => {
  it('assigns a function literal to a Function-typed local and calls it', async () => {
    const source = `
      @go
        =
        fn : Function = |x : Integer| x + 1
        r : Integer = fn(9)
        -> :r
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { r: 'Integer' }, re: { r: 10 }, to: 'caller',
      },
    });
  });
});

// ── 5. Function variable passed by reference with & ──────────────────────────

describe('higher-order functions — &fnVar passes a local function variable by reference', () => {
  it('passes a local function variable by reference using &', async () => {
    const source = `
      @go
        =
        double = |x : Integer| x * 2
        apply = |n, f| { r : Integer = f(n) }
        result : Integer = apply(5, &double)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'caller',
      },
    });
  });
});

// ── 6. Forward function reference ────────────────────────────────────────────

describe('higher-order functions — forward function reference', () => {
  it('&function works when function is defined after the referencing handler', async () => {
    const source = `
      @go
        =
        apply = |n, f| { r : Integer = f(n) }
        result : Integer = apply(5, &triple)
        -> :result

      triple
        =
        n : Integer
        =
        ->(n * 3 : Integer)
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'caller',
      },
    });
  });
});

// ── compile errors — & enforcement ──────────────────────────────────────────

describe('higher-order functions — & enforcement', () => {
  it('bare function name in typed function slot of local function throws', () => {
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

// ── 7. Function returning a function ─────────────────────────────────────────

describe('higher-order functions — function returning a function', () => {
  it('function body returns a function literal via ImplicitReturn', async () => {
    const source = `
      constant
        =
        n : Integer
        =
        fn = { n } : Integer
        ->(fn : Function)

      @go
        =
        getConst = constant(42)
        result : Integer = getConst()
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'caller',
      },
    });
  });

  it('lambda body creates and returns a function literal', async () => {
    const source = `
      @go
        =
        factory = |n : Integer| {
          inner = { n } : Integer
          inner
        } : Function
        getConst = factory(42)
        result : Integer = getConst()
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'caller',
      },
    });
  });
});
