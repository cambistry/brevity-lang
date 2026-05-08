import { expectBehavior } from '../helpers.js';

describe('ephemeral process instances', () => {
  const script = `
    @noArg
      =
      :greeting Text = Greeter().hello()
      -> :greeting

    @methodArg
      =
      :result Integer = MathActor().double(5)
      -> :result

    @initArg
      =
      :value Integer = Counter(42).get()
      -> :value

    @multiInit
      =
      :sum Integer = Pair(3, 7).total()
      -> :sum

    @initAndMethod
      =
      :result Integer = Accumulator(10).add(5)
      -> :result

    Greeter =
      *
      =
      @hello
        =
        -> greeting: "hi" as Text
      .

    MathActor =
      *
      =
      @double
        =
        n Integer
        =
        -> result: (n * 2) as Integer
      .

    Counter =
      *(
      seed Integer
      )
      =
      value *Integer = seed

      @get
        =
        -> value: value as Integer

      .

    Pair =
      *(
      a Integer
      b Integer
      )
      =
      @total
        =
        -> sum: (a + b) as Integer

      .

    Accumulator =
      *(
      start Integer
      )
      =
      value *Integer = start

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

// ═══════════════════════════════════════════════════════════════════════════════
// Ephemeral with optional constructor args
// ═══════════════════════════════════════════════════════════════════════════════

describe('ephemeral process — optional constructor args', () => {
  const script = `
    @withArg
      =
      :value Integer = Counter(42).get()
      -> :value

    @withDefault
      =
      :value Integer = Counter().get()
      -> :value

    @partialArgs
      =
      :sum Integer = Pair(3).total()
      -> :sum

    Counter =
      *(seed Integer = 0)
      =
      value *Integer = seed

      @get
        =
        -> value: value as Integer

      .

    Pair =
      *(
      a Integer
      b Integer = 10
      )
      =
      @total
        =
        -> sum: (a + b) as Integer

      .
  `;

  it('ephemeral with provided constructor arg', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@withArg', from: 'c' } }, { output: { id: '1', 'bv-a': { value: 'Integer' }, re: { value: 42 }, to: 'c' } });
  });

  it('ephemeral with default constructor arg', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@withDefault', from: 'c' } }, { output: { id: '2', 'bv-a': { value: 'Integer' }, re: { value: 0 }, to: 'c' } });
  });

  it('ephemeral with partial args — default fills in', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@partialArgs', from: 'c' } }, { output: { id: '3', 'bv-a': { sum: 'Integer' }, re: { sum: 13 }, to: 'c' } });
  });
});
