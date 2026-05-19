import { compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Subclass consumption — compile-time checks
//
// These tests use compileSource (no runtime), so they pass on every target:
// the validator's discipline is the single source of truth for "legal call".
//
// Synthetic domain-neutral types (T / U / W) — no HTML or other domain
// conventions. The subclass-interface mechanism must be sound in its own right
// before any consumer (e.g. an HTML tag hierarchy) layers on top.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Happy path ───────────────────────────────────────────────────────────────

describe('subclass consumption — happy path', () => {
  it('sub-for-super: subclass passed where superclass param expected (positional)', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = -> v: x as Integer }
      U = *(T | y Integer) { @b = -> v: y as Integer }
      use = (t T) -> result: t.a() as Integer
      @test
        =
        u = U(1, 2)
        :result Integer = use(u)
        -> :result as Integer
    `)).not.toThrow();
  });

  it('sub-for-super: subclass passed where superclass param expected (named)', () => {
    expect(() => compileSource(`
      T = *(x: Integer) { @a = -> v: x as Integer }
      U = *(T | y: Integer) { @b = -> v: y as Integer }
      use = (t: T) -> result: t.a() as Integer
      @test
        =
        u = U(x: 1, y: 2)
        :result Integer = use(t: u)
        -> :result as Integer
    `)).not.toThrow();
  });

  it('call inherited method on subclass-typed value', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = -> v: x as Integer }
      U = *(T | y Integer) { @b = -> v: y as Integer }
      @test
        =
        u U = U(1, 2)
        :result = u.a()
        -> :result as Integer
    `)).not.toThrow();
  });

  it('call own method on subclass-typed value', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = -> v: x as Integer }
      U = *(T | y Integer) { @b = -> v: y as Integer }
      @test
        =
        u U = U(1, 2)
        :result = u.b()
        -> :result as Integer
    `)).not.toThrow();
  });

  it('call inherited method on superclass-typed value', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = -> v: x as Integer }
      U = *(T | y Integer) { @b = -> v: y as Integer }
      @test
        =
        u T = U(1, 2)
        :result = u.a()
        -> :result as Integer
    `)).not.toThrow();
  });

  it('nullable param accepts null', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = -> v: x as Integer }
      use = (t T | null) -> result: 0 as Integer
      @test
        =
        :result Integer = use(null)
        -> :result as Integer
    `)).not.toThrow();
  });

  it('nullable param accepts the underlying type', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = -> v: x as Integer }
      use = (t T | null) -> result: 0 as Integer
      @test
        =
        t = T(1)
        :result Integer = use(t)
        -> :result as Integer
    `)).not.toThrow();
  });
});

// ── Sad path: method existence ───────────────────────────────────────────────

describe('subclass consumption — method existence (sad path)', () => {
  it('P3: subclass-only method on superclass-typed value is rejected', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = -> v: x as Integer }
      U = *(T | y Integer) { @b = -> v: y as Integer }
      @test
        =
        u T = U(1, 2)
        :result = u.b()
        -> :result as Integer
    `)).toThrow(/has no method 'b'/);
  });

  it('P8: calling a nonexistent method is rejected', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = -> v: x as Integer }
      @test
        =
        t = T(1)
        :result = t.nonexistent()
        -> :result as Integer
    `)).toThrow(/has no method 'nonexistent'/);
  });

  it('error lists available methods on the declared type', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = -> v: x as Integer }
      @test
        =
        t = T(1)
        :result = t.nope()
        -> :result as Integer
    `)).toThrow(/available: a, x/);
  });
});

// ── Sad path: assignability ──────────────────────────────────────────────────

describe('subclass consumption — assignability (sad path)', () => {
  it('P4: superclass passed where subclass expected is rejected', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = -> v: x as Integer }
      U = *(T | y Integer) { @b = -> v: y as Integer }
      use = (u U) -> result: u.b() as Integer
      @test
        =
        t = T(1)
        :result Integer = use(t)
        -> :result as Integer
    `)).toThrow(/'T' is not assignable to 'U'/);
  });

  it('P7: unrelated type passed where T expected is rejected', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = -> v: x as Integer }
      W = *(n Integer) { @w = -> v: n as Integer }
      use = (t T) -> result: t.a() as Integer
      @test
        =
        w = W(99)
        :result Integer = use(w)
        -> :result as Integer
    `)).toThrow(/'W' is not assignable to 'T'/);
  });

  it('P9: wrong primitive type at constructor is rejected', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = -> v: x as Integer }
      @test
        =
        t = T("not-an-int")
        :result = t.a()
        -> :result as Integer
    `)).toThrow(/'Text' is not assignable to 'Integer'/);
  });

  it('wrong primitive at named constructor arg is rejected', () => {
    expect(() => compileSource(`
      T = *(x: Integer) { @a = -> v: x as Integer }
      @test
        =
        t = T(x: "wrong")
        :result = t.a()
        -> :result as Integer
    `)).toThrow(/named arg 'x'.*'Text'.*'Integer'/);
  });
});

// ── Sad path: constructor shape ──────────────────────────────────────────────

describe('subclass consumption — constructor shape (sad path)', () => {
  it('P10: missing required inherited param is rejected', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = -> v: x as Integer }
      U = *(T | y Integer) { @b = -> v: y as Integer }
      @test
        =
        u = U(y: 2)
        :result = u.a()
        -> :result as Integer
    `)).toThrow(/doesn't match any constructor clause/);
  });

  it('missing required own positional param is rejected', () => {
    expect(() => compileSource(`
      T = *(x Integer, y Integer) { @a = -> v: x as Integer }
      @test
        =
        t = T(1)
        :result = t.a()
        -> :result as Integer
    `)).toThrow(/doesn't match any constructor clause/);
  });

  it('unexpected named arg is rejected', () => {
    expect(() => compileSource(`
      T = *(x: Integer) { @a = -> v: x as Integer }
      @test
        =
        t = T(x: 1, unexpected: 99)
        :result = t.a()
        -> :result as Integer
    `)).toThrow(/doesn't match any constructor clause/);
  });

  it('excess positional args are rejected', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = -> v: x as Integer }
      @test
        =
        t = T(1, 2, 3)
        :result = t.a()
        -> :result as Integer
    `)).toThrow(/doesn't match any constructor clause/);
  });
});

// ── Sad path: method arg-type ────────────────────────────────────────────────

describe('subclass consumption — method arg-type (sad path)', () => {
  it('method called with wrong primitive arg is rejected', () => {
    expect(() => compileSource(`
      T = * { @take = (n Integer) -> v: n as Integer }
      @test
        =
        t = T()
        :result Integer = t.take("wrong")
        -> :result as Integer
    `)).toThrow(/'Text' is not assignable to 'Integer'/);
  });
});
