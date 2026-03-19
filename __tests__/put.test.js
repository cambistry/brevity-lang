import compile from '../index.js';
import { expectReply } from './helpers.js';

describe('actor put operator (<-)', () => {

  it('single positional put — actor receives via @ <-', async () => {
    const source = `
      Box
        =
        init(seed : Integer)
          $value : Integer = seed

        @ <- (n : Integer)
          $value = n

        @get
          =
          -> value: $value : Integer

        -> self
      end#Box

      @test
        =
        b = Box(0)
        b <- 42
        :value = b.get()
        -> :value : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { value: 'Integer' },
        re: { value: 42 },
        to: 'caller',
      },
    });
  });

  it('positional + named put', async () => {
    const source = `
      Store
        =
        init(seed : Integer)
          $p : Integer = seed
          $label : Text = ""

        @ <- (val : Integer, label: l : Text)
          $p = val
          $label = l

        @pos
          =
          -> value: $p : Integer

        @named
          =
          -> value: $label : Text

        -> self
      end#Store

      @test
        =
        s = Store(0)
        s <- 11, label: "eleven"
        :value = s.pos()
        -> :value : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { value: 'Integer' },
        re: { value: 11 },
        to: 'caller',
      },
    });
  });

  it('put without as clause — state persists via getter', async () => {
    const source = `
      Counter
        =
        init(seed : Integer)
          $count : Integer = seed

        @ <- (n : Integer)
          $count = n

        @get
          =
          -> count: $count : Integer

        -> self
      end#Counter

      @test
        =
        c = Counter(0)
        c <- 99
        :count = c.get()
        -> :count : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { count: 'Integer' },
        re: { count: 99 },
        to: 'caller',
      },
    });
  });

  it('scalar ref put backward compat — ref x <- 5', async () => {
    const source = `
      @test
        =
        ref x : Integer = 0
        x <- 5
        -> result: x : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 5 },
        to: 'caller',
      },
    });
  });

  // ── ref vs non-ref scoping ─────────────────────────────────────────────────

  it('ref actor — put from if block', async () => {
    const source = `
      Box
        =
        init(seed : Integer)
          $value : Integer = seed

        @ <- (n : Integer)
          $value = n

        @get
          =
          -> value: $value : Integer

        -> self
      end#Box

      @test
        =
        ref b = Box(0)
        if true
          b <- 77
        :value = b.get()
        -> :value : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { value: 'Integer' },
        re: { value: 77 },
        to: 'caller',
      },
    });
  });

  it('ref actor — put from lambda', async () => {
    const source = `
      Box
        =
        init(seed : Integer)
          $value : Integer = seed

        @ <- (n : Integer)
          $value = n

        @get
          =
          -> value: $value : Integer

        -> self
      end#Box

      @test
        =
        ref b = Box(0)
        fn = { b <- 55 }
        fn()
        :value = b.get()
        -> :value : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { value: 'Integer' },
        re: { value: 55 },
        to: 'caller',
      },
    });
  });

  it('non-ref actor — put from if block is compile error', () => {
    const source = `
      Box
        =
        init(seed : Integer)
          $value : Integer = seed

        @ <- (n : Integer)
          $value = n

        @get
          =
          -> value: $value : Integer

        -> self
      end#Box

      @test
        =
        b = Box(0)
        if true
          b <- 42
        :value = b.get()
        -> :value : Integer
    `;
    expect(() => compile(source)).toThrow(/only 'ref' variables support '<-'/);
  });

  it('non-ref actor — put from lambda is compile error', () => {
    const source = `
      Box
        =
        init(seed : Integer)
          $value : Integer = seed

        @ <- (n : Integer)
          $value = n

        @get
          =
          -> value: $value : Integer

        -> self
      end#Box

      @test
        =
        b = Box(0)
        fn = { b <- 55 }
        fn()
        :value = b.get()
        -> :value : Integer
    `;
    expect(() => compile(source)).toThrow(/only 'ref' variables support '<-'/);
  });

  it('non-ref scalar — put is compile error', () => {
    const source = `
      @test
        =
        x : Integer = 0
        x <- 5
        -> result: x : Integer
    `;
    expect(() => compile(source)).toThrow();
  });
});
