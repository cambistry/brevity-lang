import compile from '../index.js';
import { runActor } from './helpers.js';

describe('set operator (<-)', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      Box
        =
        seed : Integer
        =
        ref value : Integer = seed

        set
          =
          n : Integer
          =
          value <- n .

        @get
          =
          -> value: value : Integer

        -> self
      end#Box

      Store
        =
        seed : Integer
        =
        ref p : Integer = seed
        ref label : Text = ""

        set
          =
          val : Integer
          label: l : Text
          =
          p <- val
          label <- l
          .

        @pos
          =
          -> value: p : Integer

        @named
          =
          -> value: label : Text

        -> self
      end#Store

      Counter
        =
        seed : Integer
        =
        ref count : Integer = seed

        set
          =
          n : Integer
          =
          count <- n .


        @get
          =
          -> count: count : Integer

        -> self
      end#Counter

      @singlePos
        =
        b = Box(0)
        b <- 42
        :value = b.get()
        -> :value : Integer

      @posNamed
        =
        s = Store(0)
        s <- 11, label: "eleven"
        :value = s.pos()
        -> :value : Integer

      @statePersists
        =
        c = Counter(0)
        c <- 99
        :count = c.get()
        -> :count : Integer

      @scalarRef
        =
        ref x : Integer = 0
        x <- 5
        -> result: x : Integer

      @refFromIf
        =
        ref b = Box(0)
        if true
          b <- 77
        :value = b.get()
        -> :value : Integer

      @refFromLambda
        =
        ref b = Box(0)
        fn = { b <- 55 }
        fn()
        :value = b.get()
        -> :value : Integer
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'singlePos', from: 'c' },
        { id: '2', op: 'posNamed', from: 'c' },
        { id: '3', op: 'statePersists', from: 'c' },
        { id: '4', op: 'scalarRef', from: 'c' },
        { id: '5', op: 'refFromIf', from: 'c' },
        { id: '6', op: 'refFromLambda', from: 'c' },
      ],
    });
  });

  it('single positional set — actor receives via set handler', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { value: 'Integer' }, re: { value: 42 }, to: 'c' });
  });

  it('positional + named set', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { value: 'Integer' }, re: { value: 11 }, to: 'c' });
  });

  it('set without as clause — state persists via getter', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { count: 'Integer' }, re: { count: 99 }, to: 'c' });
  });

  it('scalar ref set — ref x <- 5', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' });
  });

  it('ref actor — set from if block', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { value: 'Integer' }, re: { value: 77 }, to: 'c' });
  });

  it('ref actor — set from lambda', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { value: 'Integer' }, re: { value: 55 }, to: 'c' });
  });
});

describe('set operator — compile errors', () => {
  it('non-ref actor — set from if block is compile error', () => {
    expect(() => compile(`
      Box
        =
        seed : Integer
        =
        ref value : Integer = seed

        set
          =
          n : Integer
          =
          value <- n .


        @get
          =
          -> value: value : Integer

        -> self
      end#Box

      @test
        =
        b = Box(0)
        if true
          b <- 42
        :value = b.get()
        -> :value : Integer
    `)).toThrow(/only 'ref' variables support '<-'/);
  });

  it('non-ref actor — set from lambda is compile error', () => {
    expect(() => compile(`
      Box
        =
        seed : Integer
        =
        ref value : Integer = seed

        set
          =
          n : Integer
          =
          value <- n .


        @get
          =
          -> value: value : Integer

        -> self
      end#Box

      @test
        =
        b = Box(0)
        fn = { b <- 55 }
        fn()
        :value = b.get()
        -> :value : Integer
    `)).toThrow(/only 'ref' variables support '<-'/);
  });

  it('non-ref scalar — set is compile error', () => {
    expect(() => compile(`
      @test
        =
        x : Integer = 0
        x <- 5
        -> result: x : Integer
    `)).toThrow();
  });
});
