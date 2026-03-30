import { expectBehavior, compileSource } from '../helpers.js';

describe('constructor sugared form — compilation', () => {
  it('no-param sugared constructor', () => {
    expect(() => compileSource(`
      Greeter = <
        @hello = -> greeting: "hi" as Text
      >
      @test
        =
        g = Greeter()
        :greeting = g.hello()
        -> :greeting as Text
    `)).not.toThrow();
  });

  it('params inferred from leading bare declarations', () => {
    expect(() => compileSource(`
      Point = <
        x Integer
        y Integer
        @sum = -> total: (x + y) as Integer
      >
      @test
        =
        p = Point(3, 4)
        :total = p.sum()
        -> :total as Integer
    `)).not.toThrow();
  });

  it('assignment ends param section', () => {
    expect(() => compileSource(`
      Counter = <
        start Integer
        ref count Integer = start
        @get = -> value: count as Integer
      >
      @test
        =
        c = Counter(10)
        :value = c.get()
        -> :value as Integer
    `)).not.toThrow();
  });
});

describe('constructor sugared form — runtime', () => {
  it('no-param constructor works', async () => {
    await expectBehavior({
      script: `
        Greeter = <
          @hello = -> greeting: "hi" as Text
        >
        @test
          =
          g = Greeter()
          :greeting = g.hello()
          -> :greeting as Text
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { greeting: 'Text' }, re: { greeting: 'hi' }, to: 'c' },
    });
  });

  it('params from bare declarations work at runtime', async () => {
    await expectBehavior({
      script: `
        Pair = <
          a Integer
          b Integer
          @sum = -> total: (a + b) as Integer
        >
        @test
          =
          p = Pair(3, 4)
          :total = p.sum()
          -> :total as Integer
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { total: 'Integer' }, re: { total: 7 }, to: 'c' },
    });
  });

  it('param feeds into ref state', async () => {
    await expectBehavior({
      script: `
        Counter = <
          start Integer
          ref count Integer = start
          @get = -> value: count as Integer
        >
        @test
          =
          c = Counter(42)
          :value = c.get()
          -> :value as Integer
      `,
      receive: { id: '1', op: '@test', from: 'c' },
      reply: { id: '1', 'bv-a': { value: 'Integer' }, re: { value: 42 }, to: 'c' },
    });
  });
});
