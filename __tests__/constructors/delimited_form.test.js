import { expectBehavior, compileSource } from '../helpers.js';

describe('constructor delimited form — compilation', () => {
  it('no-param constructor with braced body', () => {
    expect(() => compileSource(`
      Greeter = <> {
        @hello = -> greeting: "hi" as Text
      }
      @test
        =
        g = Greeter()
        :greeting = g.hello()
        -> :greeting as Text
    `)).not.toThrow();
  });

  it('constructor with params and braced body', () => {
    expect(() => compileSource(`
      Counter = <start Integer> {
        count *Integer = start
        @get = -> value: count as Integer
      }
      @test
        =
        c = Counter(0)
        :value = c.get()
        -> :value as Integer
    `)).not.toThrow();
  });

  it('constructor with multiple params', () => {
    expect(() => compileSource(`
      Pair = <a Integer, b Integer> {
        @sum = -> total: (a + b) as Integer
      }
      @test
        =
        p = Pair(3, 4)
        :total = p.sum()
        -> :total as Integer
    `)).not.toThrow();
  });
});

describe('constructor delimited form — runtime', () => {
  const script = `
    Greeter = <> {
      @hello = -> greeting: "hi" as Text
    }

    Counter = <start Integer> {
      count *Integer = start
      @get = -> value: count as Integer
    }

    Pair = <a Integer, b Integer> {
      @sum = -> total: (a + b) as Integer
    }

    @testGreeter
      =
      g = Greeter()
      :greeting = g.hello()
      -> :greeting as Text

    @testCounter
      =
      c = Counter(10)
      :value = c.get()
      -> :value as Integer

    @testPair
      =
      p = Pair(3, 4)
      :total = p.sum()
      -> :total as Integer
  `;

  it('no-param constructor works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testGreeter', from: 'c' } },
      { output: { id: '1', 'bv-a': { greeting: 'Text' }, re: { greeting: 'hi' }, to: 'c' } },
    );
  });

  it('constructor with param works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testCounter', from: 'c' } },
      { output: { id: '1', 'bv-a': { value: 'Integer' }, re: { value: 10 }, to: 'c' } },
    );
  });

  it('multiple params work', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testPair', from: 'c' } },
      { output: { id: '1', 'bv-a': { total: 'Integer' }, re: { total: 7 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Optional args — delimited constructor
// ═══════════════════════════════════════════════════════════════════════════════

describe('constructor delimited form — optional args — compilation', () => {
  it('positional default compiles', () => {
    expect(() => compileSource(`
      C = <a Integer, b Integer = 0> {
        @get = -> result: (a + b) as Integer
      }
      @test = { c = C(1); :result = c.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('inferred positional default compiles', () => {
    expect(() => compileSource(`
      C = <a Integer, b=0> {
        @get = -> result: (a + b) as Integer
      }
      @test = { c = C(1); :result = c.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('named default compiles', () => {
    expect(() => compileSource(`
      C = <a Integer, b: Integer = 5> {
        @get = -> result: (a + b) as Integer
      }
      @test = { c = C(1); :result = c.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('default feeds into ref state', () => {
    expect(() => compileSource(`
      C = <start Integer = 0> {
        count *Integer = start
        @get = -> value: count as Integer
      }
      @test = { c = C(); :value = c.get(); -> :value as Integer }
    `)).not.toThrow();
  });
});

describe('constructor delimited form — optional args — runtime', () => {
  const script = `
    Pair = <a Integer, b Integer = 0> {
      @sum = -> total: (a + b) as Integer
    }

    Defaults = <x=10, y=20> {
      @sum = -> total: (x + y) as Integer
    }

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

    @testDefaultsBoth
      =
      d = Defaults(1, 2)
      :total = d.sum()
      -> :total as Integer

    @testDefaultsNone
      =
      d = Defaults()
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
      { input: { id: '3', op: '@testDefaultsBoth', from: 'c' } },
      { output: { id: '3', 'bv-a': { total: 'Integer' }, re: { total: 3 }, to: 'c' } },
    );
  });

  it('all-default params — none provided', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@testDefaultsNone', from: 'c' } },
      { output: { id: '4', 'bv-a': { total: 'Integer' }, re: { total: 30 }, to: 'c' } },
    );
  });
});
