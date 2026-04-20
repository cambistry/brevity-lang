import { expectBehavior, compileSource } from '../helpers.js';

describe('constructor sugared form — compilation', () => {
  it('no-param sugared constructor', () => {
    expect(() => compileSource(`
      Greeter = <
        @hello = -> greeting: "hi"
      >
      @test
        =
        g = Greeter()
        :greeting Text = g.hello()
        -> :greeting
    `)).not.toThrow();
  });

  it('params inferred from leading bare declarations', () => {
    expect(() => compileSource(`
      Point = <
        x Integer
        y Integer
        @sum = -> total: (x + y)
      >
      @test
        =
        p = Point(3, 4)
        :total Integer = p.sum()
        -> :total
    `)).not.toThrow();
  });

  it('assignment ends param section', () => {
    expect(() => compileSource(`
      Counter = <
        start Integer
        count *Integer = start
        @get = -> value: count
      >
      @test
        =
        c = Counter(10)
        :value Integer = c.get()
        -> :value
    `)).not.toThrow();
  });
});

describe('constructor sugared form — runtime', () => {
  const script = `
    Greeter = <
      @hello = -> greeting: "hi"
    >

    Pair = <
      a Integer
      b Integer
      @sum = -> total: (a + b)
    >

    Counter = <
      start Integer
      count *Integer = start
      @get = -> value: count
    >

    @testGreeter
      =
      g = Greeter()
      :greeting Text = g.hello()
      -> :greeting

    @testPair
      =
      p = Pair(3, 4)
      :total Integer = p.sum()
      -> :total

    @testCounter
      =
      c = Counter(42)
      :value Integer = c.get()
      -> :value
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
        @sum = -> total: (a + b)
      >
      @test = { p = Pair(1); :total Integer = p.sum(); -> :total }
    `)).not.toThrow();
  });

  it('inferred default in sugared form compiles', () => {
    expect(() => compileSource(`
      C = <
        x=10
        @get = -> result: x
      >
      @test = { c = C(); :result Integer = c.get(); -> :result }
    `)).not.toThrow();
  });

  it('named shorthand literal default compiles', () => {
    expect(() => compileSource(`
      Tag = <
        :label "default"
        @get = -> result: label
      >
      @test = { t = Tag(); :result Text = t.get(); -> :result }
    `)).not.toThrow();
  });

  it('named := default compiles', () => {
    expect(() => compileSource(`
      Note = <
        :a = "unknown"
        @get = -> result: a
      >
      @test = { n = Note(); :result Text = n.get(); -> :result }
    `)).not.toThrow();
  });

  it('default feeds into ref state in sugared form', () => {
    expect(() => compileSource(`
      Counter = <
        start Integer = 0
        count *Integer = start
        @get = -> value: count
      >
      @test = { c = Counter(); :value Integer = c.get(); -> :value }
    `)).not.toThrow();
  });
});

describe('constructor sugared form — optional args — runtime', () => {
  const script = `
    Pair = <
      a Integer
      b Integer = 0
      @sum = -> total: (a + b)
    >

    AllDefaults = <
      x=10
      y=20
      @sum = -> total: (x + y)
    >

    @testPairBoth
      =
      p = Pair(3, 4)
      :total Integer = p.sum()
      -> :total

    @testPairDefault
      =
      p = Pair(3)
      :total Integer = p.sum()
      -> :total

    @testAllDefaultsBoth
      =
      d = AllDefaults(1, 2)
      :total Integer = d.sum()
      -> :total

    @testAllDefaultsNone
      =
      d = AllDefaults()
      :total Integer = d.sum()
      -> :total
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
