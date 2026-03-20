import { runActor } from './helpers.js';

describe('trailing block', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- helpers ---

      double
        =
        n : Integer
        f : (Integer) -> (Integer)
        =
        -> f(n) : Integer

      test
        =
        x : Integer
        :label : Text
        c : (Integer) -> (Integer)
        =
        -> c(x) : Integer

      both
        =
        f : (Integer) -> (Integer)
        g : (Integer) -> (Integer)
        =
        -> f(g(1)) : Integer

      both2
        =
        f : (Integer) -> (Integer)
        g : (Integer) -> (Integer)
        =
        -> f(g(2)) : Integer

      --- public functions ---

      @singleBlock
        =
        result : Integer = double(5) |x : Integer| { x * 2 }
        -> :result

      @argsAndBlock
        =
        result : Integer = test(3, label: "hi") |n : Integer| { n + 1 }
        -> :result

      @inlineLocal
        =
        apply = |n : Integer, f : (Integer) -> (Integer)| { r : Integer = f(n) }
        result : Integer = apply(7) |x : Integer| { x * 3 }
        -> :result

      @twoInline
        =
        result : Integer = both() |x : Integer| { x + 1 } |x : Integer| { x * 10 }
        -> :result

      @twoMultiLine
        =
        result : Integer = both2()
          |x : Integer| { x + 5 }
          |x : Integer| { x * 3 }
        -> :result

      --- spacious trailing blocks ---

      @spaciousSingle
        =
        result : Integer = double(5)
          =
          x : Integer
          =
          -> x * 2 : Integer
        -> :result

      @spaciousArgs
        =
        result : Integer = test(3, label: "hi")
          =
          n : Integer
          =
          -> (n + 1) as Integer
        -> :result

      @spaciousTwo
        =
        result : Integer = both2()
          =
          x : Integer
          =
          -> x + 5 : Integer
          =
          x : Integer
          =
          -> x * 3 : Integer
        -> :result
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@singleBlock', from: 'c' },
        { id: '2', op: '@argsAndBlock', from: 'c' },
        { id: '3', op: '@inlineLocal', from: 'c' },
        { id: '4', op: '@twoInline', from: 'c' },
        { id: '5', op: '@twoMultiLine', from: 'c' },
        { id: '6', op: '@spaciousSingle', from: 'c' },
        { id: '7', op: '@spaciousArgs', from: 'c' },
        { id: '8', op: '@spaciousTwo', from: 'c' },
      ],
    });
  });

  it('single trailing block appended as positional function arg', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' });
  });

  it('regular args + named arg + trailing block', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 4 }, to: 'c' });
  });

  it('inline trailing block on a local function', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer' }, re: { result: 21 }, to: 'c' });
  });

  it('two trailing blocks appended in order', () => {
    // g(1) = 1*10 = 10, f(10) = 10+1 = 11
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'c' });
  });

  it('two trailing blocks on subsequent lines', () => {
    // g(2) = 2*3 = 6, f(6) = 6+5 = 11
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'c' });
  });

  // spacious trailing blocks
  it('spacious trailing block — single', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' });
  });

  it('spacious trailing block — with regular args', () => {
    expect(outputs[6]).toEqual({ id: '7', 'bv-a': { result: 'Integer' }, re: { result: 4 }, to: 'c' });
  });

  it('spacious trailing block — two blocks', () => {
    // g(2) = 2*3 = 6, f(6) = 6+5 = 11
    expect(outputs[7]).toEqual({ id: '8', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'c' });
  });
});
