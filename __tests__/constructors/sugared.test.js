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
        count *Integer = start
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
  const script = `
    Greeter = <
      @hello = -> greeting: "hi" as Text
    >

    Pair = <
      a Integer
      b Integer
      @sum = -> total: (a + b) as Integer
    >

    Counter = <
      start Integer
      count *Integer = start
      @get = -> value: count as Integer
    >

    @testGreeter
      =
      g = Greeter()
      :greeting = g.hello()
      -> :greeting as Text

    @testPair
      =
      p = Pair(3, 4)
      :total = p.sum()
      -> :total as Integer

    @testCounter
      =
      c = Counter(42)
      :value = c.get()
      -> :value as Integer
  `;

  it('no-param constructor works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testGreeter', from: 'c' } },
      { output: { id: '1', 'bv-a': { greeting: 'Text' }, re: { greeting: 'hi' }, to: 'c' } },
    );
  });

  it('params from bare declarations work at runtime', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testPair', from: 'c' } },
      { output: { id: '1', 'bv-a': { total: 'Integer' }, re: { total: 7 }, to: 'c' } },
    );
  });

  it('param feeds into ref state', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testCounter', from: 'c' } },
      { output: { id: '1', 'bv-a': { value: 'Integer' }, re: { value: 42 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Optional args — sugared constructor
// ═══════════════════════════════════════════════════════════════════════════════

describe('constructor sugared form — optional args — compilation', () => {
  it('positional default in sugared form compiles', () => {
    expect(() => compileSource(`
      Pair = <
        a Integer
        b Integer = 0
        @sum = -> total: (a + b) as Integer
      >
      @test = { p = Pair(1); :total = p.sum(); -> :total as Integer }
    `)).not.toThrow();
  });

  it('inferred default in sugared form compiles', () => {
    expect(() => compileSource(`
      C = <
        x=10
        @get = -> result: x as Integer
      >
      @test = { c = C(); :result = c.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('named shorthand literal default compiles', () => {
    expect(() => compileSource(`
      Tag = <
        label: "default"
        @get = -> result: label as Text
      >
      @test = { t = Tag(); :result = t.get(); -> :result as Text }
    `)).not.toThrow();
  });

  it('named := default compiles', () => {
    expect(() => compileSource(`
      Note = <
        a: = "unknown"
        @get = -> result: a as Text
      >
      @test = { n = Note(); :result = n.get(); -> :result as Text }
    `)).not.toThrow();
  });

  it('default feeds into ref state in sugared form', () => {
    expect(() => compileSource(`
      Counter = <
        start Integer = 0
        count *Integer = start
        @get = -> value: count as Integer
      >
      @test = { c = Counter(); :value = c.get(); -> :value as Integer }
    `)).not.toThrow();
  });
});

describe('constructor sugared form — optional args — runtime', () => {
  const script = `
    Pair = <
      a Integer
      b Integer = 0
      @sum = -> total: (a + b) as Integer
    >

    AllDefaults = <
      x=10
      y=20
      @sum = -> total: (x + y) as Integer
    >

    @testPairBoth
      =
      p = Pair(3, 4)
      :total = p.sum()
      -> :total as Integer

    @testPairDefault
      =
      p = Pair(3)
      :total = p.sum()
      -> :total as Integer

    @testAllDefaultsBoth
      =
      d = AllDefaults(1, 2)
      :total = d.sum()
      -> :total as Integer

    @testAllDefaultsNone
      =
      d = AllDefaults()
      :total = d.sum()
      -> :total as Integer
  `;

  it('both args provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testPairBoth', from: 'c' } },
      { output: { id: '1', 'bv-a': { total: 'Integer' }, re: { total: 7 }, to: 'c' } },
    );
  });

  it('optional omitted — default fills in', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testPairDefault', from: 'c' } },
      { output: { id: '2', 'bv-a': { total: 'Integer' }, re: { total: 3 }, to: 'c' } },
    );
  });

  it('all-default params — both provided', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@testAllDefaultsBoth', from: 'c' } },
      { output: { id: '3', 'bv-a': { total: 'Integer' }, re: { total: 3 }, to: 'c' } },
    );
  });

  it('all-default params — none provided', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@testAllDefaultsNone', from: 'c' } },
      { output: { id: '4', 'bv-a': { total: 'Integer' }, re: { total: 30 }, to: 'c' } },
    );
  });
});
