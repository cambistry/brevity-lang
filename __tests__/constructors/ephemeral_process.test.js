import { expectBehavior } from '../helpers.js';

describe('ephemeral process instances', () => {
  const script = `
    @noArg
      =
      :greeting = Greeter().hello()
      -> :greeting as Text

    @methodArg
      =
      :result = MathActor().double(5 as Integer)
      -> :result as Integer

    @initArg
      =
      :value = Counter(42).get()
      -> :value as Integer

    @multiInit
      =
      :sum = Pair(3, 7).total()
      -> :sum as Integer

    @initAndMethod
      =
      :result = Accumulator(10).add(5 as Integer)
      -> :result as Integer

    Greeter
      <>
      @hello
        =
        -> greeting: "hi" as Text
      .

    MathActor
      <>
      @double
        =
        n Integer
        =
        -> result: (n * 2) as Integer
      .

    Counter
      <
      seed Integer
      >>

      ref value Integer = seed

      @get
        =
        -> value: value as Integer

      .

    Pair
      <
      a Integer
      b Integer
      >>

      @total
        =
        -> sum: (a + b) as Integer

      .

    Accumulator
      <
      start Integer
      >>

      ref value Integer = start

      @add
        =
        n Integer
        =
        -> result: value + n as Integer

      .
  `;

  it('no-arg ephemeral — inline instantiate and call', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@noArg', from: 'c' } }, { output: { id: '1', 'bv-a': { greeting: 'Text' }, re: { greeting: 'hi' }, to: 'c' } });
  });

  it('ephemeral with positional arg to method', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@methodArg', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } });
  });

  it('ephemeral with constructor arg — read back via accessor', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@initArg', from: 'c' } }, { output: { id: '3', 'bv-a': { value: 'Integer' }, re: { value: 42 }, to: 'c' } });
  });

  it('ephemeral with multiple constructor args', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@multiInit', from: 'c' } }, { output: { id: '4', 'bv-a': { sum: 'Integer' }, re: { sum: 10 }, to: 'c' } });
  });

  it('ephemeral with constructor arg and method arg', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@initAndMethod', from: 'c' } }, { output: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' } });
  });
});
