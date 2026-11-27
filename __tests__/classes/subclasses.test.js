import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Subclasses — `^` inheritance syntax
//
// U = T ^ *{ … }            inherit from T, and its `new`
// U = T ^ (arg: Type) *{ super(…) … }
//                           a constructor of its own: its own params, and the
//                           parent's constructor run at `super` (super.test.js)
// base.a() / base::h()      the parent layer's public `@a` / protected `h`
// (base.test.js covers `base` in depth.)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Compilation: positional args ─────────────────────────────────────────────

describe('subclasses — positional args through super — compilation', () => {
  it('subclass passes a positional arg to its parent and adds its own', () => {
    expect(() => compileSource(`
      T = (a Integer) *{}
      U = T ^ (a Integer, b Integer) *{ super(a) }
      @test = () -> 1
    `)).not.toThrow();
  });
});

// ── Compilation: named args ──────────────────────────────────────────────────

describe('subclasses — named args through super — compilation', () => {
  it('subclass passes a named arg to its parent and adds its own', () => {
    expect(() => compileSource(`
      T = (a: Integer) *{}
      U = T ^ (a: Integer, b: Integer) *{ super(a: a) }
      @test = () -> 1
    `)).not.toThrow();
  });
});

// ── Compilation: mixed positional and named args ─────────────────────────────

describe('subclasses — mixed positional/named args through super — compilation', () => {
  it('positional parent param, named subclass param', () => {
    expect(() => compileSource(`
      T = (a Integer) *{}
      U = T ^ (a Integer, b: Integer) *{ super(a) }
      @test = () -> 1
    `)).not.toThrow();
  });

  it('named parent param, positional subclass param', () => {
    expect(() => compileSource(`
      T = (a: Integer) *{}
      U = T ^ (b Integer, a: Integer) *{ super(a: a) }
      @test = () -> 1
    `)).not.toThrow();
  });

  it('multiple mixed args across levels', () => {
    expect(() => compileSource(`
      T = (a Integer, b: Text) *{}
      U = T ^ (a Integer, d Integer, b: Text, c: Integer) *{ super(a, b: b) }
      @test = () -> 1
    `)).not.toThrow();
  });
});

// ── Compilation: arg type override rejected ──────────────────────────────────

describe('subclasses — super arg types — compilation', () => {
  it('an arg of the wrong type for the parent\'s param is a compiler error', () => {
    expect(() => compileSource(`
      T = (a: Decimal) *{}
      U = T ^ (a: Text) *{ super(a: a) }
      @test = () -> 1
    `)).toThrow();
  });

  it('a param of its own, under another local name, passed on', () => {
    expect(() => compileSource(`
      T = (a: Decimal) *{}
      V = T ^ (a: b Decimal) *{
        super(a: b)
        @c = () -> result: b
      }
      @test = () -> 1
    `)).not.toThrow();
  });
});

// ── Compilation: accessor type override rejected ─────────────────────────────

describe('subclasses — accessor type override rejected — compilation', () => {
  it('overriding a published param with a different type is a compiler error', () => {
    expect(() => compileSource(`
      T = (@b: Integer) *{}
      U = T ^ *{ @b = { "b" } }
      @test = () -> 1
    `)).toThrow(/cannot change type of inherited accessor '@b'/);
  });

  it('adding a handler named like an unpublished param is legal', () => {
    expect(() => compileSource(`
      T = (a: Integer) *{}
      V = T ^ *{ @a = { "a" } }
      @test = () -> 1
    `)).not.toThrow();
  });
});

// ── Compilation: whitespace tolerance in <T |> syntax ───────────────────────

describe('subclasses — whitespace tolerance — compilation', () => {
  it('< T | > with space before superclass', () => {
    expect(() => compileSource(`
      T = (a Integer) *{}
      U = T ^ (b Integer) *{ super(b) }
      @test = () -> 1
    `)).not.toThrow();
  });

  it('<\\nT |\\n> with newline before superclass', () => {
    expect(() => compileSource(`
      T = (a Integer) *{}
      U = T ^ (b Integer) *{
        super(b)
      }
      @test = () -> 1
    `)).not.toThrow();
  });

  it('the parent layer reached through base.', () => {
    expect(() => compileSource(`
      T = * { @a = () -> result: 1 }
      U = T ^ *{
        @a = () -> result: 2
        @b = { :result = base.a(); return :result as Integer }
      }
      @test = () -> 1
    `)).not.toThrow();
  });

  it('the parent layer named with base[T]', () => {
    expect(() => compileSource(`
      T = * { @a = () -> result: 1 }
      U = T ^ *{
        @a = () -> result: 2
        @b = { :result = base[T].a(); return :result as Integer }
      }
      @test = () -> 1
    `)).not.toThrow();
  });

  it('<\\nT |\\nparams\\n> lineal with params after superclass', () => {
    expect(() => compileSource(`
      T = (a Integer) *{}
      U = T ^ (a Integer, b Integer
        c: Text) *{
        super(a)
        @sum = () -> result: (a + b)
      }
      @test = () -> 1
    `)).not.toThrow();
  });
});

// ── Compilation: public function return type override rejected ───────────────

describe('subclasses — public function type override rejected — compilation', () => {
  it('overriding public function with different return type is a compiler error', () => {
    expect(() => compileSource(`
      T = * { @a = { 1 } }
      U = T ^ *{ @a = { "one" } }
      @test = () -> 1
    `)).toThrow();
  });
});

// ── Compilation: private function access rejected ────────────────────────────

describe('subclasses — private function access — compilation', () => {
  it('superclass private function is accessible within superclass', () => {
    expect(() => compileSource(`
      T = * { #x = { 1 }; @a = { #x() } }
      @test = () -> 1
    `)).not.toThrow();
  });

  it('subclass cannot access superclass private function', () => {
    expect(() => compileSource(`
      T = * { #x = { 1 }; @a = { #x() } }
      U = T ^ *{ @b = { #x() } }
      @test = () -> 1
    `)).toThrow();
  });
});

// ── Compilation: the parent layer, and the retired wrapped forms ─────────────

describe('subclasses — base and wrapped parents — compilation', () => {
  it('base.a reaches the parent layer', () => {
    expect(() => compileSource(`
      T = * { @a = { 1 } }
      U = T ^ *{ @a = { 2 }; @b = { base.a } }
      @test = () -> 1
    `)).not.toThrow();
  });

});

describe('subclasses — runtime', () => {
  const script = `
    // subclasses — args passed to the parent through super — runtime
    T = (@a Integer) *{}
    PosU = T ^ (a Integer, @b Integer) *{
      super(a)
      @sum = () -> result: (a + b)
    }

    NT = (a: Integer) *{}
    NamedU = NT ^ (a: Integer, b: Integer) *{
      super(a: a)
      @sum = () -> result: (a + b)
    }

    @testPos
      =
      u = PosU(3, 7)
      :result = u.sum()
      return :result as Integer

    @testNamed
      =
      u = NamedU(a: 3, b: 7)
      :result = u.sum()
      return :result as Integer

    @testPosAccessorA
      =
      u = PosU(3, 7)
      a Integer = u.a()
      return result: a

    @testPosAccessorB
      =
      u = PosU(3, 7)
      b Integer = u.b()
      return result: b

    // subclasses — mixed positional/named args — runtime
    PosT = (a Integer) *{}
    MixedA = PosT ^ (a Integer, b: Text) *{
      super(a)
      @getA = () -> result: a
      @getB = () -> result: b
    }

    NamedT = (a: Text) *{}
    MixedB = NamedT ^ (b Integer, a: Text) *{
      super(a: a)
      @getA = () -> result: a
      @getB = () -> result: b
    }

    MultiT = (a Integer, b: Text) *{}
    MultiU = MultiT ^ (a Integer, d Integer, b: Text, c: Integer) *{
      super(a, b: b)
      @sum = () -> result: (a + c + d)
      @text = () -> result: b
    }

    @testMixedA_a
      =
      m = MixedA(5, b: "hi")
      :result = m.getA()
      return :result as Integer

    @testMixedA_b
      =
      m = MixedA(5, b: "hi")
      :result = m.getB()
      return :result as Text

    @testMixedB_a
      =
      m = MixedB(9, a: "hey")
      :result = m.getA()
      return :result as Text

    @testMixedB_b
      =
      m = MixedB(9, a: "hey")
      :result = m.getB()
      return :result as Integer

    @testMultiSum
      =
      m = MultiU(1, 3, b: "x", c: 2)
      :result = m.sum()
      return :result as Integer

    @testMultiText
      =
      m = MultiU(1, 3, b: "x", c: 2)
      :result = m.text()
      return :result as Text

    // subclasses — inherit/extend public functions — runtime
    T3 = * { @a = () -> result: "a" }
    U = T3 ^ *{ @b = () -> result: "b" }

    @testInheritedA
      =
      u = U()
      :result = u.a()
      return :result as Text

    @testOwnB
      =
      u = U()
      :result = u.b()
      return :result as Text

    // subclasses — override public functions — runtime
    T4 = * { @a = () -> result: 1 }
    U4 = T4 ^ *{ @a = () -> result: 2 }

    @testSuper
      =
      t = T4()
      :result = t.a()
      return :result as Integer

    @testOverride
      =
      u = U4()
      :result = u.a()
      return :result as Integer

    // subclasses — invoke inherited functions — runtime
    T5 = * { a = { 1 }; b = { 2 } }
    U5 = T5 ^ *{
      @c = () -> result: (a() + b()) as Integer
    }

    @testInvokeInherited
      =
      u = U5()
      :result = u.c()
      return :result as Integer

    // subclasses — inherit protected functions — runtime
    T6 = * { x = { "x" }; @a = () -> result: (x() + "") as Text }
    U6 = T6 ^ *{ @b = () -> result: (x() + "") as Text }

    @testSuperProtected
      =
      t = T6()
      :result = t.a()
      return :result as Text

    @testInheritedProtected
      =
      u = U6()
      :result = u.b()
      return :result as Text

    // subclasses — override protected functions — runtime
    T7 = * { x = { 1 }; @a = () -> result: (x() + 0) as Integer }
    U7 = T7 ^ *{ x = { 2 } }

    @testSuperProtected7
      =
      t = T7()
      :result = t.a()
      return :result as Integer

    @testOverriddenProtected
      =
      u = U7()
      :result = u.a()
      return :result as Integer

    // subclasses — the parent layer through base. — runtime
    T8 = * { @a = () -> result: 1 }
    U8 = T8 ^ *{
      @a = () -> result: 2
      @b = {
        :result = base.a()
        return :result as Integer
      }
    }

    @testOverride8
      =
      u = U8()
      :result = u.a()
      return :result as Integer

    @testSuperAccess
      =
      u = U8()
      :result = u.b()
      return :result as Integer

    // subclasses — the parent layer named with base[T] — runtime
    T9 = * { @a = () -> result: 1 }
    U9 = T9 ^ *{
      @a = () -> result: 2
      @b = {
        :result = base[T9].a()
        return :result as Integer
      }
    }

    @testOverride9
      =
      u = U9()
      :result = u.a()
      return :result as Integer

    @testSuperAccess9
      =
      u = U9()
      :result = u.b()
      return :result as Integer

    // subclasses — multi-level inheritance — runtime
    T10 = * { @a = () -> result: 1 }
    U10 = T10 ^ *{
      @b = () -> result: 2
    }
    V = U10 ^ *{
      @c = () -> result: 3
    }

    @testInheritedFromT
      =
      v = V()
      :result = v.a()
      return :result as Integer

    @testInheritedFromU
      =
      v = V()
      :result = v.b()
      return :result as Integer

    @testOwnV
      =
      v = V()
      :result = v.c()
      return :result as Integer

    // subclasses — multi-level override — runtime
    T11 = * { @a = () -> result: 1 }
    U11 = T11 ^ *{ @a = () -> result: 2 }
    V11 = U11 ^ *{ @a = () -> result: 3 }

    @testT
      =
      t = T11()
      :result = t.a()
      return :result as Integer

    @testU
      =
      u = U11()
      :result = u.a()
      return :result as Integer

    @testV
      =
      v = V11()
      :result = v.a()
      return :result as Integer

    // subclasses — multi-level protected override — runtime
    T12 = * { x = { 10 }; @a = () -> result: (x() + 0) as Integer }
    U12 = T12 ^ *{ x = { 20 } }
    V12 = U12 ^ *{ x = { 30 } }

    @testT12
      =
      t = T12()
      :result = t.a()
      return :result as Integer

    @testU12
      =
      u = U12()
      :result = u.a()
      return :result as Integer

    @testV12
      =
      v = V12()
      :result = v.a()
      return :result as Integer

    // subclasses — args forwarded through two levels — runtime
    T13 = (@a: Integer) *{}
    U13 = T13 ^ (a: Integer, b: Integer) *{ super(a: a) }
    V13 = U13 ^ (a: Integer, b: Integer, @c: Integer) *{
      super(a: a, b: b)
      @sum = () -> result: (a + b + c)
    }

    @testSum
      =
      v = V13(a: 1, b: 2, c: 3)
      :result = v.sum()
      return :result as Integer

    @testAccessorA
      =
      v = V13(a: 1, b: 2, c: 3)
      a Integer = v.a()
      return result: a

    @testAccessorC
      =
      v = V13(a: 1, b: 2, c: 3)
      c Integer = v.c()
      return result: c

    // subclasses — multi-level parent layers — runtime
    T14 = * { @a = () -> result: 1 }
    U14 = T14 ^ *{
      @a = () -> result: 2
      @fromT = {
        :result = base.a()
        return :result as Integer
      }
    }
    V14 = U14 ^ *{
      @a = () -> result: 3
      @fromU = {
        :result = base.a()
        return :result as Integer
      }
    }

    @testV14
      =
      v = V14()
      :result = v.a()
      return :result as Integer

    @testVFromU
      =
      v = V14()
      :result = v.fromU()
      return :result as Integer

    @testVFromT
      =
      v = V14()
      :result = v.fromT()
      return :result as Integer

    // subclasses — optional args — runtime
    T15 = (a Integer = 0) *{}
    U15 = T15 ^ (a Integer = 0, b Integer = 10) *{
      super(a)
      @sum = () -> result: (a + b)
    }

    @testBothProvided
      =
      u = U15(5, 20)
      :result = u.sum()
      return :result as Integer

    @testSubDefault
      =
      u = U15(5)
      :result = u.sum()
      return :result as Integer

    @testAllDefaults
      =
      u = U15()
      :result = u.sum()
      return :result as Integer

    // subclasses — ^ bare forms and two parents — runtime
    A = *{
      @get = () -> result: 1
      @onlyA = () -> result: 10
    }
    B = *{
      @get = () -> result: 2
      @onlyB = () -> result: 20
    }
    Same = A^
    Both = A ^ B
    Added = A ^ *{ @extra = () -> result: 3 }
    Sized = A ^ B ^ (n Integer) *{
      super[A]()
      super[B]()
      @size = () -> result: n
    }
    Again = Both ^ A
    Ahead = Later ^ B
    Later = *{ @five = () -> result: 5 }
    side Integer = 3
    two Integer = 2
    squared = side ^ two

    @testAgain
      =
      a = Again()
      :result = a.get()
      return :result as Integer

    @testAhead
      =
      a = Ahead()
      :result = a.five()
      return :result as Integer

    @testSquared = () -> result: squared

    @testSame
      =
      s = Same()
      :result = s.get()
      return :result as Integer

    @testBothLaterWins
      =
      b = Both()
      :result = b.get()
      return :result as Integer

    @testBothFirstParent
      =
      b = Both()
      :result = b.onlyA()
      return :result as Integer

    @testBothSecondParent
      =
      b = Both()
      :result = b.onlyB()
      return :result as Integer

    @testAdded
      =
      a = Added()
      :result = a.extra()
      return :result as Integer

    @testSized
      =
      s = Sized(7)
      :result = s.size()
      return :result as Integer
  `;

  // ═════════════════════════════════════════════════════════════════════════════
  // Runtime tests — grouped by fixture
  // ═════════════════════════════════════════════════════════════════════════════
  
  // ── Runtime: positional and named arg inheritance ────────────────────────────

  it('subclasses — arg inheritance — runtime — positional subclass inherits arg and computes', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testPos', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 10 }], to: 'c' } },
    );
  });

  it('subclasses — arg inheritance — runtime — named subclass inherits arg and computes', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testNamed', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 10 }], to: 'c' } },
    );
  });

  it('subclasses — arg inheritance — runtime — inherited positional arg accessor works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testPosAccessorA', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } },
    );
  });

  it('subclasses — arg inheritance — runtime — subclass own positional arg accessor works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testPosAccessorB', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 7 }], to: 'c' } },
    );
  });

  // ── Runtime: mixed positional and named arg inheritance ──────────────────────

  it('subclasses — mixed positional/named args — runtime — positional super arg with named subclass arg — positional value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testMixedA_a', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 5 }], to: 'c' } },
    );
  });

  it('subclasses — mixed positional/named args — runtime — positional super arg with named subclass arg — named value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testMixedA_b', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'hi' }], to: 'c' } },
    );
  });

  it('subclasses — mixed positional/named args — runtime — named super arg with positional subclass arg — named value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testMixedB_a', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'hey' }], to: 'c' } },
    );
  });

  it('subclasses — mixed positional/named args — runtime — named super arg with positional subclass arg — positional value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testMixedB_b', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 9 }], to: 'c' } },
    );
  });

  it('subclasses — mixed positional/named args — runtime — multiple mixed args across two levels — sum', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testMultiSum', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 6 }], to: 'c' } },
    );
  });

  it('subclasses — mixed positional/named args — runtime — multiple mixed args across two levels — inherited text', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testMultiText', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'x' }], to: 'c' } },
    );
  });

  // ── Runtime: inherit and extend public functions ─────────────────────────────

  it('subclasses — inherit/extend public functions — runtime — subclass inherits superclass public function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testInheritedA', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'a' }], to: 'c' } },
    );
  });

  it('subclasses — inherit/extend public functions — runtime — subclass exposes own public function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testOwnB', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'b' }], to: 'c' } },
    );
  });

  // ── Runtime: override public functions ───────────────────────────────────────

  it('subclasses — override public functions — runtime — superclass returns original value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testSuper', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } },
    );
  });

  it('subclasses — override public functions — runtime — subclass override replaces function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testOverride', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } },
    );
  });

  // ── Runtime: invoke inherited public and protected functions ─────────────────

  it('subclasses — invoke inherited functions — runtime — subclass invokes inherited protected functions', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testInvokeInherited', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } },
    );
  });

  // ── Runtime: inherit protected functions ─────────────────────────────────────

  it('subclasses — inherit protected functions — runtime — superclass uses its own protected function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testSuperProtected', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'x' }], to: 'c' } },
    );
  });

  it('subclasses — inherit protected functions — runtime — subclass calls inherited protected function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testInheritedProtected', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'x' }], to: 'c' } },
    );
  });

  // ── Runtime: override protected functions ────────────────────────────────────

  it('subclasses — override protected functions — runtime — superclass uses original protected function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testSuperProtected7', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } },
    );
  });

  it('subclasses — override protected functions — runtime — subclass override changes inherited behavior', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testOverriddenProtected', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } },
    );
  });

  // ── Runtime: the parent layer through base. ──────────────────────────────────

  it('subclasses — base. — runtime — subclass override takes precedence', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testOverride8', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } },
    );
  });

  it('subclasses — base. — runtime — base.a reaches the parent implementation', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testSuperAccess', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } },
    );
  });

  // ── Runtime: the parent layer named with base[T] ─────────────────────────────

  it('subclasses — base[T] — runtime — subclass override takes precedence', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testOverride9', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } },
    );
  });

  it('subclasses — base[T] — runtime — base[T].a reaches the parent implementation', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testSuperAccess9', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } },
    );
  });

  // ── Runtime: multi-level inheritance T → U → V ───────────────────────────────

  it('subclasses — multi-level inheritance — runtime — V inherits from T through U', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testInheritedFromT', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } },
    );
  });

  it('subclasses — multi-level inheritance — runtime — V inherits from U directly', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testInheritedFromU', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } },
    );
  });

  it('subclasses — multi-level inheritance — runtime — V exposes own function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testOwnV', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } },
    );
  });

  // ── Runtime: multi-level override ────────────────────────────────────────────

  it('subclasses — multi-level override — runtime — T returns original', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testT', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } },
    );
  });

  it('subclasses — multi-level override — runtime — U overrides T', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testU', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } },
    );
  });

  it('subclasses — multi-level override — runtime — V overrides U (and transitively T)', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testV', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } },
    );
  });

  // ── Runtime: multi-level protected override ──────────────────────────────────

  it('subclasses — multi-level protected override — runtime — T uses own protected', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testT12', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 10 }], to: 'c' } },
    );
  });

  it('subclasses — multi-level protected override — runtime — U override propagates to inherited public function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testU12', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 20 }], to: 'c' } },
    );
  });

  it('subclasses — multi-level protected override — runtime — V override propagates through two levels', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testV12', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 30 }], to: 'c' } },
    );
  });

  // ── Runtime: multi-level arg accumulation ────────────────────────────────────

  it('subclasses — multi-level arg accumulation — runtime — three-level subclass accumulates args', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testSum', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 6 }], to: 'c' } },
    );
  });

  it('subclasses — multi-level arg accumulation — runtime — accessor for grandparent arg works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testAccessorA', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } },
    );
  });

  it('subclasses — multi-level arg accumulation — runtime — accessor for own arg works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testAccessorC', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } },
    );
  });

  // ── Runtime: each layer's base. is its own parent's ──────────────────────────

  it('subclasses — multi-level parent layers — runtime — V returns own override', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testV14', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } },
    );
  });

  it("subclasses — multi-level parent layers — runtime — V's base.a is U's", async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testVFromU', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } },
    );
  });

  it("subclasses — multi-level parent layers — runtime — V inherits U.fromT, whose base.a is T's", async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testVFromT', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } },
    );
  });

  it('subclasses — optional args — runtime — both args provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testBothProvided', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 25 }], to: 'c' } },
    );
  });

  it('subclasses — optional args — runtime — subclass default fills in', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'testSubDefault', from: 'c' } },
      { output: { id: '2', 'ty': [{ result: 'Integer' }], re: [{ result: 15 }], to: 'c' } },
    );
  });

  it('subclasses — optional args — runtime — all defaults fill in', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'testAllDefaults', from: 'c' } },
      { output: { id: '3', 'ty': [{ result: 'Integer' }], re: [{ result: 10 }], to: 'c' } },
    );
  });

  // ── Runtime: `^` bare forms and two parents ─────────────────────────────────

  it('subclasses — ^ bare forms and two parents — runtime — a pure subclass keeps its parent\'s methods', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testSame', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } },
    );
  });

  it('subclasses — ^ bare forms and two parents — runtime — with two parents, the later one wins', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'testBothLaterWins', from: 'c' } },
      { output: { id: '2', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } },
    );
  });

  it('subclasses — ^ bare forms and two parents — runtime — the first parent\'s own method is inherited', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'testBothFirstParent', from: 'c' } },
      { output: { id: '3', 'ty': [{ result: 'Integer' }], re: [{ result: 10 }], to: 'c' } },
    );
  });

  it('subclasses — ^ bare forms and two parents — runtime — the second parent\'s own method is inherited', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: 'testBothSecondParent', from: 'c' } },
      { output: { id: '4', 'ty': [{ result: 'Integer' }], re: [{ result: 20 }], to: 'c' } },
    );
  });

  it('subclasses — ^ bare forms and two parents — runtime — a body after a bare ^ adds methods', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: 'testAdded', from: 'c' } },
      { output: { id: '5', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } },
    );
  });

  it('subclasses — ^ bare forms and two parents — runtime — params follow the last ^', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: 'testSized', from: 'c' } },
      { output: { id: '6', 'ty': [{ result: 'Integer' }], re: [{ result: 7 }], to: 'c' } },
    );
  });

  it('subclasses — ^ bare forms and two parents — runtime — a chain of names whose head is a composed class composes', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: 'testAgain', from: 'c' } },
      { output: { id: '7', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } },
    );
  });

  it('subclasses — ^ bare forms and two parents — runtime — a chain of names whose head is declared later composes', async () => {
    await expectBehavior(script,
      { input: { id: '8', op: 'testAhead', from: 'c' } },
      { output: { id: '8', 'ty': [{ result: 'Integer' }], re: [{ result: 5 }], to: 'c' } },
    );
  });

  it('subclasses — ^ bare forms and two parents — runtime — a chain of names whose head is a value is an exponent', async () => {
    await expectBehavior(script,
      { input: { id: '9', op: 'testSquared', from: 'c' } },
      { output: { id: '9', 'ty': [{ result: 'Integer' }], re: [{ result: 9 }], to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Subclasses with optional args
// ═══════════════════════════════════════════════════════════════════════════════

describe('subclasses — optional args — compilation', () => {
  it('superclass with optional arg, left to its default by super()', () => {
    expect(() => compileSource(`
      T = (a Integer = 0) *{}
      U = T ^ (b Integer) *{
        super()
        @sum = () -> result: (b + 1)
      }
      @test = () -> 1
    `)).not.toThrow();
  });

  it('subclass adds optional arg to inherited required', () => {
    expect(() => compileSource(`
      T = (a Integer) *{}
      U = T ^ (a Integer, b Integer = 10) *{
        super(a)
        @sum = () -> result: (a + b)
      }
      @test = () -> 1
    `)).not.toThrow();
  });

  it('both levels have optional args', () => {
    expect(() => compileSource(`
      T = (a: Integer = 1) *{}
      U = T ^ (a: Integer = 1, b: Integer = 2) *{
        super(a: a)
        @sum = () -> result: (a + b)
      }
      @test = () -> 1
    `)).not.toThrow();
  });
});
// ── Compilation: `^` forms and their errors ─────────────────────────────────

describe('subclasses — ^ forms — compilation', () => {
  it('a custom type is not a parent', () => {
    expect(() => compileSource(`
      type Point(Integer, Integer)
      U = Point ^ *{}
      @test = () -> 1
    `)).toThrow(/In 'U', 'Point' is a type, not a class/);
  });

  it('an unknown parent is an error', () => {
    expect(() => compileSource(`
      U = Nope ^ *{}
      @test = () -> 1
    `)).toThrow(/In 'U', 'Nope' is not a class in scope/);
  });

  it('after a class, ^ takes a layer', () => {
    expect(() => compileSource(`
      A = *{}
      D = A ^ "x"
      @test = () -> 1
    `)).toThrow("In 'D', 'A' is a class, so each '^' after it takes a layer: a parent class, a constructor ('*{ … }', '(params) *{ … }') or a singleton ('{ … }')");
  });

  it('after a class, each ^ takes a layer', () => {
    expect(() => compileSource(`
      A = *{}
      B = *{}
      D = A ^ B ^ 2
      @test = () -> 1
    `)).toThrow("In 'D', 'A' is a class, so each '^' after it takes a layer: a parent class, a constructor ('*{ … }', '(params) *{ … }') or a singleton ('{ … }')");
  });

  it('++ is not an operator', () => {
    expect(() => compileSource(`
      A = *{}
      D = A ++ *{}
      @test = () -> 1
    `)).toThrow();
  });

  // Skipped until name resolution: undeclared names in an expression aren't caught yet.
  it.skip('a chain of names whose head is not a class, or a value, is an error', () => {
    expect(() => compileSource(`
      D = Nope ^ Other
      @test = () -> 1
    `)).toThrow();
  });

  it('a public class extends with ^', () => {
    expect(() => compileSource(`
      @T = *{ @a = () -> 1 }
      @U = @T^
      @test = () -> 1
    `)).not.toThrow();
  });
});