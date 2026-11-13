import { extract } from '../../index.js';
import { expectBehavior, compileSource } from '../helpers.js';

describe('constructor delimited form — compilation', () => {
  it('no-param constructor with braced body', () => {
    expect(() => compileSource(`
      Greeter = * {
        @hello = -> greeting: "hi"
      }
      @test
        =
        g = Greeter()
        :greeting Text = g.hello()
        return :greeting
    `)).not.toThrow();
  });

  it('constructor with params and braced body', () => {
    expect(() => compileSource(`
      Counter = (start Integer) *{
        count *Integer = start
        @get = -> value: count
      }
      @test
        =
        c = Counter(0)
        :value Integer = c.get()
        return :value
    `)).not.toThrow();
  });

  it('constructor with multiple params', () => {
    expect(() => compileSource(`
      Pair = (a Integer, b Integer) *{
        @sum = -> total: (a + b)
      }
      @test
        =
        p = Pair(3, 4)
        :total Integer = p.sum()
        return :total
    `)).not.toThrow();
  });
});

describe('constructor delimited form — runtime', () => {
  const script = `
    Greeter = * {
      @hello = -> greeting: "hi"
    }

    Counter = (start Integer) *{
      count *Integer = start
      @get = -> value: count
    }

    Pair = (a Integer, b Integer) *{
      @sum = -> total: (a + b)
    }

    @testGreeter
      =
      g = Greeter()
      :greeting Text = g.hello()
      return :greeting

    @testCounter
      =
      c = Counter(10)
      :value Integer = c.get()
      return :value

    @testPair
      =
      p = Pair(3, 4)
      :total Integer = p.sum()
      return :total
  `;

  it('no-param constructor works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testGreeter', from: 'c' } },
      { output: { id: '1', 'ty': { greeting: 'Text' }, re: { greeting: 'hi' }, to: 'c' } },
    );
  });

  it('constructor with param works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testCounter', from: 'c' } },
      { output: { id: '1', 'ty': { value: 'Integer' }, re: { value: 10 }, to: 'c' } },
    );
  });

  it('multiple params work', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testPair', from: 'c' } },
      { output: { id: '1', 'ty': { total: 'Integer' }, re: { total: 7 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Optional args — delimited constructor
// ═══════════════════════════════════════════════════════════════════════════════

describe('constructor delimited form — optional args — compilation', () => {
  it('positional default compiles', () => {
    expect(() => compileSource(`
      C = (a Integer, b Integer = 0) *{
        @get = -> result: (a + b)
      }
      @test = { c = C(1); :result Integer = c.get(); return :result }
    `)).not.toThrow();
  });

  it('inferred positional default compiles', () => {
    expect(() => compileSource(`
      C = (a Integer, b=0) *{
        @get = -> result: (a + b)
      }
      @test = { c = C(1); :result Integer = c.get(); return :result }
    `)).not.toThrow();
  });

  it('named default compiles', () => {
    expect(() => compileSource(`
      C = (a Integer, b: Integer = 5) *{
        @get = -> result: (a + b)
      }
      @test = { c = C(1); :result Integer = c.get(); return :result }
    `)).not.toThrow();
  });

  it('default feeds into ref state', () => {
    expect(() => compileSource(`
      C = (start Integer = 0) *{
        count *Integer = start
        @get = -> value: count
      }
      @test = { c = C(); :value Integer = c.get(); return :value }
    `)).not.toThrow();
  });
});

describe('constructor delimited form — optional args — runtime', () => {
  const script = `
    Pair = (a Integer, b Integer = 0) *{
      @sum = -> total: (a + b)
    }

    Defaults = (x=10, y=20) *{
      @sum = -> total: (x + y)
    }

    Below = (a Integer, b Integer = -2) *{
      @sum = -> total: (a + b)
    }

    Offset = (a Integer, b: Integer = -1) *{
      @sum = -> total: (a + b)
    }

    @testBelowDefault
      =
      p = Below(3)
      :total Integer = p.sum()
      return :total

    @testOffsetDefault
      =
      p = Offset(3)
      :total Integer = p.sum()
      return :total

    @testOffsetGiven
      =
      p = Offset(3, b: 0 - 5)
      :total Integer = p.sum()
      return :total

    @testPairBoth
      =
      p = Pair(3, 4)
      :total Integer = p.sum()
      return :total

    @testPairDefault
      =
      p = Pair(3)
      :total Integer = p.sum()
      return :total

    @testDefaultsBoth
      =
      d = Defaults(1, 2)
      :total Integer = d.sum()
      return :total

    @testDefaultsNone
      =
      d = Defaults()
      :total Integer = d.sum()
      return :total
  `;

  it('both args provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testPairBoth', from: 'c' } },
      { output: { id: '1', 'ty': { total: 'Integer' }, re: { total: 7 }, to: 'c' } },
    );
  });

  it('optional omitted — default fills in', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'testPairDefault', from: 'c' } },
      { output: { id: '2', 'ty': { total: 'Integer' }, re: { total: 3 }, to: 'c' } },
    );
  });

  it('all-default params — both provided', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'testDefaultsBoth', from: 'c' } },
      { output: { id: '3', 'ty': { total: 'Integer' }, re: { total: 3 }, to: 'c' } },
    );
  });

  it('all-default params — none provided', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: 'testDefaultsNone', from: 'c' } },
      { output: { id: '4', 'ty': { total: 'Integer' }, re: { total: 30 }, to: 'c' } },
    );
  });

  it('a negative positional default fills in', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: 'testBelowDefault', from: 'c' } },
      { output: { id: '5', 'ty': { total: 'Integer' }, re: { total: 1 }, to: 'c' } },
    );
  });

  it('a negative named default fills in', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: 'testOffsetDefault', from: 'c' } },
      { output: { id: '6', 'ty': { total: 'Integer' }, re: { total: 2 }, to: 'c' } },
    );
  });

  it('a negative named arg overrides it', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: 'testOffsetGiven', from: 'c' } },
      { output: { id: '7', 'ty': { total: 'Integer' }, re: { total: -2 }, to: 'c' } },
    );
  });

  it('a negative default renders as optional', () => {
    expect(extract(`
      @Offset = (a Integer, b: Integer = -1) *{}
      @Below = (b Integer = -2) *{}
    `).interface.service).toBe('{\n  Offset (Integer, ? b: Integer) -> *{}\n  Below (? Integer) -> *{}\n}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Retired `*(params) { body }` forms — the `*` now marks the body.
// ═══════════════════════════════════════════════════════════════════════════════

describe('constructor delimited form — retired forms', () => {
  it('Cls = *(params) { body } is a parse error', () => {
    expect(() => compileSource(`
      T = *(a Integer) { @get = -> v: a }
    `)).toThrow(/is retired/);
  });

  it('Cls = *(params) with no body is a parse error', () => {
    expect(() => compileSource(`
      T = *(a Integer)
      @test = -> 1
    `)).toThrow(/is retired/);
  });

  it('Cls = *() { body } is a parse error', () => {
    expect(() => compileSource(`
      T = *() { @get = -> v: 1 }
    `)).toThrow(/is retired/);
  });

  it('Cls = * with no body opener (no params, no body) is a parse error', () => {
    expect(() => compileSource(`
      T = *
      @test = -> 1
    `)).toThrow();
  });

  it('@Cls = *(params) { body } public-form is a parse error', () => {
    expect(() => compileSource(`
      @T = *(a Integer) { @get = -> v: a }
    `)).toThrow(/is retired/);
  });

  it('Sub = *(T |) -> expr (ingest) is a parse error', () => {
    expect(() => compileSource(`
      T = (a Integer) *{}
      U = *(T |) -> "hello"
      @test = -> 1
    `)).toThrow(/is retired/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Empty body — explicit void is legal.
// ═══════════════════════════════════════════════════════════════════════════════

describe('constructor delimited form — empty body', () => {
  it('Cls = (params) *{} (empty braced body) compiles', () => {
    expect(() => compileSource(`
      T = (a Integer) *{}
      @test = { t = T(1); return ok: "ok" }
    `)).not.toThrow();
  });

  it('Cls = * {} (no params, empty braced body) compiles', () => {
    expect(() => compileSource(`
      T = * {}
      @test = { t = T(); return ok: "ok" }
    `)).not.toThrow();
  });
});

// An expression default runs in the constructor once the other params are
// bound (notes/param-default-expressions-2026-11-10.md).
describe('constructor delimited form — expression defaults', () => {
  const script = `
    limit Integer = 7

    Sum = (a Integer, b Integer = 1 + 2) *{
      @sum = -> total: (a + b)
    }
    Later = (a Integer = b + 1, b: Integer = 10) *{
      @sum = -> total: (a + b)
    }
    FromFile = (a Integer, b Integer = limit + a) *{
      @sum = -> total: (a + b)
    }
    Base = *{
      @base = -> v: 1
    }
    Sub = (Base ++ n Integer = 1 + 2) *{
      @sum = -> total: n
    }

    @omitted
      =
      s = Sum(1)
      :total Integer = s.sum()
      return :total

    @given
      =
      s = Sum(1, 5)
      :total Integer = s.sum()
      return :total

    @later
      =
      s = Later()
      :total Integer = s.sum()
      return :total

    @laterByName
      =
      s = Later(b: 4)
      :total Integer = s.sum()
      return :total

    @fromFile
      =
      s = FromFile(3)
      :total Integer = s.sum()
      return :total

    @sub
      =
      s = Sub()
      :total Integer = s.sum()
      return :total
  `;
  const total = (op, value) => expectBehavior(script,
    { input: { id: '1', op, from: 'c' } },
    { output: { id: '1', 'ty': { total: 'Integer' }, re: { total: value }, to: 'c' } },
  );

  it('an omitted arg takes the expression', () => total('omitted', 4));
  it('a given arg wins', () => total('given', 6));
  it('a default reads a later param', () => total('later', 21));
  it('a default reads a later param given by name', () => total('laterByName', 9));
  it('a default reads a file-level cell', () => total('fromFile', 13));
  it('a subclass param takes one after ++', () => total('sub', 3));

  it('renders as optional', () => {
    expect(extract(`
      @A = *{}
      @Sum = (a Integer, b Integer = 1 + 2) *{}
      @Sub = (@A ++ n Integer = 1 + 2) *{}
    `).interface.service).toBe('{\n  A () -> *{}\n  Sum (Integer, ? Integer) -> *{}\n  Sub (A ++ ? Integer) -> *{\n    ...A\n  }\n}');
  });

  it('an untyped param with an expression default is an error', () => {
    expect(() => compileSource('C = (a Integer, b = a + 1) *{}\n@go = -> 1')).toThrow(/Param 'b': a default that isn't a literal needs a type/);
  });

  it('defaults that name each other are an error', () => {
    expect(() => compileSource('C = (a Integer = b, b Integer = a) *{}\n@go = -> 1')).toThrow(/Param defaults form a cycle: a → b → a/);
  });

  it('a default can\'t call a file-level function, as the body can\'t', () => {
    expect(() => compileSource(`
      double = (n Integer) { n * 2 }
      C = (a Integer, b Integer = double(a)) *{}
      @go = -> 1
    `)).toThrow(/'double' is a function of this file, and a class can't call it yet/);
  });
});
