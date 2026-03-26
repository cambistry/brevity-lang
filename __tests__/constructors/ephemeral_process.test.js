import { expectReply } from '../helpers.js';

describe('ephemeral process instances', () => {
  const script = `
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
      <>
      =
      @hello
        =
        -> greeting: "hi" as Text
      .

    MathActor
      <>
      =
      @double
        =
        n : Integer
        =
        -> result: (n * 2) as Integer
      .

    Counter
      <
      seed : Integer
      >
      =
      ref value : Integer = seed

      @get
        =
        -> value: value : Integer

      .

    Pair
      <
      a : Integer
      b : Integer
      >
      =

      @total
        =
        -> sum: (a + b) as Integer

      .

    Accumulator
      <
      start : Integer
      >
      =
      ref value : Integer = start

      @add
        =
        n : Integer
        =
        -> result: value + n : Integer

      .
  `;

  it('no-arg ephemeral — inline instantiate and call', async () => {
    await expectReply({ script, receive: { id: '1', op: '@noArg', from: 'c' }, reply: { id: '1', 'bv-a': { greeting: 'Text' }, re: { greeting: 'hi' }, to: 'c' } });
  });

  it('ephemeral with positional arg to method', async () => {
    await expectReply({ script, receive: { id: '2', op: '@methodArg', from: 'c' }, reply: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } });
  });

  it('ephemeral with constructor arg — read back via accessor', async () => {
    await expectReply({ script, receive: { id: '3', op: '@initArg', from: 'c' }, reply: { id: '3', 'bv-a': { value: 'Integer' }, re: { value: 42 }, to: 'c' } });
  });

  it('ephemeral with multiple constructor args', async () => {
    await expectReply({ script, receive: { id: '4', op: '@multiInit', from: 'c' }, reply: { id: '4', 'bv-a': { sum: 'Integer' }, re: { sum: 10 }, to: 'c' } });
  });

  it('ephemeral with constructor arg and method arg', async () => {
    await expectReply({ script, receive: { id: '5', op: '@initAndMethod', from: 'c' }, reply: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' } });
  });
});
