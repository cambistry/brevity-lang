import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Private function (lambda) param forms
//
// All param forms available in dense |...| lambdas:
// positional (typed/untyped), named sigil (typed/untyped),
// key-mapped (typed/untyped), mixed, and no-param.
// ═══════════════════════════════════════════════════════════════════════════════

describe('function params — all forms', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- named via sigil ---

      @namedSigil
        =
        fn = |:name| { name }
        result : Integer = fn(name: 42)
        -> :result

      @namedTyped
        =
        fn = |:n : Integer| { n * 2 }
        result : Integer = fn(n: 5)
        -> :result

      --- key-mapped ---

      @keyMapped
        =
        fn = |label: x| { x + 1 }
        result : Integer = fn(label: 9)
        -> :result

      @keyMappedTwo
        =
        fn = |first: a, last: b| { a + b }
        result : Integer = fn(first: 3, last: 4)
        -> :result

      @keyMappedTyped
        =
        fn = |label: x : Integer| { x + 1 }
        result : Integer = fn(label: 9)
        -> :result

      --- mixed positional + named ---

      @mixedPosNamed
        =
        fn = |a, :b| { a + b }
        result : Integer = fn(3, b: 4)
        -> :result

      @twoNamed
        =
        fn = |:a, :b| { a + b }
        result : Integer = fn(a: 10, b: 20)
        -> :result

      --- positional ---

      @twoPosUntyped
        =
        fn = |a, b| { a + b }
        result : Integer = fn(3, 4)
        -> :result

      @twoPosTyped
        =
        fn = |a : Integer, b : Integer| { a + b }
        result : Integer = fn(3, 4)
        -> :result

      --- no params ---

      @noParam
        =
        fn = { 42 }
        result : Integer = fn()
        -> :result
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@namedSigil', from: 'c' },
        { id: '2', op: '@namedTyped', from: 'c' },
        { id: '3', op: '@keyMapped', from: 'c' },
        { id: '4', op: '@keyMappedTwo', from: 'c' },
        { id: '5', op: '@keyMappedTyped', from: 'c' },
        { id: '6', op: '@mixedPosNamed', from: 'c' },
        { id: '7', op: '@twoNamed', from: 'c' },
        { id: '8', op: '@twoPosUntyped', from: 'c' },
        { id: '9', op: '@twoPosTyped', from: 'c' },
        { id: '10', op: '@noParam', from: 'c' },
      ],
    });
  });

  // named via sigil
  it('|:name| binds named field', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' });
  });

  it('|:n : Integer| typed sigil', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' });
  });

  // key-mapped
  it('|label: x| binds key to local name', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' });
  });

  it('|first: a, last: b| two key-mapped params', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' });
  });

  it('|label: x : Integer| key-mapped with type', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' });
  });

  // mixed positional + named
  it('|a, :b| positional + named', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' });
  });

  it('|:a, :b| two named-only params', () => {
    expect(outputs[6]).toEqual({ id: '7', 'bv-a': { result: 'Integer' }, re: { result: 30 }, to: 'c' });
  });

  // positional
  it('|a, b| untyped positional', () => {
    expect(outputs[7]).toEqual({ id: '8', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' });
  });

  it('|a : Integer, b : Integer| typed positional', () => {
    expect(outputs[8]).toEqual({ id: '9', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' });
  });

  // no params
  it('no params — bare braces { 42 }', () => {
    expect(outputs[9]).toEqual({ id: '10', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' });
  });
});
