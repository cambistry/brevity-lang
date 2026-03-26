import compile from '../../index.js';
import { expectReply } from '../helpers.js';

describe('constructor sugared form — compilation', () => {
  it('no-param sugared constructor', () => {
    expect(() => compile(`
      Greeter = <
        @hello = -> greeting: "hi" as Text
      >
      @test
        =
        ref g = Greeter()
        :greeting = g.hello()
        -> :greeting : Text
    `)).not.toThrow();
  });

  it('params inferred from leading bare declarations', () => {
    expect(() => compile(`
      Point = <
        x : Integer
        y : Integer
        @sum = -> total: (x + y) as Integer
      >
      @test
        =
        ref p = Point(3, 4)
        :total = p.sum()
        -> :total : Integer
    `)).not.toThrow();
  });

  it('assignment ends param section', () => {
    expect(() => compile(`
      Counter = <
        start : Integer
        ref count : Integer = start
        @get = -> value: count : Integer
      >
      @test
        =
        ref c = Counter(10)
        :value = c.get()
        -> :value : Integer
    `)).not.toThrow();
  });
});

describe('constructor sugared form — runtime', () => {
  it('no-param constructor works', async () => {
    await expectReply({
      script: `
        Greeter = <
          @hello = -> greeting: "hi" as Text
        >
        @test
          =
          ref g = Greeter()
          :greeting = g.hello()
          -> :greeting : Text
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { greeting: 'Text' }, re: { greeting: 'hi' }, to: 'c' },
    });
  });

  it('params from bare declarations work at runtime', async () => {
    await expectReply({
      script: `
        Pair = <
          a : Integer
          b : Integer
          @sum = -> total: (a + b) as Integer
        >
        @test
          =
          ref p = Pair(3, 4)
          :total = p.sum()
          -> :total : Integer
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { total: 'Integer' }, re: { total: 7 }, to: 'c' },
    });
  });

  it('param feeds into ref state', async () => {
    await expectReply({
      script: `
        Counter = <
          start : Integer
          ref count : Integer = start
          @get = -> value: count : Integer
        >
        @test
          =
          ref c = Counter(42)
          :value = c.get()
          -> :value : Integer
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { value: 'Integer' }, re: { value: 42 }, to: 'c' },
    });
  });
});
