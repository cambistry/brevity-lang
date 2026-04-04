import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Constructor param auto-accessors
//
// Auto-generated public accessors for constructor params:
//   a Integer          → accessor @a (accessed via instance.a)
//   (a) Integer        → suppressed (positional alias, no accessor)
// ═══════════════════════════════════════════════════════════════════════════════

describe('auto-accessors — compilation', () => {
  it('basic accessor compiles', () => {
    expect(() => compileSource(`
      T = <a Integer> {
        @test = -> 1 as Integer
      }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('suppressed accessor compiles', () => {
    expect(() => compileSource(`
      T = <(a) Integer> {
        @test = -> a as Integer
      }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('mixed suppressed and unsuppressed compiles', () => {
    expect(() => compileSource(`
      T = <(a) Integer, b Integer> {
        @test = -> a as Integer
      }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });
});

describe('auto-accessors — runtime', () => {
  it('accessor returns param value', async () => {
    await expectBehavior(`
      T = <val Integer> {
        @double = -> result: (val * 2) as Integer
      }

      @test = |n: Integer| {
        t = T(n)
        :val = t.val()
        -> result: val as Integer
      }
    `,
      { input: { id: '1', op: [{ n: 42 }, '@test'], 'bv-a': [{ n: 'Integer' }], from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('multiple accessors return correct values', async () => {
    await expectBehavior(`
      Pair = <a Integer, b Integer> {
        @sum = -> total: (a + b) as Integer
      }

      @testA = {
        p = Pair(3, 7)
        :a = p.a()
        -> result: a as Integer
      }

      @testB = {
        p = Pair(3, 7)
        :b = p.b()
        -> result: b as Integer
      }
    `,
      { input: { id: '1', op: '@testA', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } },
      { input: { id: '2', op: '@testB', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('suppressed accessor is unhandled', async () => {
    await expectBehavior(`
      T = <(secret) Integer> {
        @double = -> result: (secret * 2) as Integer
      }

      @testDouble = {
        t = T(5)
        :result = t.double()
        -> result: result as Integer
      }

      @testAccess = {
        t = T(5)
        :secret = t.secret()
        -> result: secret as Integer
      }
    `,
      { input: { id: '1', op: '@testDouble', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('explicit handler overrides auto-accessor', async () => {
    await expectBehavior(`
      T = <val Integer> {
        @val = -> result: 999 as Integer
      }

      @test = {
        t = T(42)
        :result = t.val()
        -> result: result as Integer
      }
    `,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 999 }, to: 'c' } },
    );
  });
});
