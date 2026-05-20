import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Subclasses — T | inheritance syntax
//
// *(T |)           inherit from T (no wrapped superclass exposed)
// *(T *name |)     inherit from T, expose wrapped superclass as `name`
// *(T* |)          sugar for *(T *T |) — access super via T.method
// *(T | :arg Type) inherit from T, add class args
// ═══════════════════════════════════════════════════════════════════════════════

// ── Compilation: positional args ─────────────────────────────────────────────

describe('subclasses — positional arg inheritance — compilation', () => {
  it('subclass inherits positional arg and adds its own', () => {
    expect(() => compileSource(`
      T = *(a Integer) {}
      U = *(T | b Integer) {}
      @test = -> 1
    `)).not.toThrow();
  });
});

// ── Compilation: named args ──────────────────────────────────────────────────

describe('subclasses — named arg inheritance — compilation', () => {
  it('subclass inherits named arg and adds its own', () => {
    expect(() => compileSource(`
      T = *(a: Integer) {}
      U = *(T | b: Integer) {}
      @test = -> 1
    `)).not.toThrow();
  });
});

// ── Compilation: mixed positional and named args ─────────────────────────────

describe('subclasses — mixed positional/named arg inheritance — compilation', () => {
  it('positional super, named subclass arg', () => {
    expect(() => compileSource(`
      T = *(a Integer) {}
      U = *(T | b: Integer) {}
      @test = -> 1
    `)).not.toThrow();
  });

  it('named super, positional subclass arg', () => {
    expect(() => compileSource(`
      T = *(a: Integer) {}
      U = *(T | b Integer) {}
      @test = -> 1
    `)).not.toThrow();
  });

  it('multiple mixed args across levels', () => {
    expect(() => compileSource(`
      T = *(a Integer, b: Text) {}
      U = *(T | c: Integer, d Integer) {}
      @test = -> 1
    `)).not.toThrow();
  });
});

// ── Compilation: arg type override rejected ──────────────────────────────────

describe('subclasses — arg type override rejected — compilation', () => {
  it('changing inherited arg type is a compiler error', () => {
    expect(() => compileSource(`
      T = *(a: Decimal) {}
      U = *(T | a: Integer) {}
      @test = -> 1
    `)).toThrow();
  });

  it('re-aliasing inherited arg without changing type is ok', () => {
    expect(() => compileSource(`
      T = *(a: Decimal) {}
      V = *(T | a: (b) Decimal) {
        @c = -> result: b
      }
      @test = -> 1
    `)).not.toThrow();
  });
});

// ── Compilation: accessor type override rejected ─────────────────────────────

describe('subclasses — accessor type override rejected — compilation', () => {
  it('overriding mapped accessor with different type is a compiler error', () => {
    expect(() => compileSource(`
      T = *(a: :b Integer) {}
      U = *(T |) { @b = { "b" } }
      @test = -> 1
    `)).toThrow();
  });

  it('adding accessor on unmapped name is legal', () => {
    expect(() => compileSource(`
      T = *(a: :b Integer) {}
      V = *(T |) { @a = { "a" } }
      @test = -> 1
    `)).not.toThrow();
  });
});

// ── Compilation: whitespace tolerance in <T |> syntax ───────────────────────

describe('subclasses — whitespace tolerance — compilation', () => {
  it('< T | > with space before superclass', () => {
    expect(() => compileSource(`
      T = *(a Integer) {}
      U = *( T | b Integer) {}
      @test = -> 1
    `)).not.toThrow();
  });

  it('<\\nT |\\n> with newline before superclass', () => {
    expect(() => compileSource(`
      T = *(a Integer) {}
      U = *(
        T |
        b Integer
      ) {}
      @test = -> 1
    `)).not.toThrow();
  });

  it('<\\nT* |\\n> lineal with wrapped superclass', () => {
    expect(() => compileSource(`
      T = * { @a = -> result: 1 }
      U = *(
        T* |
      ) {
        @a = -> result: 2
        @b = { :result = T.a(); -> :result as Integer }
      }
      @test = -> 1
    `)).not.toThrow();
  });

  it('<\\nT *name |\\n> lineal with named wrapped superclass', () => {
    expect(() => compileSource(`
      T = * { @a = -> result: 1 }
      U = *(
        T *sup |
      ) {
        @a = -> result: 2
        @b = { :result = sup.a(); -> :result as Integer }
      }
      @test = -> 1
    `)).not.toThrow();
  });

  it('<\\nT |\\nparams\\n> lineal with params after superclass', () => {
    expect(() => compileSource(`
      T = *(a Integer) {}
      U = *(
        T |
        b Integer
        c: Text
      ) {
        @sum = -> result: (a + b)
      }
      @test = -> 1
    `)).not.toThrow();
  });
});

// ── Compilation: public function return type override rejected ───────────────

describe('subclasses — public function type override rejected — compilation', () => {
  it('overriding public function with different return type is a compiler error', () => {
    expect(() => compileSource(`
      T = * { @a = { 1 } }
      U = *(T |) { @a = { "one" } }
      @test = -> 1
    `)).toThrow();
  });
});

// ── Compilation: private function access rejected ────────────────────────────

describe('subclasses — private function access — compilation', () => {
  it('superclass private function is accessible within superclass', () => {
    expect(() => compileSource(`
      T = * { #x = { 1 }; @a = { #x() } }
      @test = -> 1
    `)).not.toThrow();
  });

  it('subclass cannot access superclass private function', () => {
    expect(() => compileSource(`
      T = * { #x = { 1 }; @a = { #x() } }
      U = *(T |) { @b = { #x() } }
      @test = -> 1
    `)).toThrow();
  });
});

// ── Compilation: wrapped superclass forms ────────────────────────────────────

describe('subclasses — wrapped superclass — compilation', () => {
  it('<T *name |> exposes wrapped superclass', () => {
    expect(() => compileSource(`
      T = * { @a = { 1 } }
      U = *(T *sup |) { @a = { 2 }; @b = { sup.a } }
      @test = -> 1
    `)).not.toThrow();
  });

  it('<T* |> sugar exposes wrapped superclass via type name', () => {
    expect(() => compileSource(`
      T = * { @a = { 1 } }
      U = *(T* |) { @a = { 2 }; @b = { T.a } }
      @test = -> 1
    `)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Runtime tests — grouped by fixture
// ═════════════════════════════════════════════════════════════════════════════

// ── Runtime: positional and named arg inheritance ────────────────────────────

describe('subclasses — arg inheritance — runtime', () => {
  const script = `
    T = *(a Integer) {}
    PosU = *(T | b Integer) {
      @sum = -> result: (a + b)
    }

    NT = *(a: Integer) {}
    NamedU = *(NT | b: Integer) {
      @sum = -> result: (a + b)
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
      :a Integer = u.a()
      -> result: a

    @testPosAccessorB
      =
      u = PosU(3, 7)
      :b Integer = u.b()
      -> result: b
  `;

  it('positional subclass inherits arg and computes', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testPos', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('named subclass inherits arg and computes', async () => {
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

  it('subclass own positional arg accessor works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testPosAccessorB', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });
});

// ── Runtime: mixed positional and named arg inheritance ──────────────────────

describe('subclasses — mixed positional/named args — runtime', () => {
  const script = `
    PosT = *(a Integer) {}
    MixedA = *(PosT | b: Text) {
      @getA = -> result: a
      @getB = -> result: b
    }

    NamedT = *(a: Text) {}
    MixedB = *(NamedT | b Integer) {
      @getA = -> result: a
      @getB = -> result: b
    }

    MultiT = *(a Integer, b: Text) {}
    MultiU = *(MultiT | c: Integer, d Integer) {
      @sum = -> result: (a + c + d)
      @text = -> result: b
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

  it('positional super arg with named subclass arg — positional value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testMixedA_a', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } },
    );
  });

  it('positional super arg with named subclass arg — named value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testMixedA_b', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hi' }, to: 'c' } },
    );
  });

  it('named super arg with positional subclass arg — named value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testMixedB_a', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hey' }, to: 'c' } },
    );
  });

  it('named super arg with positional subclass arg — positional value', async () => {
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

describe('subclasses — inherit/extend public functions — runtime', () => {
  const script = `
    T = * { @a = -> result: "a" }
    U = *(T |) { @b = -> result: "b" }

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

  it('subclass inherits superclass public function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testInheritedA', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'a' }, to: 'c' } },
    );
  });

  it('subclass exposes own public function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testOwnB', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'b' }, to: 'c' } },
    );
  });
});

// ── Runtime: override public functions ───────────────────────────────────────

describe('subclasses — override public functions — runtime', () => {
  const script = `
    T = * { @a = -> result: 1 }
    U = *(T |) { @a = -> result: 2 }

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

  it('superclass returns original value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testSuper', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('subclass override replaces function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testOverride', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } },
    );
  });
});

// ── Runtime: invoke inherited public and protected functions ─────────────────

describe('subclasses — invoke inherited functions — runtime', () => {
  const script = `
    T = * { a = { 1 }; b = { 2 } }
    U = *(T |) {
      @c = -> result: (a() + b()) as Integer
    }

    @testInvokeInherited
      =
      u = U()
      :result = u.c()
      -> :result as Integer
  `;

  it('subclass invokes inherited protected functions', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testInvokeInherited', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } },
    );
  });
});

// ── Runtime: inherit protected functions ─────────────────────────────────────

describe('subclasses — inherit protected functions — runtime', () => {
  const script = `
    T = * { x = { "x" }; @a = -> result: (x() + "") as Text }
    U = *(T |) { @b = -> result: (x() + "") as Text }

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

  it('superclass uses its own protected function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testSuperProtected', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'x' }, to: 'c' } },
    );
  });

  it('subclass calls inherited protected function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testInheritedProtected', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'x' }, to: 'c' } },
    );
  });
});

// ── Runtime: override protected functions ────────────────────────────────────

describe('subclasses — override protected functions — runtime', () => {
  const script = `
    T = * { x = { 1 }; @a = -> result: (x() + 0) as Integer }
    U = *(T |) { x = { 2 } }

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

  it('superclass uses original protected function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testSuperProtected', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('subclass override changes inherited behavior', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testOverriddenProtected', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } },
    );
  });
});

// ── Runtime: wrapped superclass access — named ───────────────────────────────

describe('subclasses — wrapped superclass *name — runtime', () => {
  const script = `
    T = * { @a = -> result: 1 }
    U = *(T *sup |) {
      @a = -> result: 2
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

  it('subclass override takes precedence', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testOverride', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } },
    );
  });

  it('wrapped superclass accesses superclass implementation', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testSuperAccess', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });
});

// ── Runtime: wrapped superclass access — sugared ─────────────────────────────

describe('subclasses — wrapped superclass T* sugar — runtime', () => {
  const script = `
    T = * { @a = -> result: 1 }
    U = *(T* |) {
      @a = -> result: 2
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

  it('subclass override takes precedence', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testOverride', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } },
    );
  });

  it('T.method accesses superclass implementation', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testSuperAccess', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });
});

// ── Runtime: multi-level inheritance T → U → V ───────────────────────────────

describe('subclasses — multi-level inheritance — runtime', () => {
  const script = `
    T = * { @a = -> result: 1 }
    U = *(T |) {
      @b = -> result: 2
    }
    V = *(U |) {
      @c = -> result: 3
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

describe('subclasses — multi-level override — runtime', () => {
  const script = `
    T = * { @a = -> result: 1 }
    U = *(T |) { @a = -> result: 2 }
    V = *(U |) { @a = -> result: 3 }

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

describe('subclasses — multi-level protected override — runtime', () => {
  const script = `
    T = * { x = { 10 }; @a = -> result: (x() + 0) as Integer }
    U = *(T |) { x = { 20 } }
    V = *(U |) { x = { 30 } }

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

describe('subclasses — multi-level arg accumulation — runtime', () => {
  const script = `
    T = *(a: Integer) {}
    U = *(T | b: Integer) {}
    V = *(U | c: Integer) {
      @sum = -> result: (a + b + c)
    }

    @testSum
      =
      v = V(a: 1, b: 2, c: 3)
      :result = v.sum()
      -> :result as Integer

    @testAccessorA
      =
      v = V(a: 1, b: 2, c: 3)
      :a Integer = v.a()
      -> result: a

    @testAccessorC
      =
      v = V(a: 1, b: 2, c: 3)
      :c Integer = v.c()
      -> result: c
  `;

  it('three-level subclass accumulates args', async () => {
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

// ── R:untime V cannot expose wrapped T (only U is visible) ───────────────────

describe('subclasses — multi-level wrapped superclass — runtime', () => {
  const script = `
    T = * { @a = -> result: 1 }
    U = *(T* |) {
      @a = -> result: 2
      @fromT = {
        :result = T.a()
        -> :result as Integer
      }
    }
    V = *(U* |) {
      @a = -> result: 3
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

  it('V accesses U via wrapped superclass', async () => {
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

// ═══════════════════════════════════════════════════════════════════════════════
// Subclasses with optional args
// ═══════════════════════════════════════════════════════════════════════════════

describe('subclasses — optional args — compilation', () => {
  it('superclass with optional arg, subclass adds required', () => {
    expect(() => compileSource(`
      T = *(a Integer = 0) {}
      U = *(T | b Integer) {
        @sum = -> result: (a + b)
      }
      @test = -> 1
    `)).not.toThrow();
  });

  it('subclass adds optional arg to inherited required', () => {
    expect(() => compileSource(`
      T = *(a Integer) {}
      U = *(T | b Integer = 10) {
        @sum = -> result: (a + b)
      }
      @test = -> 1
    `)).not.toThrow();
  });

  it('both levels have optional args', () => {
    expect(() => compileSource(`
      T = *(a: Integer = 1) {}
      U = *(T | b: Integer = 2) {
        @sum = -> result: (a + b)
      }
      @test = -> 1
    `)).not.toThrow();
  });
});

describe('subclasses — optional args — runtime', () => {
  const script = `
    T = *(a Integer = 0) {}
    U = *(T | b Integer = 10) {
      @sum = -> result: (a + b)
    }

    @testBothProvided
      =
      u = U(5, 20)
      :result = u.sum()
      -> :result as Integer

    @testSubDefault
      =
      u = U(5)
      :result = u.sum()
      -> :result as Integer

    @testAllDefaults
      =
      u = U()
      :result = u.sum()
      -> :result as Integer
  `;

  it('both args provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testBothProvided', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 25 }, to: 'c' } },
    );
  });

  it('subclass default fills in', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testSubDefault', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' } },
    );
  });

  it('all defaults fill in', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@testAllDefaults', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });
});
