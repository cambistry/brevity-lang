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
  const script = `
    T = <val Integer> {
      @double = -> result: (val * 2) as Integer
    }

    Pair = <a Integer, b Integer> {
      @sum = -> total: (a + b) as Integer
    }

    Secret = <(secret) Integer> {
      @double = -> result: (secret * 2) as Integer
    }

    Override = <val Integer> {
      @val = -> result: 999 as Integer
    }

    @testAccessor = |n: Integer| {
      t = T(n)
      :val = t.val()
      -> result: val as Integer
    }

    @testPairA = {
      p = Pair(3, 7)
      :a = p.a()
      -> result: a as Integer
    }

    @testPairB = {
      p = Pair(3, 7)
      :b = p.b()
      -> result: b as Integer
    }

    @testSuppressedDouble = {
      t = Secret(5)
      :result = t.double()
      -> result: result as Integer
    }

    @testOverride = {
      t = Override(42)
      :result = t.val()
      -> result: result as Integer
    }
  `;

  it('accessor returns param value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ n: 42 }, '@testAccessor'], 'bv-a': [{ n: 'Integer' }], from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('multiple accessors return correct values', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testPairA', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } },
      { input: { id: '2', op: '@testPairB', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('suppressed accessor is unhandled', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testSuppressedDouble', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('explicit handler overrides auto-accessor', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testOverride', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 999 }, to: 'c' } },
    );
  });
});
