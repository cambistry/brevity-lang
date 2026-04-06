import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Accessors with optional args
//
// Params with defaults should still generate accessors.
// The accessor returns the actual value (provided or default).
// ═══════════════════════════════════════════════════════════════════════════════

describe('auto-accessors — optional args — compilation', () => {
  it('param with default generates accessor', () => {
    expect(() => compileSource(`
      T = <a Integer = 5> {
        @test = -> result: a as Integer
      }
      @test = { t = T(); a: Integer = t.a(); -> result: a as Integer }
    `)).not.toThrow();
  });

  it('named param with default generates accessor', () => {
    expect(() => compileSource(`
      T = <label: Text = "hi"> {
        @test = -> result: label as Text
      }
      @test = { t = T(); :result = t.label(); -> :result as Text }
    `)).not.toThrow();
  });

  it('mixed required + optional params all generate accessors', () => {
    expect(() => compileSource(`
      T = <a Integer, b Integer = 0> {
        @test = -> result: a as Integer
      }
      @test = { t = T(1); a: Integer = t.a(); b: Integer = t.b(); -> result: (a + b) as Integer }
    `)).not.toThrow();
  });
});

describe('auto-accessors — optional args — runtime', () => {
  const script = `
    T = <a Integer, b Integer = 99> {
      @sum = -> result: (a + b) as Integer
    }

    @testAccessorProvided = {
      t = T(1, 2)
      b: Integer = t.b()
      -> result: b as Integer
    }

    @testAccessorDefault = {
      t = T(1)
      b: Integer = t.b()
      -> result: b as Integer
    }

    @testRequiredAccessor = {
      t = T(42)
      a: Integer = t.a()
      -> result: a as Integer
    }
  `;

  it('accessor returns provided value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testAccessorProvided', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } },
    );
  });

  it('accessor returns default value when omitted', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testAccessorDefault', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 99 }, to: 'c' } },
    );
  });

  it('required param accessor still works alongside optional', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@testRequiredAccessor', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });
});

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

describe('auto-accessors — positional with remapped accessor — compilation', () => {
  it('(name) :accessor Type compiles', () => {
    expect(() => compileSource(`
      T = <(a) :b Integer> {
        @test = -> result: a as Integer
      }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('(name) :accessor Type with multiple params compiles', () => {
    expect(() => compileSource(`
      T = <(x) :getX Integer, (y) :getY Integer> {
        @sum = -> result: (x + y) as Integer
      }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });
});

describe('auto-accessors — positional with remapped accessor — runtime', () => {
  const script = `
    T = <(a) :b Integer> {
      @internal = -> result: a as Integer
    }

    Multi = <(x) :getX Integer, (y) :getY Integer> {
      @sum = -> result: (x + y) as Integer
    }

    @testAccessor = {
      t = T(42)
      b: Integer = t.b()
      -> result: b as Integer
    }

    @testInternal = {
      t = T(42)
      :result = t.internal()
      -> :result as Integer
    }

    @testMultiX = {
      m = Multi(3, 7)
      getX: Integer = m.getX()
      -> result: getX as Integer
    }

    @testMultiY = {
      m = Multi(3, 7)
      getY: Integer = m.getY()
      -> result: getY as Integer
    }

    @testMultiSum = {
      m = Multi(3, 7)
      :result = m.sum()
      -> :result as Integer
    }
  `;

  it('accessor uses remapped name', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testAccessor', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('internal name still accessible in handlers', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testInternal', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('multiple remapped accessors — first', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testMultiX', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } },
    );
  });

  it('multiple remapped accessors — second', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testMultiY', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('handler uses internal names in computation', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testMultiSum', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
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
