import { runActor } from './helpers.js';

describe('ephemeral process instances', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @noArg
        =
        :greeting = Greeter().hello()
        -> :greeting : Text

      @methodArg
        =
        :result = MathActor().double(5 : Integer)
        -> :result : Integer

      @initArg
        =
        :value = Counter(42).get()
        -> :value : Integer

      @multiInit
        =
        :sum = Pair(3, 7).total()
        -> :sum : Integer

      @initAndMethod
        =
        :result = Accumulator(10).add(5 : Integer)
        -> :result : Integer

      Greeter
        =
        @hello
          =
          -> greeting: "hi" : Text
        -> self

      MathActor
        =
        @double
          =
          n : Integer
          =
          -> result: n * 2 : Integer
        -> self

      Counter
        =
        seed : Integer
        =
        ref value : Integer = seed

        @get
          =
          -> value: value : Integer

        -> self

      Pair
        =
        a : Integer
        b : Integer
        =

        @total
          =
          -> sum: a + b : Integer

        -> self

      Accumulator
        =
        start : Integer
        =
        ref value : Integer = start

        @add
          =
          n : Integer
          =
          -> result: value + n : Integer

        -> self
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'noArg', from: 'c' },
        { id: '2', op: 'methodArg', from: 'c' },
        { id: '3', op: 'initArg', from: 'c' },
        { id: '4', op: 'multiInit', from: 'c' },
        { id: '5', op: 'initAndMethod', from: 'c' },
      ],
    });
  });

  it('no-arg ephemeral — inline instantiate and call', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { greeting: 'Text' }, re: { greeting: 'hi' }, to: 'c' });
  });

  it('ephemeral with positional arg to method', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' });
  });

  it('ephemeral with constructor arg — read back via accessor', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { value: 'Integer' }, re: { value: 42 }, to: 'c' });
  });

  it('ephemeral with multiple constructor args', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { sum: 'Integer' }, re: { sum: 10 }, to: 'c' });
  });

  it('ephemeral with constructor arg and method arg', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' });
  });
});
