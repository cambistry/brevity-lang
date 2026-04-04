import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Subtypes — <<T>> inheritance syntax
//
// <<T>>           inherit from T (no wrapped instance exposed)
// <<T *name>>     inherit from T, expose wrapped instance as `name`
// <<T*>>          sugar for <<T *T>> — access super via T.method
// <<T> arg: Type> inherit from T, add constructor args
// ═══════════════════════════════════════════════════════════════════════════════

// ── Compilation: positional args ─────────────────────────────────────────────

describe('subtypes — positional arg inheritance — compilation', () => {
  it('subtype inherits positional arg and adds its own', () => {
    expect(() => compileSource(`
      T = <a Integer> {}
      U = <<T> b Integer>
      @test = -> 1 as Integer
    `)).not.toThrow();
  });
});

// ── Compilation: named args ──────────────────────────────────────────────────

describe('subtypes — named arg inheritance — compilation', () => {
  it('subtype inherits named arg and adds its own', () => {
    expect(() => compileSource(`
      T = <a: Integer> {}
      U = <<T> b: Integer>
      @test = -> 1 as Integer
    `)).not.toThrow();
  });
});

// ── Compilation: mixed positional and named args ─────────────────────────────

describe('subtypes — mixed positional/named arg inheritance — compilation', () => {
  it('positional super, named subtype arg', () => {
    expect(() => compileSource(`
      T = <a Integer> {}
      U = <<T> b: Integer>
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('named super, positional subtype arg', () => {
    expect(() => compileSource(`
      T = <a: Integer> {}
      U = <<T> b Integer>
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('multiple mixed args across levels', () => {
    expect(() => compileSource(`
      T = <a Integer, b: Text> {}
      U = <<T> c: Integer, d Integer>
      @test = -> 1 as Integer
    `)).not.toThrow();
  });
});

// ── Compilation: arg type override rejected ──────────────────────────────────

describe('subtypes — arg type override rejected — compilation', () => {
  it('changing inherited arg type is a compiler error', () => {
    expect(() => compileSource(`
      T = <a: Decimal> {}
      U = <<T> a: Integer>
      @test = -> 1 as Integer
    `)).toThrow();
  });

  it('re-aliasing inherited arg without changing type is ok', () => {
    expect(() => compileSource(`
      T = <a: Decimal> {}
      V = <<T> a: (b) Decimal> {
        @c = -> result: b as Decimal
      }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });
});

// ── Compilation: accessor type override rejected ─────────────────────────────

describe('subtypes — accessor type override rejected — compilation', () => {
  it('overriding mapped accessor with different type is a compiler error', () => {
    expect(() => compileSource(`
      T = <a: :b Integer> {}
      U = <<T>> { @b = { "b" } }
      @test = -> 1 as Integer
    `)).toThrow();
  });

  it('adding accessor on unmapped name is legal', () => {
    expect(() => compileSource(`
      T = <a: :b Integer> {}
      V = <<T>> { @a = { "a" } }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });
});

// ── Compilation: public function return type override rejected ───────────────

describe('subtypes — public function type override rejected — compilation', () => {
  it('overriding public function with different return type is a compiler error', () => {
    expect(() => compileSource(`
      T = <> { @a = { 1 } }
      U = <<T>> { @a = { "one" } }
      @test = -> 1 as Integer
    `)).toThrow();
  });
});

// ── Compilation: private function access rejected ────────────────────────────

describe('subtypes — private function access — compilation', () => {
  it('supertype private function is accessible within supertype', () => {
    expect(() => compileSource(`
      T = <> { #x = { 1 }; @a = { #x() } }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('subtype cannot access supertype private function', () => {
    expect(() => compileSource(`
      T = <> { #x = { 1 }; @a = { #x() } }
      U = <<T>> { @b = { #x() } }
      @test = -> 1 as Integer
    `)).toThrow();
  });
});

// ── Compilation: wrapped instance forms ──────────────────────────────────────

describe('subtypes — wrapped instance — compilation', () => {
  it('<<T *name>> exposes wrapped instance', () => {
    expect(() => compileSource(`
      T = <> { @a = { 1 } }
      U = <<T *sup>> { @a = { 2 }; @b = { sup.a } }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('<<T*>> sugar exposes wrapped instance via type name', () => {
    expect(() => compileSource(`
      T = <> { @a = { 1 } }
      U = <<T*>> { @a = { 2 }; @b = { T.a } }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Runtime tests — grouped by fixture
// ═════════════════════════════════════════════════════════════════════════════

// ── Runtime: positional and named arg inheritance ────────────────────────────

describe('subtypes — arg inheritance — runtime', () => {
  const script = `
    T = <a Integer> {}
    PosU = <<T> b Integer> {
      @sum = -> result: (a + b) as Integer
    }

    NT = <a: Integer> {}
    NamedU = <<NT> b: Integer> {
      @sum = -> result: (a + b) as Integer
    }

    @testPos
      =
      u = PosU(3, 7)
      :result = u.sum()
      -> :result as Integer

    @testNamed
      =
      u = NamedU(a: 3, b: 7)
      :result = u.sum()
      -> :result as Integer

    @testPosAccessorA
      =
      u = PosU(3, 7)
      a: Integer = u.a()
      -> result: a as Integer

    @testPosAccessorB
      =
      u = PosU(3, 7)
      b: Integer = u.b()
      -> result: b as Integer
  `;

  it('positional subtype inherits arg and computes', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testPos', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('named subtype inherits arg and computes', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testNamed', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('inherited positional arg accessor works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testPosAccessorA', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } },
    );
  });

  it('subtype own positional arg accessor works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testPosAccessorB', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });
});

// ── Runtime: mixed positional and named arg inheritance ──────────────────────

describe('subtypes — mixed positional/named args — runtime', () => {
  const script = `
    PosT = <a Integer> {}
    MixedA = <<PosT> b: Text> {
      @getA = -> result: a as Integer
      @getB = -> result: b as Text
    }

    NamedT = <a: Text> {}
    MixedB = <<NamedT> b Integer> {
      @getA = -> result: a as Text
      @getB = -> result: b as Integer
    }

    MultiT = <a Integer, b: Text> {}
    MultiU = <<MultiT> c: Integer, d Integer> {
      @sum = -> result: (a + c + d) as Integer
      @text = -> result: b as Text
    }

    @testMixedA_a
      =
      m = MixedA(5, b: "hi")
      :result = m.getA()
      -> :result as Integer

    @testMixedA_b
      =
      m = MixedA(5, b: "hi")
      :result = m.getB()
      -> :result as Text

    @testMixedB_a
      =
      m = MixedB(9, a: "hey")
      :result = m.getA()
      -> :result as Text

    @testMixedB_b
      =
      m = MixedB(9, a: "hey")
      :result = m.getB()
      -> :result as Integer

    @testMultiSum
      =
      m = MultiU(1, 3, b: "x", c: 2)
      :result = m.sum()
      -> :result as Integer

    @testMultiText
      =
      m = MultiU(1, 3, b: "x", c: 2)
      :result = m.text()
      -> :result as Text
  `;

  it('positional super arg with named subtype arg — positional value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testMixedA_a', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } },
    );
  });

  it('positional super arg with named subtype arg — named value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testMixedA_b', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hi' }, to: 'c' } },
    );
  });

  it('named super arg with positional subtype arg — named value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testMixedB_a', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hey' }, to: 'c' } },
    );
  });

  it('named super arg with positional subtype arg — positional value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testMixedB_b', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 9 }, to: 'c' } },
    );
  });

  it('multiple mixed args across two levels — sum', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testMultiSum', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });

  it('multiple mixed args across two levels — inherited text', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testMultiText', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'x' }, to: 'c' } },
    );
  });
});

// ── Runtime: inherit and extend public functions ─────────────────────────────

describe('subtypes — inherit/extend public functions — runtime', () => {
  const script = `
    T = <> { @a = -> result: "a" as Text }
    U = <<T>> { @b = -> result: "b" as Text }

    @testInheritedA
      =
      u = U()
      :result = u.a()
      -> :result as Text

    @testOwnB
      =
      u = U()
      :result = u.b()
      -> :result as Text
  `;

  it('subtype inherits supertype public function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testInheritedA', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'a' }, to: 'c' } },
    );
  });

  it('subtype exposes own public function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testOwnB', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'b' }, to: 'c' } },
    );
  });
});

// ── Runtime: override public functions ───────────────────────────────────────

describe('subtypes — override public functions — runtime', () => {
  const script = `
    T = <> { @a = -> result: 1 as Integer }
    U = <<T>> { @a = -> result: 2 as Integer }

    @testSuper
      =
      t = T()
      :result = t.a()
      -> :result as Integer

    @testOverride
      =
      u = U()
      :result = u.a()
      -> :result as Integer
  `;

  it('supertype returns original value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testSuper', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('subtype override replaces function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testOverride', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } },
    );
  });
});

// ── Runtime: invoke inherited public and protected functions ─────────────────

describe('subtypes — invoke inherited functions — runtime', () => {
  const script = `
    T = <> { a = { 1 }; b = { 2 } }
    U = <<T>> {
      @c = -> result: (a() + b()) as Integer
    }

    @testInvokeInherited
      =
      u = U()
      :result = u.c()
      -> :result as Integer
  `;

  it('subtype invokes inherited protected functions', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testInvokeInherited', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } },
    );
  });
});

// ── Runtime: inherit protected functions ─────────────────────────────────────

describe('subtypes — inherit protected functions — runtime', () => {
  const script = `
    T = <> { x = { "x" }; @a = -> result: (x() + "") as Text }
    U = <<T>> { @b = -> result: (x() + "") as Text }

    @testSuperProtected
      =
      t = T()
      :result = t.a()
      -> :result as Text

    @testInheritedProtected
      =
      u = U()
      :result = u.b()
      -> :result as Text
  `;

  it('supertype uses its own protected function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testSuperProtected', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'x' }, to: 'c' } },
    );
  });

  it('subtype calls inherited protected function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testInheritedProtected', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'x' }, to: 'c' } },
    );
  });
});

// ── Runtime: override protected functions ────────────────────────────────────

describe('subtypes — override protected functions — runtime', () => {
  const script = `
    T = <> { x = { 1 }; @a = -> result: (x() + 0) as Integer }
    U = <<T>> { x = { 2 } }

    @testSuperProtected
      =
      t = T()
      :result = t.a()
      -> :result as Integer

    @testOverriddenProtected
      =
      u = U()
      :result = u.a()
      -> :result as Integer
  `;

  it('supertype uses original protected function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testSuperProtected', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('subtype override changes inherited behavior', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testOverriddenProtected', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } },
    );
  });
});

// ── Runtime: wrapped instance access — named ─────────────────────────────────

describe('subtypes — wrapped instance *name — runtime', () => {
  const script = `
    T = <> { @a = -> result: 1 as Integer }
    U = <<T *sup>> {
      @a = -> result: 2 as Integer
      @b = {
        :result = sup.a()
        -> :result as Integer
      }
    }

    @testOverride
      =
      u = U()
      :result = u.a()
      -> :result as Integer

    @testSuperAccess
      =
      u = U()
      :result = u.b()
      -> :result as Integer
  `;

  it('subtype override takes precedence', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testOverride', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } },
    );
  });

  it('wrapped instance accesses supertype implementation', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testSuperAccess', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });
});

// ── Runtime: wrapped instance access — sugared ───────────────────────────────

describe('subtypes — wrapped instance T* sugar — runtime', () => {
  const script = `
    T = <> { @a = -> result: 1 as Integer }
    U = <<T*>> {
      @a = -> result: 2 as Integer
      @b = {
        :result = T.a()
        -> :result as Integer
      }
    }

    @testOverride
      =
      u = U()
      :result = u.a()
      -> :result as Integer

    @testSuperAccess
      =
      u = U()
      :result = u.b()
      -> :result as Integer
  `;

  it('subtype override takes precedence', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testOverride', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } },
    );
  });

  it('T.method accesses supertype implementation', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testSuperAccess', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });
});

// ── Runtime: multi-level inheritance T → U → V ───────────────────────────────

describe('subtypes — multi-level inheritance — runtime', () => {
  const script = `
    T = <> { @a = -> result: 1 as Integer }
    U = <<T>> {
      @b = -> result: 2 as Integer
    }
    V = <<U>> {
      @c = -> result: 3 as Integer
    }

    @testInheritedFromT
      =
      v = V()
      :result = v.a()
      -> :result as Integer

    @testInheritedFromU
      =
      v = V()
      :result = v.b()
      -> :result as Integer

    @testOwnV
      =
      v = V()
      :result = v.c()
      -> :result as Integer
  `;

  it('V inherits from T through U', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testInheritedFromT', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('V inherits from U directly', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testInheritedFromU', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } },
    );
  });

  it('V exposes own function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testOwnV', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } },
    );
  });
});

// ── Runtime: multi-level override ────────────────────────────────────────────

describe('subtypes — multi-level override — runtime', () => {
  const script = `
    T = <> { @a = -> result: 1 as Integer }
    U = <<T>> { @a = -> result: 2 as Integer }
    V = <<U>> { @a = -> result: 3 as Integer }

    @testT
      =
      t = T()
      :result = t.a()
      -> :result as Integer

    @testU
      =
      u = U()
      :result = u.a()
      -> :result as Integer

    @testV
      =
      v = V()
      :result = v.a()
      -> :result as Integer
  `;

  it('T returns original', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testT', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('U overrides T', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testU', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } },
    );
  });

  it('V overrides U (and transitively T)', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testV', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } },
    );
  });
});

// ── Runtime: multi-level protected override ──────────────────────────────────

describe('subtypes — multi-level protected override — runtime', () => {
  const script = `
    T = <> { x = { 10 }; @a = -> result: (x() + 0) as Integer }
    U = <<T>> { x = { 20 } }
    V = <<U>> { x = { 30 } }

    @testT
      =
      t = T()
      :result = t.a()
      -> :result as Integer

    @testU
      =
      u = U()
      :result = u.a()
      -> :result as Integer

    @testV
      =
      v = V()
      :result = v.a()
      -> :result as Integer
  `;

  it('T uses own protected', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testT', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('U override propagates to inherited public function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testU', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 20 }, to: 'c' } },
    );
  });

  it('V override propagates through two levels', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testV', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 30 }, to: 'c' } },
    );
  });
});

// ── Runtime: multi-level arg accumulation ────────────────────────────────────

describe('subtypes — multi-level arg accumulation — runtime', () => {
  const script = `
    T = <a: Integer> {}
    U = <<T> b: Integer> {}
    V = <<U> c: Integer> {
      @sum = -> result: (a + b + c) as Integer
    }

    @testSum
      =
      v = V(a: 1, b: 2, c: 3)
      :result = v.sum()
      -> :result as Integer

    @testAccessorA
      =
      v = V(a: 1, b: 2, c: 3)
      a: Integer = v.a()
      -> result: a as Integer

    @testAccessorC
      =
      v = V(a: 1, b: 2, c: 3)
      c: Integer = v.c()
      -> result: c as Integer
  `;

  it('three-level subtype accumulates args', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testSum', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });

  it('accessor for grandparent arg works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testAccessorA', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('accessor for own arg works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testAccessorC', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } },
    );
  });
});

// ── Runtime: V cannot expose wrapped T (only U is visible) ───────────────────

describe('subtypes — multi-level wrapped instance — runtime', () => {
  const script = `
    T = <> { @a = -> result: 1 as Integer }
    U = <<T*>> {
      @a = -> result: 2 as Integer
      @fromT = {
        :result = T.a()
        -> :result as Integer
      }
    }
    V = <<U*>> {
      @a = -> result: 3 as Integer
      @fromU = {
        :result = U.a()
        -> :result as Integer
      }
    }

    @testV
      =
      v = V()
      :result = v.a()
      -> :result as Integer

    @testVFromU
      =
      v = V()
      :result = v.fromU()
      -> :result as Integer

    @testVFromT
      =
      v = V()
      :result = v.fromT()
      -> :result as Integer
  `;

  it('V returns own override', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testV', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } },
    );
  });

  it('V accesses U via wrapped instance', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testVFromU', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } },
    );
  });

  it('V inherits U.fromT which accesses T', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testVFromT', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });
});
