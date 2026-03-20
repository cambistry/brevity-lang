import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Top-level variable declaration and binding
// ═══════════════════════════════════════════════════════════════════════════════

describe('locals — declaration and binding', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- typed declaration with literal ---

      @typedInt
        =
        x : Integer = 42
        -> :x

      @typedText
        =
        msg : Text = "hello"
        -> :msg

      --- rebinding within same scope (JS only — Erlang SSA limitation) ---

      @rebind
        =
        x : Integer = 1
        x = 2
        x = 3
        -> :x

      --- expression binding ---

      @exprBind
        =
        a : Integer = 3
        b : Integer = 4
        c : Integer = a + b
        -> :c
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'typedInt', from: 'c' },
        { id: '2', op: 'typedText', from: 'c' },
        { id: '3', op: 'rebind', from: 'c' },
        { id: '4', op: 'exprBind', from: 'c' },
      ],
    });
  });

  it('typed integer declaration', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'c' });
  });

  it('typed text declaration', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { msg: 'Text' }, re: { msg: 'hello' }, to: 'c' });
  });

  it('rebinding within same scope', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { x: 'Integer' }, re: { x: 3 }, to: 'c' });
  });

  it('expression binding from other locals', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Read access from child scopes
// ═══════════════════════════════════════════════════════════════════════════════

describe('locals — child scope read access', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- lambda reads outer local ---

      @lambdaRead
        =
        x : Integer = 10
        fn = { x }
        result : Integer = fn()
        -> :result

      --- lambda reads outer and adds param ---

      @lambdaReadParam
        =
        base : Integer = 100
        fn = |n| base + n
        result : Integer = fn(5)
        -> :result

      --- if-branch reads outer local ---

      @ifRead
        =
        x : Integer = 42
        result : Integer = if true x : Integer else 0 as Integer
        -> :result

      --- nested lambda reads grandparent scope ---

      @nestedRead
        =
        x : Integer = 7
        outer = |a| {
          inner = { x + a }
          result : Integer = inner()
        }
        result : Integer = outer(3)
        -> :result
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'lambdaRead', from: 'c' },
        { id: '2', op: 'lambdaReadParam', from: 'c' },
        { id: '3', op: 'ifRead', from: 'c' },
        { id: '4', op: 'nestedRead', from: 'c' },
      ],
    });
  });

  it('lambda reads outer local', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' });
  });

  it('lambda reads outer local and adds param', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 105 }, to: 'c' });
  });

  it('if-branch reads outer local', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' });
  });

  it('nested lambda reads grandparent scope', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Header arg access
// ═══════════════════════════════════════════════════════════════════════════════

describe('locals — header arg access', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- direct return of header arg ---

      @echoNamed
        =
        :n : Integer
        =
        -> :n

      --- header arg used in expression ---

      @doubleArg
        =
        :n : Integer
        =
        result : Integer = n * 2
        -> :result

      --- header arg read from lambda ---

      @argInLambda
        =
        :base : Integer
        =
        fn = |x| base + x
        result : Integer = fn(10)
        -> :result

      --- multiple header args ---

      @multiArg
        =
        :a : Integer
        :b : Integer
        =
        -> sum: a + b as Integer

      --- header arg read from nested lambda ---

      @argNested
        =
        :seed : Integer
        =
        fn = {
          inner = |x| seed + x
          result : Integer = inner(1)
        }
        result : Integer = fn()
        -> :result
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ n: 42 }, 'echoNamed'], 'bv-a': [{ n: 'Integer' }], from: 'c' },
        { id: '2', op: [{ n: 7 }, 'doubleArg'], 'bv-a': [{ n: 'Integer' }], from: 'c' },
        { id: '3', op: [{ base: 100 }, 'argInLambda'], 'bv-a': [{ base: 'Integer' }], from: 'c' },
        { id: '4', op: [{ a: 3, b: 4 }, 'multiArg'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
        { id: '5', op: [{ seed: 50 }, 'argNested'], 'bv-a': [{ seed: 'Integer' }], from: 'c' },
      ],
    });
  });

  it('direct return of header arg', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { n: 'Integer' }, re: { n: 42 }, to: 'c' });
  });

  it('header arg used in expression', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 14 }, to: 'c' });
  });

  it('header arg read from lambda', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer' }, re: { result: 110 }, to: 'c' });
  });

  it('multiple header args in expression', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' });
  });

  it('header arg read from nested lambda', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { result: 'Integer' }, re: { result: 51 }, to: 'c' });
  });
});
