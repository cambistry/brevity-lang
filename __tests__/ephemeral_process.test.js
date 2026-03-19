import { expectReply } from './helpers.js';

describe('ephemeral process instances', () => {

  // ── basic inline call ───────────────────────────────────────────────────────

  it('no-arg ephemeral — inline instantiate and call', async () => {
    await expectReply({
      source: `
        @test
          =
          :greeting = Greeter().hello()
          -> :greeting : Text

        Greeter
          =
          @hello
            =
            -> greeting: "hi" : Text
          -> self
      `,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { greeting: 'Text' },
        re: { greeting: 'hi' },
        to: 'caller',
      },
    });
  });

  it('ephemeral with positional arg to method', async () => {
    await expectReply({
      source: `
        @test
          =
          :result = Math().double(5 : Integer)
          -> :result : Integer

        Math
          =
          @double
            =
            n : Integer
            =
            -> result: n * 2 : Integer
          -> self
      `,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 10 },
        to: 'caller',
      },
    });
  });

  // ── init with args ──────────────────────────────────────────────────────────

  it('ephemeral with single init arg — read back via accessor', async () => {
    await expectReply({
      source: `
        @test
          =
          :value = Counter(42).get()
          -> :value : Integer

        Counter
          =
          init(seed : Integer)
            $value : Integer = seed

          @get
            =
            -> value: $value : Integer

          -> self
      `,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { value: 'Integer' },
        re: { value: 42 },
        to: 'caller',
      },
    });
  });

  it('ephemeral with multiple init args', async () => {
    await expectReply({
      source: `
        @test
          =
          :sum = Pair(3, 7).total()
          -> :sum : Integer

        Pair
          =
          init(a : Integer, b : Integer)
            $x : Integer = a
            $y : Integer = b

          @total
            =
            -> sum: $x + $y : Integer

          -> self
      `,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { sum: 'Integer' },
        re: { sum: 10 },
        to: 'caller',
      },
    });
  });

  // ── init + method with args ─────────────────────────────────────────────────

  it('ephemeral with init arg and method arg', async () => {
    await expectReply({
      source: `
        @test
          =
          :result = Accumulator(10).add(5 : Integer)
          -> :result : Integer

        Accumulator
          =
          init(start : Integer)
            $value : Integer = start

          @add
            =
            n : Integer
            =
            -> result: $value + n : Integer

          -> self
      `,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 15 },
        to: 'caller',
      },
    });
  });
});
